#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# APK 模拟器验收 —— 一体化脚本（v3）
# ═══════════════════════════════════════════════════════════════════════════
#
# 一个命令做完：建 AVD → 启动 → 等开机 → 装 APK → 启动 App → 截图
#             → 收日志 → 测返回键 → 输出报告素材
#
# ═══════════════════════════════════════════════════════════════════════════
# ★★ v3 相对 v2 的四处修正（全部来自 2026-10-04 的实测踩坑）
# ═══════════════════════════════════════════════════════════════════════════
#
# 【修正 1】不再用 `kill -0 $PID` 判存活 → 一律以 **adb 能不能看到设备** 为准。
#   本环境实测：`emulator.exe` 会 fork 出 `qemu-system-x86_64-headless.exe`，
#   Git Bash 对 Windows 进程的可见性有限，`kill -0` 常误报"已退出"。
#
# 【修正 2】不再 `adb connect 127.0.0.1:5555`。
#   emulator 的 adb 端口本来就是 5555，`adb devices` 里的名字是 `emulator-5554`
#   （名字用的是 console 端口）。再 connect 一次会让 adb 多出一条
#   `127.0.0.1:5555` 网络设备条目，设备列表在两个名字之间来回跳
#   （offline ↔ device），日志看着像"崩了又活"，其实进程一直好好的。
#   ⇒ 只认 `emulator-5554` 这一种标识。
#
# 【修正 3】加 `-show-kernel` + **周期性打印内核尾行**。
#   前面几轮"7 分钟开不了机"时，emulator 自己的日志停在
#   "WHPX ... operational" 之后就没有下文了 —— 那是 emulator 的日志，
#   看不到 guest 内核在干什么。打开 `-show-kernel` 才能判断
#   "是在慢慢推进"还是"卡死了"，否则只能干等超时、什么也学不到。
#
# 【修正 4】默认**不再每次 -wipe-data**。
#   每次擦数据 ⇒ 每次都要重做 userdata 格式化 + 首次包优化（dex2oat），
#   在软件 GL 的模拟器上这一项就要好几分钟，而且每轮都白付一次。
#   ⇒ 第 1 轮擦（保证干净），后续轮次复用已初始化的 data 分区（快得多）。
#     需要强制干净时用 `WIPE=1`。
#
# 用法：
#   bash scripts/qa/run-apk-on-emulator.sh <APK路径>
#   WIPE=1 BOOT_TIMEOUT=900 bash scripts/qa/run-apk-on-emulator.sh <APK>
#   AVD_NAME=ai-ai_api34 bash scripts/qa/run-apk-on-emulator.sh <APK>
set -u

SDK="C:\Users\<user>/.workbuddy/android-toolchain/sdk"
HOME_DIR="${USERPROFILE:-$HOME}"
AVD_NAME="${AVD_NAME:-ai-ai_atd}"
APK="${1:-}"
OUT_DIR="C:\Users\<user>/WorkBuddy/2026-10-04-01-08-54/.qa-tmp/emulator-run"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-900}"
WIPE="${WIPE:-1}"
PKG_BUILTIN="com.aiai.builtin"
PKG_STANDALONE="com.aiai.standalone"

mkdir -p "$OUT_DIR"
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
export ANDROID_AVD_HOME="$HOME_DIR/.android/avd"
ADB="$SDK/platform-tools/adb.exe"
LOG="$OUT_DIR/run.log"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

: > "$LOG"

[ -n "$APK" ] || { echo "用法：bash scripts/qa/run-apk-on-emulator.sh <APK路径>"; exit 2; }
[ -f "$APK" ] || { echo "找不到 APK：$APK"; exit 2; }

