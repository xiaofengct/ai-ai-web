#!/usr/bin/env node
/**
 * 以**真正脱离父进程**的方式启动 Android 模拟器。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么需要这个脚本（踩了一串坑）
 * ═══════════════════════════════════════════════════════════════════════════
 * 目标：让模拟器在后台长期运行，供 adb 安装/调试 APK。
 * 但普通的启动方式在本环境里**全部失败**，原因各不相同：
 *
 *   ① `emulator.exe ... &`（bash 后台）
 *      ⇒ 命令结束时 bash 给整个**进程组**发信号，模拟器被连带杀掉。
 *        现象：日志停在 "accelerator is operational"，
 *        看起来像崩溃，其实是被杀 —— 这个区别很关键，否则会去查错方向。
 *
 *   ② 工具的 `run_in_background`
 *      ⇒ 同样在任务结束/失败时清理子进程，模拟器活不过一轮。
 *
 *   ③ `cmd //c "start ..."`（batch 脚本）
 *      ⇒ 写法上有两个坑：`.bat` 里含中文路径会被 GBK 码页读坏
 *        （实测 `[用户名已脱敏]` 变成 `[用户名已脱敏]`）；且 `start` 的参数引号经
 *        bash→cmd 两层转义后容易变形（实测 `"system-images;..."`
 *        被当成字面量传进去，报 "Failed to find package"）。
 *
 *   ④ PowerShell `Start-Process`
 *      ⇒ **本机环境下必失败**：PS 5.1 构造环境字典时按大小写不敏感判重，
 *        而当前环境里同时存在 `http_proxy`/`HTTP_PROXY`、`PATH`/`Path`，
 *        于是抛 `ArgumentException: 已添加项。字典中的关键字:"PATH"...`。
 *        （去掉大写那组后会撞上下一个重复键，治不完。）
 *
 * ⇒ 最终用 Node 的 `spawn(detached: true)` + `unref()`：
 *   这是"创建独立进程组并放手"的标准做法，不经 shell、不受码页影响、
 *   不需要删任何文件，且日志直接重定向到文件（**不用管道** ——
 *   管道会让父进程持有句柄，再次导致连带清理）。
 *
 * 用法：
 *   node scripts/qa/launch-emulator.mjs                 # 默认：-accel off（本机 WHPX 不可用）
 *   node scripts/qa/launch-emulator.mjs --accel on      # 强行用 WHPX
 *   node scripts/qa/launch-emulator.mjs --wait 900      # 启动后最多等 900 秒到 boot_completed
 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const SDK = path.join(HOME, '.workbuddy', 'android-toolchain', 'sdk');
const EMULATOR = path.join(SDK, 'emulator', 'emulator.exe');
const ADB = path.join(SDK, 'platform-tools', 'adb.exe');
const AVD = process.env.AVD_NAME ?? 'ai-ai_api34';
const TMP = path.join(ROOT, '.qa-tmp');
const LOG = path.join(TMP, 'emulator.log');

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return process.argv.includes(`--${name}`) ? true : dflt;
};

/**
 * 默认 `-accel off` + **绕过启动器直接跑 qemu**。
 *
 * ★ 实测依据（本机 AMD Ryzen 7 9700X + Windows 11 26200 + 宿主机已运行 Hyper-V）：
 *
 *   | 启动方式                                | 结果                          |
 *   |-----------------------------------------|-------------------------------|
 *   | `emulator.exe`（默认 WHPX）              | 退出码 **21**，日志停在 accelerator 之后 |
 *   | `emulator.exe -accel off -verbose`       | 退出码 **21**，同样死在同一处 |
 *   | **直接 `qemu-system-x86_64-headless.exe -accel off`** | 跑满 60s（退出码 124）**可用** |
 *
 *   ⇒ 两个结论：
 *     ① 硬件加速在本机不可用（已知的 AMD + Win11 WHPX 兼容问题，且需管理员才能改）；
 *     ② **启动器本身**在 `-accel off` 下也会以 21 退出（它把参数转给 qemu 的方式有问题），
 *        所以真正能用的路径是**绕过启动器、直接跑 qemu 二进制**。
 *        这一点是"对比三种启动方式"才发现的 —— 只看启动器的日志会误判成"又是 WHPX 问题"。
 */
const DIRECT_QEMU = arg('direct', true) !== false;
const ACCEL = arg('accel', 'off');
const WAIT_SEC = Number(arg('wait', 1800));

