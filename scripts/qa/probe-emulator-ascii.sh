#!/usr/bin/env bash
# 探针：**纯 ASCII 路径** + verbose，看能否让 guest 跑起来。
#
# 背景：`emu-launch-params.txt` 里 emulator 记录自己的路径时把 `[用户名已脱敏]`
#       写成了乱码 `[用户名已脱敏]`（UTF-8 字节被按 GBK 解读）。
#       Android 模拟器在 Windows 上对**非 ASCII 路径**历来有问题，
#       而本机的 SDK / AVD / TEMP 全都落在 `C:\Users\<user>\...` 下。
# ⇒ 本探针把 AVD 家目录、emulator 家目录、临时目录全部指到 `C:\` 下的
#   纯 ASCII 目录，重建一个 AVD 再启动，验证"路径编码"这个假设。
#
# 用法：bash scripts/qa/probe-emulator-ascii.sh [秒数]
set -u

SDK="C:\Users\<user>/.workbuddy/android-toolchain/sdk"
DUR="${1:-240}"
OUT="C:\Users\<user>/WorkBuddy/2026-10-04-01-08-54/.qa-tmp/asciiprobe"
mkdir -p "$OUT"

# ★ 全 ASCII 的运行时目录
ASCII_HOME="C:/android-avd"
ASCII_TMP="C:/android-tmp"
mkdir -p "$ASCII_HOME" "$ASCII_TMP"

export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
export ANDROID_AVD_HOME="$ASCII_HOME"
export ANDROID_EMULATOR_HOME="$ASCII_HOME"
export ANDROID_SDK_HOME="$ASCII_HOME"
export ANDROID_TMP="$ASCII_TMP"
export ANDROID_USER_HOME="$ASCII_HOME"
export TEMP="$ASCII_TMP" TMP="$ASCII_TMP" TMPDIR="$ASCII_TMP"

ADB="$SDK/platform-tools/adb.exe"
AVD="asciiprobe"

"$ADB" start-server >/dev/null 2>&1
for d in $("$ADB" devices 2>/dev/null | awk '/^emulator-|^127\./{print $1}'); do
  "$ADB" -s "$d" emu kill >/dev/null 2>&1
done
pkill -f qemu-system 2>/dev/null || true
sleep 2

echo "═══ 环境 ═══"
echo "AVD_HOME   = $ANDROID_AVD_HOME"
echo "TMP        = $TMP"
echo "SDK        = $SDK"

if [ ! -f "$ASCII_HOME/$AVD.avd/config.ini" ]; then
  # ★ 不用 avdmanager 创建（它在自定义 ANDROID_*_HOME 下实测会失败）。
  #   直接**复制现有 AVD 的定义文件**：AVD 本质上就是
  #   `<name>.ini`（指向目录）+ `<name>.avd/config.ini`（硬件参数），
  #   磁盘镜像会在首次启动时生成。这样绕开 java/avdmanager 的一切依赖。
  SRC_HOME="${USERPROFILE:-$HOME}/.android/avd"
  echo "复制 AVD 定义：$SRC_HOME/ai-ai_atd.avd → $ASCII_HOME/$AVD.avd"
  mkdir -p "$ASCII_HOME/$AVD.avd"
  cp "$SRC_HOME/ai-ai_atd.avd/config.ini" "$ASCII_HOME/$AVD.avd/config.ini" 2>/dev/null
  {
    echo "avd.ini.encoding=UTF-8"
    echo "path=$ASCII_HOME/$AVD.avd"
    echo "path.rel=avd/$AVD.avd"
    echo "target=android-34"
  } > "$ASCII_HOME/$AVD.ini"
  if [ ! -f "$ASCII_HOME/$AVD.avd/config.ini" ]; then
    echo "✗ 复制失败（源 AVD 不存在？）"
    exit 3
  fi
fi
echo "AVD 就绪：$ASCII_HOME/$AVD.avd"
echo

ELOG="$OUT/ascii.log"
cd "$SDK/emulator" || exit 4
./emulator.exe -avd "$AVD" -no-window -no-audio -no-boot-anim \
  -no-metrics -show-kernel -no-snapshot -verbose \
  -gpu swiftshader_indirect -memory 2048 -cores 2 \
  > "$ELOG" 2>&1 &
EPID=$!
echo "PID=$EPID  （日志：$ELOG）"
echo

T0=$(date +%s)
LAST=-1
while :; do
  EL=$(( $(date +%s) - T0 ))
  [ "$EL" -ge "$DUR" ] && break

  if [ $((EL / 30)) -ne $((LAST < 0 ? -30 : LAST)) ]; then
    ALIVE=$(tasklist 2>/dev/null | grep -icE "qemu-system")
    NK=$(grep -acE "^\[[[:space:]]*[0-9]+\." "$ELOG" 2>/dev/null)
    KL=$(grep -aE "^\[[[:space:]]*[0-9]+\." "$ELOG" 2>/dev/null | tail -1 | cut -c1-100)
    DEV=$("$ADB" devices 2>/dev/null | awk '/^emulator-555[0-9]/{print $1" "$2; exit}')
    echo "[${EL}s] qemu=$ALIVE 内核行=$NK 设备=${DEV:-（无）}"
    [ -n "$KL" ] && echo "        内核: $KL"
  fi
  LAST=$EL
  sleep 3
done

echo
echo "═══ 结论 ═══"
NK=$(grep -acE "^\[[[:space:]]*[0-9]+\." "$ELOG" 2>/dev/null)
if [ "$NK" -gt 0 ]; then
  echo "✓ guest 内核在跑（$NK 行）⇒ 路径编码就是根因"
  grep -aE "^\[[[:space:]]*[0-9]+\." "$ELOG" | tail -6
else
  echo "✗ 仍无内核行 ⇒ 路径编码不是（唯一）根因"
fi
echo
echo "── emulator verbose 尾部 20 行（去掉 androidboot 噪音）──"
grep -avE "Ignore IPv6|androidboot|Quoted param" "$ELOG" | tail -20
echo
echo "── 关键错误行 ──"
grep -inE "error|fail|cannot|unable|denied|invalid|mismatch" "$ELOG" | tail -15

kill "$EPID" 2>/dev/null || true
sleep 1
pkill -f qemu-system 2>/dev/null || true