# ─────────────────── 1. AVD ───────────────────
IMG="system-images;android-34;aosp_atd;x86_64"
CFG="$ANDROID_AVD_HOME/$AVD_NAME.avd/config.ini"
if [ ! -f "$CFG" ]; then
  log "创建 AVD：$AVD_NAME"
  echo "no" | "$SDK/cmdline-tools/latest/bin/avdmanager.bat" create avd -n "$AVD_NAME" -k "$IMG" -d pixel_6 --force >/dev/null 2>&1
  [ -f "$CFG" ] || { log "✗ AVD 创建失败"; exit 3; }
  {
    echo ""
    echo "# ——— 验收用（run-apk-on-emulator.sh v3 追加）———"
    echo "hw.keyboard=yes"
    echo "hw.mainKeys=no"
    echo "hw.gpu.mode=swiftshader_indirect"
    echo "hw.gpu.enabled=yes"
    echo "hw.ramSize=2048"
    echo "vm.heapSize=256"
    echo "disk.dataPartition.size=3072M"
    echo "hw.audioInput=no"
    echo "hw.audioOutput=no"
    echo "showDeviceFrame=no"
  } >> "$CFG"
  log "AVD 已创建"
else
  log "复用 AVD：$AVD_NAME"
fi

# ─────────────────── 2. 清理旧实例与残留锁 ───────────────────
"$ADB" start-server >/dev/null 2>&1
for d in $("$ADB" devices 2>/dev/null | awk '/^emulator-|^127\./{print $1}'); do
  "$ADB" -s "$d" emu kill >/dev/null 2>&1
  "$ADB" disconnect "$d" >/dev/null 2>&1
done
sleep 2

# ★ 模拟器被强杀后会留下 multiinstance.lock / hardware-qemu.ini.lock，
#   下一次启动会卡在这些锁上（有时表现为静默退出）。
#   这些是 emulator 自己生成的临时文件，删除安全。
for f in "$ANDROID_AVD_HOME/$AVD_NAME.avd/multiinstance.lock" \
         "$ANDROID_AVD_HOME/$AVD_NAME.avd/hardware-qemu.ini.lock" \
         "$ANDROID_AVD_HOME/$AVD_NAME.avd/snapshots/default_boot" ; do
  if [ -e "$f" ]; then log "清残留：$(basename "$f")"; rm -rf "$f" 2>/dev/null || true; fi
done

# ─────────────────── 3+4. 启动并等开机（带重试）───────────────────
cd "$SDK/emulator" || exit 4

