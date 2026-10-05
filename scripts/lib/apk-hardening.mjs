/**
 * ★★ APK 加固的**验收**（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个模块回答一个问题：**"加固到底生效了没有？"**
 * ═══════════════════════════════════════════════════════════════════════════
 * 加固最危险的状态不是"没做"，而是**"以为做了"**：
 *   `minifyEnabled true` 是写进 `build.gradle` 了，但可能被后面的 flavor
 *   覆盖、可能因为 keep 规则写得太宽而什么都没改名 ——
 *   构建照样成功，日志照样打出"✓ 完成"，而包里还是那份带完整包名的 dex。
 *   ⇒ 所以加固必须有**从产物反推**的断言，不能只看配置。
 *
 * ── 判据从哪来（每一条都是实测定下来的，不是猜的）────────────────────────
 * 基线取 **v11**（未加固的最后一版），实测它的 `classes.dex`：
 *   · 大小 **6839 KB**
 *   · 字符串 `com/getcapacitor` 出现 **132 次**
 *   · `com/getcapacitor/Bridge` 出现 33 次
 *   · `res/` 路径**本来就是短名**（`res/0K.xml`）—— AGP 的资源改名默认已开，
 *     所以"资源改名"不是本次新增收益，本模块不把它算作加固成绩（免得虚报）。
 *
 * ── 断言分两类，别混 ────────────────────────────────────────────────
 *   · **硬断言（失败 = 拒绝打包）**：都能从产物直接读出、且不会因环境抖动而假红。
 *   · **指标（只记录、不判死）**：用于跨版本对比（写进 MANIFEST），
 *     例如 dex 字节数 —— 它的绝对值会随功能增加而变大，
 *     拿它当阈值只会在某个版本莫名其妙地红。
 */

import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';

/* ───────────────────────────── zip 读取 ───────────────────────────── */

/** 极简 zip 中央目录解析（只依赖 node 内置；不引第三方包） */
function openZip(filePath) {
  const fd = openSync(filePath, 'r');
  const size = fstatSync(fd).size;
  const tailLen = Math.min(size, 65557);
  const tail = Buffer.alloc(tailLen);
  readSync(fd, tail, 0, tailLen, size - tailLen);

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('不是合法 zip：找不到 EOCD');

  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOff = tail.readUInt32LE(eocd + 16);
  const cd = Buffer.alloc(cdSize);
  readSync(fd, cd, 0, cdSize, cdOff);

  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i += 1) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const rawSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const cmtLen = cd.readUInt16LE(p + 32);
    const localOff = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, rawSize, localOff });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return { fd, entries, size };
}

function closeZip(z) {
  closeSync(z.fd);
}

/** 取单条目的解压后内容 */
function readZipEntry(zip, entry) {
  const head = Buffer.alloc(30);
  readSync(zip.fd, head, 0, 30, entry.localOff);
  const nameLen = head.readUInt16LE(26);
  const extraLen = head.readUInt16LE(28);
  const dataOff = entry.localOff + 30 + nameLen + extraLen;
  const raw = Buffer.alloc(entry.compSize);
  readSync(zip.fd, raw, 0, entry.compSize, dataOff);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`不支持的压缩方式 ${entry.method}（${entry.name}）`);
}

/* ───────────────────────────── SDK 工具定位 ───────────────────────────── */

/**
 * 找 SDK 下的某个 build-tools 可执行文件。
 * ★ 复用 `android/local.properties` 的 `sdk.dir`（AGP 的标准查找方式），
 *   而不是环境变量 —— 理由同 `build-apk.mjs` 里那段注释：
 *   不依赖"谁在什么 shell 里 export 过什么"。
 */
export function findBuildTool(root, toolName) {
  const p = join(root, 'android', 'local.properties');
  if (!existsSync(p)) return null;
  const m = /^sdk\.dir\s*=\s*(.+)$/m.exec(readFileSync(p, 'utf8'));
  if (!m) return null;
  const sdkDir = m[1].trim().replace(/\\/g, '/');
  const btRoot = join(sdkDir, 'build-tools');
  if (!existsSync(btRoot)) return null;
  const ver = readdirSync(btRoot).sort().reverse()[0];
  const ext = process.platform === 'win32' ? '.exe' : '';
  const bin = join(btRoot, ver, `${toolName}${ext}`);
  if (existsSync(bin)) return bin;
  // `apksigner` 在 Windows 上只有 .bat
  const bat = join(btRoot, ver, `${toolName}.bat`);
  return existsSync(bat) ? bat : null;
}

