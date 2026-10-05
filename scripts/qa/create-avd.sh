#!/usr/bin/env bash
# 创建用于验收的 AVD（Android 14 / API 34 / google_apis / x86_64）
#
# 说明：
#   - 用 `google_apis` 镜像（含现代 WebView）—— 这正是我们要验的东西之一
#     （用户真机曾因 WebView 过旧而白屏，见 docs/10）
#   - `hw.keyboard=yes` 让 adb 能直接送文本（测输入框与键盘遮挡用）
#   - 分辨率与密度按 Pixel 6 一档，贴近真实手机
set -u
SDK="C:\Users\<user>/.workbuddy/android-toolchain/sdk"
export JAVA_HOME="C:\Users\<user>/.workbuddy/android-toolchain/jdk-21.0.12.1+1"
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
export ANDROID_AVD_HOME="$HOME/.android/avd"
mkdir -p "$ANDROID_AVD_HOME"

AVD_NAME="ai-ai_api34"
IMG="system-images;android-34;google_apis;x86_64"

cd "C:\Users\<user>/.workbuddy/android-toolchain" || exit 1

echo "=== 创建 AVD：$AVD_NAME ==="
# 回显 "no" 表示不自定义硬件配置（用 device profile 的默认值）
echo "no" | cmd //c "sdk\\cmdline-tools\\latest\\bin\\avdmanager.bat create avd -n $AVD_NAME -k \"$IMG\" -d pixel_6 --force" 2>&1 | tail -6

CFG="$ANDROID_AVD_HOME/$AVD_NAME.avd/config.ini"
if [ ! -f "$CFG" ]; then
  echo "✗ AVD 创建失败：找不到 $CFG"
  exit 1
fi

echo
echo "=== 调整 AVD 配置 ==="
# 逐项用 sed 覆盖（追加优先，重复键以最后一条为准）
{
  echo ""
  echo "# ——— 验收用配置（由 scripts/qa/create-avd.sh 追加）———"
  echo "hw.keyboard=yes"            # 允许 adb 直接输入文本
  echo "hw.mainKeys=no"            # 有屏幕内导航键（测返回键行为）
  echo "hw.gpu.mode=swiftshader_indirect"  # 无独显/容器环境下最稳的软件渲染
  echo "hw.ramSize=2048"
  echo "vm.heapSize=256"
  echo "disk.dataPartition.size=4096M"
  echo "hw.audioInput=no"
  echo "hw.audioOutput=no"
  echo "showDeviceFrame=no"
  echo "skin.dynamic=yes"
  echo "hw.lcd.width=1080"
  echo "hw.lcd.height=2400"
  echo "hw.lcd.density=420"
} >> "$CFG"

echo "--- config.ini 关键项 ---"
grep -E "hw.keyboard|hw.mainKeys|hw.gpu.mode|hw.lcd|image.sysdir|disk.dataPartition" "$CFG"

echo
echo "=== AVD 列表 ==="
cmd //c "sdk\\cmdline-tools\\latest\\bin\\avdmanager.bat list avd" 2>&1 | grep -E "Name|Path|Target|Based on" | head -10