boot_once() {          # $1=标签  $2=额外参数  $3=是否 -wipe-data
  local TAG="$1" EXTRA="$2" DO_WIPE="$3"
  local KLOG="$OUT_DIR/kernel-$TAG.log"
  local ELOG="$OUT_DIR/emulator-$TAG.log"
  local WIPE_ARG=""
  [ "$DO_WIPE" = "1" ] && WIPE_ARG="-wipe-data"

  log "── 启动尝试【$TAG】gpu/accel=「$EXTRA」wipe=$DO_WIPE"

  for d in $("$ADB" devices 2>/dev/null | awk '/^emulator-|^127\./{print $1}'); do
    "$ADB" -s "$d" emu kill >/dev/null 2>&1
  done
  rm -f "$ANDROID_AVD_HOME/$AVD_NAME.avd/multiinstance.lock" 2>/dev/null || true
  sleep 2

  # shellcheck disable=SC2086
  ./emulator.exe -avd "$AVD_NAME" \
    -no-window -no-audio -no-boot-anim \
    -no-metrics -show-kernel \
    -memory 2048 -cores 2 \
    $WIPE_ARG $EXTRA \
    > "$ELOG" 2>&1 &
  log "  启动器 PID=$!（不用它判存活）"

  # -show-kernel 的内核输出与 emulator 日志在同一路 stdout，
  # 用 `Android Emulator` 的 INFO 行做分界不方便；直接把整份日志当内核日志看尾部。
  local T0 EL D ST LAST=-1
  local ADB_RESTARTS=0
  T0=$(date +%s)
  while :; do
    EL=$(( $(date +%s) - T0 ))
    [ "$EL" -ge "$BOOT_TIMEOUT" ] && break

    # ★ 只认 emulator-5554（见文件头修正 2）
    D=$( "$ADB" devices 2>/dev/null | awk '/^emulator-555[0-9]/{print $1; exit}' )

    # ★★ 周期性重启 adb 服务（2026-10-04 实测的关键修正）
    #
    # 现象：emulator 明明在跑、5554/5555 都在 LISTENING，
    #       但 `adb devices` 一直返回空 —— 而**手动 `adb kill-server && start-server`
    #       之后设备立刻出现**（虽然先是 offline）。也就是说 host 侧的
    #       adb↔emulator 注册握手会静默失败，而**不是**模拟器没起来。
    # 前几轮把这种情况误判成"模拟器崩了/卡住了"，白等了好几轮超时。
    #
    # ★ 但要克制：guest 很慢时，频繁 kill-server 会把**正在建立的** adbd 握手打断，
    #   反而让它永远连不上。⇒ 只看"很久没见到设备"时才重启，且**最多 3 次**，
    #   一旦见到设备就再也不动 adb。
    if [ -z "$D" ] && [ "$ADB_RESTARTS" -lt 3 ]; then
      if [ $((EL / 120)) -gt $(((LAST < 0 ? 0 : LAST) / 120)) ]; then
        ADB_RESTARTS=$((ADB_RESTARTS + 1))
        log "    第 ${ADB_RESTARTS} 次重扫 adb（尚无设备）"
        "$ADB" kill-server >/dev/null 2>&1
        sleep 1
        "$ADB" start-server >/dev/null 2>&1
        sleep 2
        D=$( "$ADB" devices 2>/dev/null | awk '/^emulator-555[0-9]/{print $1; exit}' )
      fi
    fi

    if [ -n "$D" ]; then
      ST=$("$ADB" -s "$D" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')
      [ "$ST" = "1" ] && { DEV="$D"; BOOTED=1; log "  ✓ 开机完成（${EL}s）设备=$DEV"; return 0; }
    fi

    # ★ 每 30s 报一次进度：设备状态 + adb 眼中的状态 + **内核尾行**
    if [ $((EL / 30)) -ne $((LAST < 0 ? -30 : LAST)) ]; then
      local ST2
      ST2=$( "$ADB" devices 2>/dev/null | awk '/^emulator-555[0-9]/{print $2; exit}' )
      local KT
      KT=$(grep -aE "^\[[[:space:]]*[0-9]+\." "$ELOG" 2>/dev/null | tail -1 | cut -c1-100)
      [ -z "$KT" ] && KT=$(grep -avE "Ignore IPv6|androidboot" "$ELOG" 2>/dev/null | tail -1 | cut -c1-100)
      log "    [${EL}s] 设备=${D:-（无）} adb状态=${ST2:-—} boot=${ST:-?} | ${KT:-（无输出）}"
    fi
    LAST=$EL
    sleep 3
  done

  log "  ✗ 【$TAG】${BOOT_TIMEOUT}s 内未完成开机"
  return 1
}

BOOTED=0
DEV=""
for ATTEMPT in "1|-gpu swiftshader_indirect|$WIPE" "2|-gpu off|0" "3|-accel off -gpu swiftshader_indirect|0"; do
  TAG="${ATTEMPT%%|*}"
  REST="${ATTEMPT#*|}"
  EXTRA="${REST%|*}"
  DO_WIPE="${REST##*|}"
  if boot_once "$TAG" "$EXTRA" "$DO_WIPE"; then break; fi
done

if [ "$BOOTED" != "1" ]; then
  log "✗ 三轮启动均未完成开机"
  {
    for f in "$OUT_DIR"/emulator-*.log; do
      [ -f "$f" ] || continue
      echo "=== $(basename "$f") ── 内核日志尾部 25 行 ==="
      grep -aE "^\[[[:space:]]*[0-9]+\." "$f" | tail -25
      echo "=== $(basename "$f") ── emulator 日志尾部 12 行 ==="
      grep -avE "Ignore IPv6|androidboot" "$f" | tail -12
      echo
    done
    echo "=== adb devices ==="; "$ADB" devices 2>&1
    echo "=== 残留进程 ==="; tasklist 2>/dev/null | grep -iE "qemu|emulator" || echo "(无)"
  } > "$OUT_DIR/boot-failure.txt" 2>&1
  cat "$OUT_DIR/boot-failure.txt"
  exit 5
fi

# ─────────────────── 5. 设备信息 ───────────────────
{
  echo "=== 设备信息 ==="
  echo "Android : $("$ADB" -s "$DEV" shell getprop ro.build.version.release | tr -d '\r')"
  echo "API     : $("$ADB" -s "$DEV" shell getprop ro.build.version.sdk | tr -d '\r')"
  echo "ABI     : $("$ADB" -s "$DEV" shell getprop ro.product.cpu.abi | tr -d '\r')"
  echo "型号    : $("$ADB" -s "$DEV" shell getprop ro.product.model | tr -d '\r')"
  echo "指纹    : $("$ADB" -s "$DEV" shell getprop ro.build.fingerprint | tr -d '\r')"
  echo "屏幕    : $("$ADB" -s "$DEV" shell wm size | tr -d '\r')"
  echo "密度    : $("$ADB" -s "$DEV" shell wm density | tr -d '\r')"
  echo "WebView : $("$ADB" -s "$DEV" shell dumpsys package com.google.android.webview 2>/dev/null | grep -m1 versionName | tr -d '\r')"
} | tee "$OUT_DIR/device-info.txt"

# ─────────────────── 6. 安装 APK ───────────────────
log "安装 APK：$APK"
"$ADB" -s "$DEV" install -r -t "$APK" 2>&1 | tee "$OUT_DIR/install.log"

if "$ADB" -s "$DEV" shell pm list packages 2>/dev/null | grep -q "$PKG_BUILTIN"; then PKG="$PKG_BUILTIN"
elif "$ADB" -s "$DEV" shell pm list packages 2>/dev/null | grep -q "$PKG_STANDALONE"; then PKG="$PKG_STANDALONE"
else
  log "✗ 找不到 com.aiai.* 包"
  "$ADB" -s "$DEV" shell pm list packages > "$OUT_DIR/packages.txt" 2>&1
  exit 6
fi
log "包名：$PKG"

# ─────────────────── 7. 启动 App + 采集 ───────────────────
"$ADB" -s "$DEV" logcat -c >/dev/null 2>&1
ACT=$("$ADB" -s "$DEV" shell cmd package resolve-activity --brief "$PKG" 2>/dev/null | tail -1 | tr -d '\r')
log "启动 Activity：$ACT"
"$ADB" -s "$DEV" shell am start -W -n "$ACT" 2>&1 | tee "$OUT_DIR/start.log"

sleep 25   # 等 WebView 起 + 首屏 + 种子数据

"$ADB" -s "$DEV" exec-out screencap -p > "$OUT_DIR/screen-1-first-launch.png" 2>/dev/null
log "截图 1：$(stat -c%s "$OUT_DIR/screen-1-first-launch.png" 2>/dev/null || echo '?') 字节"

"$ADB" -s "$DEV" shell dumpsys activity activities 2>/dev/null | grep -m2 -iE "mResumedActivity|topResumedActivity" | tr -d '\r' | tee "$OUT_DIR/foreground.txt"

# ─────────────────── 8. 日志 ───────────────────
log "采集日志"
"$ADB" -s "$DEV" logcat -d > "$OUT_DIR/logcat-full.txt" 2>&1
grep -iE "ai-ai|capacitor|chromium|AndroidRuntime|FATAL|Exception|WebView|Console" \
  "$OUT_DIR/logcat-full.txt" > "$OUT_DIR/logcat-app.txt" 2>/dev/null || true

log "── 崩溃/异常 ──"
grep -iE "FATAL|AndroidRuntime|Exception" "$OUT_DIR/logcat-app.txt" | head -20 | tee -a "$LOG" || log "(无)"
log "── WebView / JS 控制台 ──"
grep -iE "chromium|Console" "$OUT_DIR/logcat-app.txt" | head -20 | tee -a "$LOG" || log "(无)"

# ─────────────────── 9. 返回键测试（FN-16）───────────────────
log "测试返回键（按一次不应退出应用）"
"$ADB" -s "$DEV" shell input keyevent KEYCODE_BACK
sleep 4
{
  echo "=== 按返回键后的前台 Activity ==="
  "$ADB" -s "$DEV" shell dumpsys activity activities 2>/dev/null | grep -m2 -iE "mResumedActivity|topResumedActivity" | tr -d '\r'
  echo "=== 进程是否还在（有 PID 即未退出）==="
  "$ADB" -s "$DEV" shell pidof "$PKG" 2>/dev/null | tr -d '\r'
} | tee "$OUT_DIR/back-key.txt"
"$ADB" -s "$DEV" exec-out screencap -p > "$OUT_DIR/screen-2-after-back.png" 2>/dev/null

log "完成，产物在 $OUT_DIR"
ls -la "$OUT_DIR" | tee -a "$LOG"