/**
 * 跑一个外挂工具并拿到输出。
 *
 * ★★ 必须用**异步** `execFile`，不能图省事用 `spawnSync`（2026-10-04 实测踩到）。
 *
 * 实测现象：在 **Node 进程内**用 `spawnSync` 起任何子进程（连 `node -v` 都不例外）
 * 一律返回 `EBUSY`、`status=null`、零输出；而同样一条命令
 * ① 从 bash 直接跑 → 正常；② 用**异步** `spawn` / `execFile` → 正常。
 * ⇒ 是"同步创建子进程"这一步被环境挡住的，不是路径、不是权限、也不是沙箱开关
 *   （开不开沙箱都一样）。
 *
 * ★ 这个坑的杀伤力在于**它的表现是"检查静默降级"**：
 *   `runTool()` 返回 `ok:false` ⇒ 调用方只记一条 `⚠️ 未核对` 的 note ⇒
 *   加固验收**照样打印"完成"**。也就是说，一个用 `spawnSync` 写成的检查器，
 *   在有这个限制的机器上等于**永远不检查**，而且看不出来。
 *   ⇒ 所以在 `checkHardening()` 里，凡"工具没跑起来"的 note 都写成 `⚠️`，
 *     并且**不把它当成通过**（不上报"清单未标记 debuggable ✓"这类结论）。
 */
function runTool(bin, args, { timeoutMs = 120000, maxBuffer = 16 * 1024 * 1024, env = {} } = {}) {
  return new Promise((resolve) => {
    /* ★ `.bat` / `.cmd` 在 Windows 上**不能**直接被 CreateProcess 起 ——
     *   `apksigner` 恰恰只有 `.bat`（没有 `.exe`）。
     *   第一版直接传 `.bat` 给 `execFile`，得到 `EINVAL`；
     *   而模块只记了一条 `⚠️ 未核对`，**看起来像环境问题**，
     *   实际是"签名验收从来没跑过"。⇒ 这里显式用 `cmd /c` 包一层。
     *   （这与 `build-apk.mjs` 的 `run()` 在 win32 下默认 `shell: true` 是同一个道理。） */
    const isWin = process.platform === 'win32';
    const isScript = /\.(bat|cmd)$/i.test(bin);
    const realBin = isWin && isScript ? (process.env.ComSpec ?? 'cmd.exe') : bin;
    const realArgs = isWin && isScript ? ['/c', bin, ...args] : args;

    try {
      execFile(
        realBin,
        realArgs,
        { timeout: timeoutMs, maxBuffer, windowsHide: true, encoding: 'utf8', env: { ...process.env, ...env } },
        (e, stdout, stderr) => {
          if (e && e.code === undefined && !stdout && !stderr) {
            // 根本没起来（ENOENT / EBUSY / EACCES…）
            resolve({ ok: false, launched: false, stdout: '', stderr: '', reason: e.code ?? e.message });
            return;
          }
          // ★ 工具"跑起来了但退出码非 0"（例如 apksigner 对一个未签名的包报错）
          //   与"根本没起来"是两件事，必须分开 —— 前者可以解读，后者只能记"未核对"。
          resolve({
            ok: !e,
            launched: true,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            status: e?.code ?? 0,
          });
        },
      );
    } catch (e) {
      resolve({ ok: false, launched: false, stdout: '', stderr: '', reason: e.code ?? e.message });
    }
  });
}

/** 取工具输出的第一行非空内容（用于把失败原因带进 note，而不是只报退出码） */
function firstLine(text) {
  const line = String(text ?? '')
    .split('\n')
    .map((s) => s.trim())
    .find((s) => s !== '');
  return line ?? '';
}

/* ───────────────────────────── 断言用的常量 ───────────────────────────── */

/**
 * 允许保留的 `com/getcapacitor` **字符串出现次数上限**。
 *
 * 为什么是 20（而不是 0）：
 *   · Capacitor 的 consumer keep 规则会保留注解类名（`@CapacitorPlugin` 等），
 *     注解的全限定名会留在 dex 字符串池里；
 *   · 少数框架按名字查找的地方（如 `Plugin` 的包名判定）也会留下若干条。
 *   基线是 **132**，所以 20 这个阈值离基线足够远、离"理论下限"也留了余量 ——
 *   它的作用是**区分"混淆跑了"和"混淆没跑"**，不是追求数字最小。
 */
const CAPACITOR_STRING_BUDGET = 20;

