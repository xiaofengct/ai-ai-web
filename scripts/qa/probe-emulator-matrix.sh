#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# 模拟器启动矩阵对照 —— 定位 ai-ai_* AVD 静默退出（退出码 21）的成因
# ═══════════════════════════════════════════════════════════════════════════
#
# 背景：WHPX 模式下模拟器在 ~90–130s 静默死掉（tasklist 里 qemu 消失），
#       但 emulator 日志停在 "WHPX ... operational" 之后无任何错误，
#       Windows 事件日志里也没有 Application Error / WER 记录
#       ⇒ 不是异常崩溃，是**干净退出**（exit code 21）。
#
# 本脚本逐个变量对照：核数 / GPU 后端 / 加速方式。
# 每个配置前台跑 DUR 秒，记录：adb 是否见到设备、退出码、日志尾部。
#
# 用法：bash scripts/qa/probe-emulator-matrix.sh [每组秒数] [AVD名]
set -u

SDK="C:\Users\<user>/.workbuddy/android-toolchain/sdk"
DUR="${1:-140}"
AVD="${2:-ai-ai_atd}"
OUT="C:\Users\<user>/WorkBuddy/2026-10-04-01-08-54/.qa-tmp/matrix"

mkdir -p "$OUT"
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
export ANDROID_AVD_HOME="${USERPROFILE:-$HOME}/.android/avd"
ADB="$SDK/platform-tools/adb.exe"

"$ADB" start-server >/dev/null 2>&1
for d in $("$ADB" devices 2>/dev/null | awk '/^emulator-|^127\./{print $1}'); do
  "$ADB" -s "$d" emu kill >/dev/null 2>&1
done
sleep 2
rm -f "$ANDROID_AVD_HOME/$AVD.avd/multiinstance.lock" 2>/dev/null || true

cd "$SDK/emulator" || exit 4

run_one() {
  local TAG="$1"; shift
  local LOG="$OUT/$TAG.log"
  local DEVSEEN="-"
  local BOOT=-1

  echo "──────────────────────────────────────────────────────────"
  echo "▶ $TAG  参数：$*"
  rm -f "$ANDROID_AVD_HOME/$AVD.avd/multiinstance.lock" 2>/dev/null || true

  # 前台起，后台挂一个探测循环
  ./emulator.exe -avd "$AVD" -no-window -no-audio -no-boot-anim \
    -no-snapshot -no-metrics -no-snapshot-save -wipe-data "$@" \
    > "$LOG" 2>&1 &
  local PID=$!

  local T0=$(date +%s) EL D RAW ST ALIVE
  while :; do
    EL=$(( $(date +%s) - T0 ))
    [ "$EL" -ge "$DUR" ] && break
    RAW=$("$ADB" devices 2>/dev/null)
    D=$(echo "$RAW" | awk '/^emulator-555[0-9]|^127\.0\.0\.1:5555/{print $1; exit}')
    if [ -n "$D" ]; then
      [ "$DEVSEEN" = "-" ] && DEVSEEN="$D@${EL}s"
      ST=$("$ADB" -s "$D" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')
      [ "$ST" = "1" ] && BOOT=1
    fi
    # 进程是否还在（qemu 是关键；emulator.exe 会 fork）
    ALIVE=$(tasklist 2>/dev/null | grep -icE "qemu-system|emulator\.exe")
    if [ "$ALIVE" = "0" ]; then
      echo "  ✗ 进程消失于 ${EL}s（设备始见：$DEVSEEN；boot_completed=$BOOT）"
      break
    fi
    sleep 3
  done

  # 收尾：拿退出码（若仍活着则 kill）
  local CODE
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    sleep 1
    CODE="alive@${EL}s(已杀)"
  else
    wait "$PID" 2>/dev/null
    CODE="exit=$?"
  fi
  "$ADB" kill-server >/dev/null 2>&1 || true
  pkill -f qemu-system 2>/dev/null || true
  sleep 2

  echo "  设备始见：$DEVSEEN | boot_completed=$BOOT | $CODE | 日志 $(wc -c < "$LOG") 字节"
  echo "  日志尾部（去掉 androidboot / IPv6 噪音）："
  grep -viE "Ignore IPv6|androidboot|^-" "$LOG" | tail -3 | sed 's/^/    /'
  echo "$TAG|$DEVSEEN|$BOOT|$CODE|$(wc -c < "$LOG")" >> "$OUT/summary.txt"
}

: > "$OUT/summary.txt"

run_one "W_whpx_c2_ss"    -gpu swiftshader_indirect -memory 2048 -cores 2
run_one "W_whpx_c1_ss"    -gpu swiftshader_indirect -memory 2048 -cores 1
run_one "W_whpx_c2_gpuoff" -gpu off                -memory 2048 -cores 2
run_one "W_tcg_c2_ss"     -accel off -gpu swiftshader_indirect -memory 2048 -cores 2

echo
echo "═══════════════════ 汇总 ═══════════════════"
column -t -s'|' "$OUT/summary.txt" 2>/dev/null || cat "$OUT/summary.txt"
