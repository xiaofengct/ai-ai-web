#!/usr/bin/env bash
# TCG 探针：只回答一个问题 —— **guest 内核到底有没有开始执行？**
#
# 背景：WHPX 模式下 emulator 进程活着、端口在听，但自己的日志停在
#       "Windows Hypervisor Platform accelerator is operational" 之后毫无下文，
#       `-show-kernel` 也不吐任何内核行 ⇒ 怀疑 guest 根本没跑。
# 本探针换 `-accel off`（纯 TCG，不依赖 hypervisor），开 `-show-kernel`，
# 看是否出现 `[    0.000000] ...` 这种内核行 —— 有 = guest 在跑（只是慢），
# 没有 = 这台机器上模拟器根本起不来 guest。
#
# 用法：bash scripts/qa/probe-emulator-tcg.sh [秒数] [AVD名]
set -u

SDK="C:\Users\<user>/.workbuddy/android-toolchain/sdk"
DUR="${1:-300}"
AVD="${2:-ai-ai_atd}"
OUT="C:\Users\<user>/WorkBuddy/2026-10-04-01-08-54/.qa-tmp/tcgprobe"
mkdir -p "$OUT"

export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
export ANDROID_AVD_HOME="${USERPROFILE:-$HOME}/.android/avd"
ADB="$SDK/platform-tools/adb.exe"
ELOG="$OUT/tcg.log"

"$ADB" start-server >/dev/null 2>&1
for d in $("$ADB" devices 2>/dev/null | awk '/^emulator-|^127\./{print $1}'); do
  "$ADB" -s "$d" emu kill >/dev/null 2>&1
done
sleep 2
rm -f "$ANDROID_AVD_HOME/$AVD.avd/multiinstance.lock" 2>/dev/null || true

cd "$SDK/emulator" || exit 4
echo "启动：$AVD / -accel off / -show-kernel / 观察 ${DUR}s"
./emulator.exe -avd "$AVD" -no-window -no-audio -no-boot-anim \
  -no-metrics -show-kernel -no-snapshot \
  -accel off -gpu swiftshader_indirect \
  -memory 2048 -cores 2 \
  > "$ELOG" 2>&1 &
EPID=$!
echo "PID=$EPID"

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
    echo "[${EL}s] qemu进程=$ALIVE 内核行=$NK 设备=${DEV:-（无）}"
    [ -n "$KL" ] && echo "        内核尾行: $KL"
  fi
  LAST=$EL
  sleep 3
done

echo
echo "═══ 结论 ═══"
NK=$(grep -acE "^\[[[:space:]]*[0-9]+\." "$ELOG" 2>/dev/null)
if [ "$NK" -gt 0 ]; then
  echo "✓ guest 内核在跑（共 $NK 行内核日志）⇒ 纯软件模式可用，只是慢"
  grep -aE "^\[[[:space:]]*[0-9]+\." "$ELOG" | tail -5
else
  echo "✗ 连内核行都没有 ⇒ guest 未执行"
fi
echo "emulator 日志尾部："
grep -avE "Ignore IPv6" "$ELOG" | tail -8

kill "$EPID" 2>/dev/null || true
sleep 1
pkill -f qemu-system 2>/dev/null || true