/** 入口类与方法名：加固后**必须**仍然以原名存在（否则应用打不开或返回键失效） */
const MUST_SURVIVE = [
  'com/aiai/builtin/MainActivity',
  'onBackPressed',
  'window.__aiAiBack',
];

/**
 * 检查一个 APK 的加固效果。
 *
 * @returns {Promise<{problems: string[], notes: string[], metrics: Record<string, unknown>}>}
 *   `problems` 非空 ⇒ 调用方应当**拒绝交付这个包**。
 */
export async function checkHardening(apkPath, { root, env } = {}) {
  const problems = [];
  const notes = [];
  const metrics = {};
  // ★ `env` 由调用方传入（`build-apk.mjs` 已经解析过 JAVA_HOME）。
  //   为什么不在这里自己解析 JDK：**JDK 的定位只该有一处实现** ——
  //   两份实现会在某台机器上给出两个答案（一个找到、一个没找到），
  //   于是"签名验收"在构建时通过、在复验时静默跳过。
  //   apksigner 是 `.bat` 包 java，没有 JAVA_HOME 时它只打印一句
  //   `ERROR: JAVA_HOME is not set`，很容易被当成环境噪声放过去。
  const toolEnv = env ?? {};

  if (!existsSync(apkPath)) {
    return { problems: [`APK 不存在：${apkPath}`], notes, metrics };
  }

  /* ── ① 解包看结构与 dex ───────────────────────────────────────────── */
  let zip;
  try {
    zip = openZip(apkPath);
  } catch (e) {
    return { problems: [`打不开 APK（${e.message}）`], notes, metrics };
  }

  try {
    const names = zip.entries.map((e) => e.name);
    metrics.apkBytes = statSync(apkPath).size;
    metrics.zipEntries = names.length;

    /* sourcemap：一个 `.map` 文件等于把源码原样送出去。
       ★ 这条要**硬断言**，因为它是"加固"里最容易在某次配置改动中悄悄失效的一项
         （`sourcemap: true` 是很多人在排障时顺手打开的）。 */
    const maps = names.filter((n) => n.endsWith('.map'));
    if (maps.length > 0) {
      problems.push(
        `APK 里含 sourcemap ${maps.length} 个（例如 ${maps[0]}）——` +
          ` `.repeat(0) +
          '等于把源码一起发出去，必须让构建产物不含 .map',
      );
    }
    metrics.sourcemapCount = maps.length;

    /* dex 规模 */
    const dexEntries = zip.entries.filter((e) => /^classes\d*\.dex$/.test(e.name));
    if (dexEntries.length === 0) {
      problems.push('APK 里没有 classes*.dex —— 这不是一个可安装的应用包');
    }
    let dexBytes = 0;
    for (const e of dexEntries) dexBytes += e.rawSize;
    metrics.dexCount = dexEntries.length;
    metrics.dexBytes = dexBytes;
    metrics.dexKB = Math.round(dexBytes / 1024);

    /* ── ② 从 dex 里反推"混淆到底跑了没有" ─────────────────────────── */
    if (dexEntries.length > 0) {
      // 只扫最大的那个 dex（其余是字符串池溢出的分片，量级很小）
      const biggest = dexEntries.slice().sort((a, b) => b.rawSize - a.rawSize)[0];
      const dex = readZipEntry(zip, biggest);
      // ★ 一次性转成字符串再数 —— 之前对每个探针各转一次，纯浪费
      //   （dex 有 6 MB 量级，转字符串是这里唯一的重活）。
      //   用 latin1 而不是 utf8：dex 里的字符串池**不保证是合法 UTF-8**，
      //   按 utf8 解码遇到非法字节会替换成 U+FFFD，让字节偏移错位、匹配漏掉。
      //   我们查的都是纯 ASCII 的类名，latin1 的逐字节一一映射正好合适。
      const dexText = dex.toString('latin1');
      const count = (needle) => dexText.split(needle).length - 1;

      const capCount = count('com/getcapacitor');
      const bridgeCount = count('com/getcapacitor/Bridge');
      metrics.capacitorStrings = capCount;
      metrics.capacitorBridgeStrings = bridgeCount;

      // ★ 核心断言：混淆跑了 ⇒ `com/getcapacitor` 字符串应当大幅消失。
      //   基线 132（v11 未加固）⇒ 阈值 20。
      if (capCount > CAPACITOR_STRING_BUDGET) {
        problems.push(
          `dex 里 \`com/getcapacitor\` 仍出现 ${capCount} 次（上限 ${CAPACITOR_STRING_BUDGET}）` +
            ` ⇒ R8 混淆**没有生效**，Capacitor / AndroidX 的包名结构原样可读（未加固基线是 132）`,
        );
      } else {
        notes.push(`R8 已生效：dex 里 \`com/getcapacitor\` ${capCount} 次（未加固基线 132）`);
      }

      // ★ 反向断言：必须**保住**的东西一个都不能少。
      //   这一组比上面那条更重要 —— 混淆过度会把应用搞崩，而崩了是看不出来的。
      const missing = MUST_SURVIVE.filter((s) => count(s) === 0);
      if (missing.length > 0) {
        problems.push(
          `dex 里找不到 ${missing.map((m) => `\`${m}\``).join(' / ')} —— ` +
            `入口类 / 返回键覆写 / JS 桥约定被混淆掉了，装上去会**打不开或返回键失效**`,
        );
      } else {
        notes.push(`入口与桥约定完好：${MUST_SURVIVE.join(' · ')} 都还在`);
      }

      // 调试信息（只做记录）：`SourceFile` 属性串在**保留行号**的包里会成片出现
      metrics.sourceFileAttr = count('SourceFile');
    }

    /* ── ③ 资源名是否还是可读的语义路径（记录用，不判死）──────────── */
    //   ★ 为什么不判死：AGP 的资源改名（resource path shortening）默认已开，
    //     但它属于 AGP 行为而不是我们的配置；万一将来某个 AGP 版本关了它，
    //     这里报红会把"加固失败"这个结论引到错误的因果上。
    //     所以只记录，让人**看见**它有没有变。
    const semanticRes = names.filter((n) => /^res\/(layout|drawable|mipmap|values|xml)\//.test(n));
    metrics.semanticResPaths = semanticRes.length;
    metrics.resEntries = names.filter((n) => n.startsWith('res/')).length;
    if (semanticRes.length === 0) {
      notes.push(`资源路径已缩短（res/ 下 ${metrics.resEntries} 个条目，没有可读的 layout/drawable 目录名）`);
    } else {
      notes.push(
        `⚠️ res/ 下仍有 ${semanticRes.length} 个语义路径（如 ${semanticRes[0]}）——` +
          `资源改名没生效，包内结构更容易读`,
      );
    }
  } finally {
    closeZip(zip);
  }

  /* ── ④ 清单属性：allowBackup / debuggable ─────────────────────────── */
  const aapt2 = root ? findBuildTool(root, 'aapt2') : null;
  if (!aapt2) {
    notes.push('⚠️ 找不到 aapt2，`debuggable` / `allowBackup` 未核对（不影响加固结论的其它部分）');
  } else {
    /* ★★ 必须用 `aapt2 dump xmltree` 读**属性值**，不能用 `dump badging`（2026-10-04 实测踩到）。
     *
     * 第一版就是这么写的：在 badging 输出里找 `application-allowbackup` 这个"存在型标志"。
     * 实测 **aapt2 的 badging 根本不输出 allowbackup** —— 于是断言恒为"没找到"，
     * 反过来被解释成 `allowBackup=false` 并打印「已关闭 ✓」。
     * 而当时的测试样本 v11 **恰恰是 `allowBackup=true`**（改之前的值）。
     * ⇒ 一条**静默失效的断言**，报的还是"通过"。这就是本项目反复栽的"假绿"：
     *   判据本身从没被验证过，只是恰好在样本上显示了想要的结果。
     *
     * 现在的判据是**属性值本身**，并区分"显式为 false"与"压根没写"：
     *   · `android:allowBackup` 的**系统默认值是 true** ⇒ 没写 = 有风险，必须报。
     *   · `android:debuggable` 的默认值是 false ⇒ 没写 = 安全。
     *   把默认值写进判据，才不会因为"AGP 顺手把冗余属性删了"而误判。
     */
    const xml = await runTool(aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apkPath], {
      env: toolEnv,
    });
    if (!xml.launched) {
      notes.push(`⚠️ aapt2 没能启动（${xml.reason}），debuggable / allowBackup 未核对`);
    } else if (!xml.ok || xml.stdout.trim() === '') {
      notes.push(`⚠️ aapt2 dump xmltree 无输出（退出码 ${xml.status}），debuggable / allowBackup 未核对`);
    } else {
      const attrPresent = (name) => new RegExp(`:${name}\\(0x[0-9a-f]+\\)=`, 'i').test(xml.stdout);
      const attrTrue = (name) => new RegExp(`:${name}\\(0x[0-9a-f]+\\)=true`, 'i').test(xml.stdout);

      const allowBackup = attrPresent('allowBackup') ? attrTrue('allowBackup') : true; // 缺省即 true
      const debuggable = attrTrue('debuggable'); // 缺省即 false
      metrics.allowBackup = allowBackup;
      metrics.debuggable = debuggable;
      metrics.allowBackupExplicit = attrPresent('allowBackup');

      if (allowBackup) {
        problems.push(
          attrPresent('allowBackup')
            ? 'APK 的 allowBackup=true —— `adb backup` 可一条命令把聊天记录 / 人设 / 记忆库整体导出'
            : 'APK 未显式关闭 allowBackup（系统默认 true）—— `adb backup` 可整库导出应用数据',
        );
      } else {
        notes.push('allowBackup 显式为 false（`adb backup` 整库提取这条路已堵）✓');
      }
      if (debuggable) {
        problems.push('APK 是 debuggable 的 —— 任何人可 attach 调试器读内存，与加固目标直接冲突');
      } else {
        notes.push(
          attrPresent('debuggable') ? '清单里 debuggable=false ✓' : '清单未声明 debuggable（默认即 false）✓',
        );
      }
    }
  }

  /* ── ⑤ 签名：v2 / v3 必须在（拦"解包→改→重打包"的那一道）──────────── */
  const apksigner = root ? findBuildTool(root, 'apksigner') : null;
  if (!apksigner) {
    notes.push('⚠️ 找不到 apksigner，签名方案未核对');
  } else {
    const r = await runTool(apksigner, ['verify', '--verbose', apkPath], { env: toolEnv });
    if (!r.launched) {
      notes.push(`⚠️ apksigner 没能启动（${r.reason}），签名方案未核对`);
    } else {
      const out = r.stdout + r.stderr;
      // ★ 未签名：`apksigner verify` 会以非 0 退出并打印这类信息。
      //   这是**已知且允许**的状态（没有 keystore 的构建），
      //   但它意味着"这个包装不上"，必须说出来，不能沉默。
      const unsigned = /does not have a signature|Missing signature|not signed/i.test(out);
      if (unsigned) {
        notes.push('⚠️ APK 未签名（没有 keystore）—— 这种包**装不上**，只适用于编译自检');
        metrics.signature = 'unsigned';
      } else if (!r.ok) {
        /* ★★ 这一条**必须**是硬失败，不能只记 note（2026-10-04 实测踩到）。
         *
         * 第一版把"apksigner 退出码非 0"记成 note，于是：
         *   v12/v13 两个包的实际签名验证结果是
         *     `DOES NOT VERIFY` + `ERROR: Missing META-INF/MANIFEST.MF`，
         *   而构建日志最后打印的是 **"✓ 版本特征、清单与加固均正确"**。
         *   ——一个**装不上**的包，通过了全部验收。
         *
         * 根因是加固时关掉了 v1 签名，而 `minSdkVersion=23` 只认 v1。
         * ⇒ 教训不是"别关 v1"，而是：**"工具跑起来了但结论是否"这种失败
         *   不能被降级成提示**。区分"没能执行"（环境问题，可以适当宽容）
         *   与"执行了、结论是坏的"（真实缺陷，必须拦住），是这一整段代码的分界线。
         */
        problems.push(
          `apksigner 验证**未通过**（退出码 ${r.status}）：` +
            `${firstLine(r.stderr) || firstLine(r.stdout) || '(无输出)'}` +
            ` —— 这种包在真机上会**装不上**或被拒装，绝不能交付`,
        );
        metrics.signature = 'invalid';
      } else {
        const v2 = /Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(out);
        const v3 = /Verified using v3 scheme \(APK Signature Scheme v3\): true/.test(out);
        const v1 = /Verified using v1 scheme \(JAR signing\): true/.test(out);
        metrics.signature = { v1, v2, v3 };
        // ★ 硬断言**只要 v2 或 v3 有一个在**就够了（AGP 版本不同会用 v3 或 v3.1）。
        //   不把"v1 必须关掉"做成硬断言 —— 关 v1 是一条**安全余地**而非必需，
        //   而且部分安装器仍会看它。
        if (!v2 && !v3) {
          problems.push('APK 只有 v1（JAR）签名，没有 v2/v3 —— 整包摘要保护缺失，可被逐条篡改后重签');
        } else {
          notes.push(`签名方案 v1=${v1} v2=${v2} v3=${v3}（v2/v3 是整包摘要，挡得住重新打包）`);
        }
      }
    }
  }

  return { problems, notes, metrics };
}
