#!/usr/bin/env bash
# 安装 Android 模拟器 + 系统镜像（不需要管理员权限的部分）
#   - emulator 包
#   - system-images;android-34;google_apis;x86_64（含现代 WebView，Android 14）
# 说明：这一步只做"下载解压"，不涉及驱动/Hyper-V —— 那些需要管理员，本会话没有。
set -u
SDK="C:\Users\<user>/.workbuddy/android-toolchain/sdk"
export JAVA_HOME="C:\Users\<user>/.workbuddy/android-toolchain/jdk-21.0.12.1+1"
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
SDKM="sdk\\cmdline-tools\\latest\\bin\\sdkmanager.bat"

cd "C:\Users\<user>/.workbuddy/android-toolchain" || exit 1

echo "=== 接受许可（可能多次提示，统一 yes）==="
yes 2>/dev/null | cmd //c "$SDKM --licenses" >/dev/null 2>&1
echo "licenses done"

echo
echo "=== 开始安装 emulator ==="
cmd //c "$SDKM --install emulator" 2>&1 | tail -5

echo
echo "=== 开始安装 system-image (android-34 google_apis x86_64) ==="
cmd //c "$SDKM --install \"system-images;android-34;google_apis;x86_64\"" 2>&1 | tail -8

echo
echo "=== 安装结果 ==="
ls "$SDK/emulator/emulator.exe" 2>/dev/null && echo "emulator OK" || echo "emulator 缺失"
ls -d "$SDK/system-images/android-34/google_apis/x86_64" 2>/dev/null && echo "system-image OK" || echo "system-image 缺失"