/** qemu 二进制（直接用它可以绕开启动器的参数转换问题） */
const QEMU = path.join(SDK, 'emulator', 'qemu', 'windows-x86_64', 'qemu-system-x86_64-headless.exe');

const args = [
  '-avd', AVD,
  '-no-window',            // 无交互桌面
  '-no-audio',
  '-no-boot-anim',
  '-gpu', 'swiftshader_indirect',  // 软件渲染：远程/无独显会话下最稳
  '-no-snapshot',          // 冷启动，避免快照残留状态干扰验收
  '-no-metrics',
  '-accel', ACCEL,
  '-memory', '2048',
  '-cores', '2',
];

const exe = DIRECT_QEMU ? QEMU : EMULATOR;
const cwd = DIRECT_QEMU ? path.dirname(QEMU) : path.join(SDK, 'emulator');

mkdirSync(TMP, { recursive: true });

console.log(`\n═══ 启动模拟器 ═══`);
console.log(`  AVD     ${AVD}`);
console.log(`  可执行  ${exe}`);
console.log(`  加速    -accel ${ACCEL}${ACCEL === 'off' ? '（纯软件模拟，启动较慢）' : ''}`);
console.log(`  日志    ${LOG}\n`);

/**
 * detached + unref + stdio 指向**文件描述符**（不是管道、也不是同一个 WriteStream 传两次）：
 *   - detached：创建新进程组，父进程退出不会连坐
 *   - unref：让 Node 事件循环不再等待它，自己可以正常退出
 *   - fd：不走管道，父进程不持有通道
 *
 * ★ 用 `openSync` 拿 fd，而**不是**把同一个 `WriteStream` 对象传给
 *   `stdio` 的 out 和 err 两位 —— 那样 Node 会抛
 *   `ERR_INVALID_ARG_VALUE`（getValidStdio 阶段），因为同一个流实例
 *   不能被占两次。踩过一次。
 */
const logFd = openSync(LOG, 'w');
const child = spawn(exe, args, {
  cwd,
  detached: true,
  stdio: ['ignore', logFd, logFd],
  env: {
    ...process.env,
    ANDROID_HOME: SDK,
    ANDROID_SDK_ROOT: SDK,
    ANDROID_AVD_HOME: path.join(HOME, '.android', 'avd'),
  },
});
child.unref();

console.log(`已启动（PID ${child.pid}），进程已脱离本脚本。`);

if (WAIT_SEC <= 0) process.exit(0);

/* ─────────── 等待开机完成 ─────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adb(args2, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const p = spawn(ADB, args2, { stdio: ['ignore', 'pipe', 'pipe'] });
    let s = '';
    p.stdout.on('data', (d) => (s += d));
    p.stderr.on('data', (d) => (s += d));
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on('close', () => {
      clearTimeout(t);
      resolve(s);
    });
    p.on('error', () => {
      clearTimeout(t);
      resolve('');
    });
  });
}

console.log(`开始等待开机（最多 ${WAIT_SEC}s，纯软件模拟较慢，请耐心）…`);
const t0 = Date.now();
let ok = false;
while ((Date.now() - t0) / 1000 < WAIT_SEC) {
  const st = (await adb(['-s', 'emulator-5554', 'shell', 'getprop', 'sys.boot_completed'])).trim();
  const el = Math.round((Date.now() - t0) / 1000);
  if (st === '1') {
    console.log(`\n✓ 开机完成（用时 ${el}s）`);
    ok = true;
    break;
  }
  // 每 15 秒报一次进度，避免"看起来卡死"
  if (el % 15 === 0) {
    const dev = (await adb(['devices'])).split('\n').filter(Boolean).slice(1).join(' / ') || '(无设备)';
    console.log(`  [${el}s] boot_completed=${st || '(空)'}  devices: ${dev}`);
  }
  await sleep(5000);
}

if (!ok) {
  console.log(`\n✗ ${WAIT_SEC}s 内未完成开机。`);
  console.log(`  日志尾部请查看：${LOG}`);
  process.exit(1);
}

console.log(`  设备信息：${(await adb(['-s', 'emulator-5554', 'shell', 'getprop', 'ro.build.version.release'])).trim()} / API ${(await adb(['-s', 'emulator-5554', 'shell', 'getprop', 'ro.build.version.sdk'])).trim()}`);
console.log(`  ABI：${(await adb(['-s', 'emulator-5554', 'shell', 'getprop', 'ro.product.cpu.abi'])).trim()}`);
process.exit(0);
