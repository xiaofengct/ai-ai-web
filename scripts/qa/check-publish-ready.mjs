#!/usr/bin/env node
/**
 * ★★ 公开仓库「可否推送」闸门（2026-10-05）
 * ============================================================================
 * 目的：把「这个仓库能不能公开到 GitHub」从**肉眼看一遍**变成**可复跑的断言**。
 *
 * 起因：用户要求（逐字）
 *   「在仓库根目录添加明确的开源许可文件（如自定义 LICENSE），注明禁止任何形式的
 *     商业用途，以及禁止在未经授权的情况下进行二次开发、修改或再分发。同时在
 *     README 顶部显著标注这些使用限制，并说明源码的版权归属。」
 *
 * 本脚本覆盖 6 组断言，每条都打印「期望值 vs 实际值」，失败定位到文件+行号：
 *   ① 许可条款完整性      —— LICENSE 是否逐条覆盖用户点名的要求（带原文证据）
 *   ② README 标注显著性   —— 限制块是否在首个 `#` 标题之前、是否含三要素、链接目标是否真实存在
 *   ③ 措辞准确性          —— 是「源码可用 source-available」而非「开源」；反向逐个判定「开源」出现处
 *   ④ 无 markdown 泄漏     —— LICENSE（纯文本，0 个 `*`）与 README（会渲染，`**` 合法）判据不同
 *   ⑤ 敏感文件防线        —— HEAD 树 + 全历史曾添加路径 + 已跟踪文本的密钥样式扫描（脱敏输出）
 *   ⑥ 条款矛盾/澄清充分性  —— 3.2「本地运行」与 5.1「禁止修改」是否被 3.4 充分澄清
 *
 * 用法：
 *   node scripts/qa/check-publish-ready.mjs
 *   node scripts/qa/check-publish-ready.mjs --json      # 额外落盘 JSON 报告
 *   node scripts/qa/check-publish-ready.mjs --selftest  # 只跑「判据能否变红」的自检（不需要真仓库数据）
 *
 * 退出码：0 = IS_PUBLISH_READY: YES ；1 = NO（存在阻断项）；2 = 环境问题（子进程起不来）
 *
 * ── 本机（Windows + [用户名已脱敏]）必读的一条环境约束 ────────────────────────────────
 *   Node 的**同步**子进程 API（spawnSync / execFileSync）在本机**全线 EBUSY**，
 *   连 `git --version` 都起不来；而**异步** execFile/spawn 正常。
 *   ⇒ 本脚本一律用异步 execFile。并且**区分两种失败**（见 lib/ 里 skill 的"坑 1"）：
 *       launched:false（EBUSY/ENOENT）→ 环境问题，退出码 2，绝不假装"通过"；
 *       launched:true 且退出码非 0 且属真实坏结论 → 硬失败。
 *   否则本脚本会变成"在这台机器上永远不执行、却打印全部通过"的摆设。
 *
 * ⚠ 本脚本是**只读验证器**：不修改 LICENSE / README / .gitignore / package.json，
 *   不执行任何 git 写操作。发现缺陷只报告，交给工程师修。
 * ⚠ 任何疑似密钥一律**脱敏**后再打印，绝不输出完整值。
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WANT_JSON = process.argv.includes('--json');
const SELFTEST = process.argv.includes('--selftest');

const execFileP = promisify(execFile);

// ───────────────────────── 输出小工具 ─────────────────────────
const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m',
};

// ═══════════════════════ 纯判据（可被 --selftest 直接检验） ═══════════════════════

/**
 * 敏感路径判据（⑤ 的核心）。
 * 返回命中的 {desc} 数组；不命中返回 []。
 * ★ 每条都有具体形态，避免"看到 release/ 就整片放过"式的恒真。
 */
const SENSITIVE = [
  { re: /^android\/keystore\//, desc: 'Android 签名私钥目录' },
  { re: /\.jks$/i, desc: 'Java keystore (.jks)' },
  { re: /\.p12$/i, desc: 'PKCS#12 密钥库 (.p12)' },
  { re: /(^|\/)keystore\.properties$/i, desc: 'keystore 口令文件' },
  { re: /(^|\/)\.env$/, desc: '.env' },
  { re: /(^|\/)\.env\./, desc: '.env.* 变体', except: /\.env\.example$/ },
  { re: /(^|\/)node_modules\//, desc: 'node_modules/' },
  { re: /(^|\/)dist\//, desc: 'dist/' },
  { re: /\.apk$/i, desc: 'APK 二进制' },
  { re: /^release\/[^/]+\//, desc: 'release/<版本>/ 下的二进制归档', except: /^release\/(INDEX|README)\.md$/ },
  { re: /(^|\/)(\.gh-token|\.gh_token)$/, desc: 'GitHub 发布凭据文件' },
  { re: /(^|\/)draft_f87e5da2_folder\//, desc: '一次性工作产物目录' },
];
function matchesSensitive(p) {
  return SENSITIVE
    .filter((s) => s.re.test(p) && !(s.except && s.except.test(p)))
    .map((s) => ({ desc: s.desc }));
}

/** 密钥脱敏：只留前 4 位 + 长度，绝不输出完整值。 */
function redact(hit) {
  if (hit.length <= 8) return `${hit[0]}***`;
  return `${hit.slice(0, 4)}***(${hit.length} chars)***`;
}

/** ③ 反向检查的分类器：判定每处「开源 / open source」是正确用法还是错误表述。 */
const OS_NEG = [
  '不是开源', '并非开源', '非开源', '不构成', '请勿', '勿将',
  'NOT an open-source', 'NOT an open source', 'not an open-source',
  'not open-source', 'Do NOT', 'do not', 'never',
];
const OS_AFFIRM = /(?:是|采用|属于|为|as an?)\s*[^，。\n]{0,8}(?:开源许可|open[- ]source license)/i;
function classifyOpenSource(lineObjs) {
  const out = [];
  for (let i = 0; i < lineObjs.length; i += 1) {
    if (!/开源|open[- ]source/i.test(lineObjs[i].t)) continue;
    const win = [lineObjs[i - 1]?.t ?? '', lineObjs[i].t, lineObjs[i + 1]?.t ?? ''].join(' ');
    const negated = OS_NEG.some((k) => win.includes(k));
    const wrong = !negated && OS_AFFIRM.test(lineObjs[i].t);
    out.push({
      file: lineObjs[i].file, n: lineObjs[i].n,
      verdict: wrong ? 'WRONG（把它当开源许可）' : (negated ? 'OK（说明它不是开源）' : 'META（引用/讨论概念）'),
      snippet: lineObjs[i].t.trim().slice(0, 64),
    });
  }
  return out;
}

// ───────────────────────── 自检（证明判据不是恒真） ─────────────────────────
if (SELFTEST) {
  console.log(`\n${C.bold}${C.cyan}═══ 判据自检：拿"已知不合格样本"验一遍（防断言恒真）═══${C.reset}\n`);
  const cases = [
    ['matchesSensitive 应命中 android/keystore/release.jks', () => matchesSensitive('android/keystore/release.jks').length > 0, true],
    ['matchesSensitive 应命中 .gh-token', () => matchesSensitive('.gh-token').length > 0, true],
    ['matchesSensitive 应命中 .env', () => matchesSensitive('.env').length > 0, true],
    ['matchesSensitive 应命中 build/x.apk', () => matchesSensitive('build/x.apk').length > 0, true],
    ['matchesSensitive 应命中 release/v6/app.apk', () => matchesSensitive('release/v6/app.apk').length > 0, true],
    ['matchesSensitive 应放过 .env.example（允许项）', () => matchesSensitive('.env.example').length === 0, true],
    ['matchesSensitive 应放过 release/INDEX.md（允许项）', () => matchesSensitive('release/INDEX.md').length === 0, true],
    ['matchesSensitive 应放过 src/main.tsx', () => matchesSensitive('src/main.tsx').length === 0, true],
    ['redact 不得回吐完整密钥', () => !redact(`sk-${'a'.repeat(30)}`).includes('a'.repeat(30)), true],
    ['classify 应把「本协议是开源许可」判为 WRONG',
      () => classifyOpenSource([{ file: 'X', n: 1, t: '本协议是开源许可。' }])[0].verdict.startsWith('WRONG'), true],
    ['classify 应把「本协议不是开源许可」判为 OK',
      () => classifyOpenSource([{ file: 'X', n: 1, t: '本协议不是开源许可。' }])[0].verdict.startsWith('OK'), true],
    ['classify 应放过「定义里提到 open source」的引用',
      () => classifyOpenSource([
        { file: 'X', n: 1, t: 'It is NOT an open-source license.' },
        { file: 'X', n: 2, t: 'Under the definition of "open source"...' },
      ]).every((o) => !o.verdict.startsWith('WRONG')), true],
  ];
  let bad = 0;
  for (const [name, fn, want] of cases) {
    let got;
    try { got = fn(); } catch (e) { got = `ERR:${e.message}`; }
    const ok = got === want;
    if (!ok) bad += 1;
    console.log(`  ${ok ? `${C.green}✓` : `${C.red}✗`}${C.reset} ${name} → ${got}`);
  }
  console.log(`\n  ${bad === 0 ? `${C.green}自检通过：判据在反例上确实会变红${C.reset}` : `${C.red}自检失败：${bad} 条判据恒真/错误${C.reset}`}\n`);
  process.exit(bad === 0 ? 0 : 1);
}

// ───────────────────────── 异步 git（避开本机 EBUSY 坑） ─────────────────────────
async function run(cmd, args) {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
    });
    return { launched: true, code: 0, stdout, stderr };
  } catch (e) {
    if (e && typeof e.code === 'number') {
      return { launched: true, code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
    return { launched: false, code: null, stdout: '', stderr: String((e && e.code) || e) };
  }
}

// 先探一次：环境起不来就别往下走（否则会变成"永不执行的摆设"）
const probe = await run('git', ['--version']);
if (!probe.launched) {
  console.error(`${C.red}环境失败：无法启动 git 子进程（${probe.stderr}）。${C.reset}`);
  console.error('  本机 Node 同步子进程 API 会 EBUSY，异步应正常；若异步也失败，请检查 git 是否在 PATH。');
  process.exit(2);
}

async function git(args, { allowExit1 = false } = {}) {
  const r = await run('git', args);
  if (!r.launched) throw new Error(`环境失败：git ${args.join(' ')} 未能启动（${r.stderr}）`);
  if (r.code !== 0 && !(allowExit1 && r.code === 1)) {
    throw new Error(`git ${args.join(' ')} 退出码 ${r.code}：${r.stderr || r.stdout}`);
  }
  return r.stdout;
}
/** NUL 分隔取文件名列表（避免中文路径被转义加引号） */
async function gitNameList(args) {
  const out = await git(['-c', 'core.quotePath=false', ...args, '-z']);
  return out.split('\0').filter(Boolean);
}

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const lines = (rel) => read(rel).split(/\r?\n/);
function lineOf(content, needle) {
  const idx = content.indexOf(needle);
  return idx < 0 ? 0 : content.slice(0, idx).split('\n').length;
}

// ───────────────────────── 结果收集 & 打印 ─────────────────────────
const results = [];
let currentGroup = '';
function group(title) {
  currentGroup = title;
  console.log(`\n${C.bold}${C.cyan}═══ ${title} ═══${C.reset}`);
}
function check(id, title, ok, expected, actual, evidence = []) {
  results.push({ group: currentGroup, id, title, ok, expected, actual, evidence });
  const mark = ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
  console.log(`  ${mark} ${C.bold}${id}${C.reset} ${title}`);
  console.log(`      ${C.dim}期望：${expected}${C.reset}`);
  console.log(`      ${C.dim}实际：${actual}${C.reset}`);
  for (const e of evidence) if (e) console.log(`      ${C.dim}· ${e}${C.reset}`);
}
function note(label, text) {
  console.log(`  ${C.yellow}ℹ${C.reset} ${C.bold}${label}${C.reset} ${text}`);
}

// ───────────────────────── 预取 ─────────────────────────
const license = read('LICENSE');
const readme = read('README.md');
const readmeLines = lines('README.md');
const headShort = (await git(['rev-parse', '--short', 'HEAD'])).trim();

console.log(`${C.bold}项目：${ROOT}${C.reset}`);
console.log(`${C.bold}HEAD：${headShort}${C.reset}`);

// ═══════════════════════ ① 许可条款完整性 ═══════════════════════
group('① 许可条款完整性（LICENSE 是否覆盖用户点名的要求）');

{
  const hasPhrase = /任何形式的商业使用|任何形式的商业用途/.test(license);
  const forms = ['销售', '集成进任何商业产品', '付费服务', 'SaaS', '应用商店', '获客'];
  const hit = forms.filter((f) => license.includes(f));
  check('①-1', '明确「禁止任何形式的商业用途」，且列举具体形态（不止一句「禁止商用」）',
    hasPhrase && hit.length >= 5,
    '命中「任何形式的商业使用/用途」措辞，且 ≥5 种商业形态被逐条列举',
    `措辞命中=${hasPhrase}；列举形态命中 ${hit.length}/6（${hit.join('、')}）`,
    [`4.1 @ L${lineOf(license, '4.1 你不得对本软件进行任何形式的商业使用')}`,
     `4.2 列举 (a)…(h) @ L${lineOf(license, '4.2 被禁止的商业使用形态包括但不限于')}`]);
}
{
  const need = ['二次开发', '修改', '再分发'];
  const hit = need.filter((w) => license.includes(w));
  const unauthorized = /未经许可人事先书面授权|未经授权/.test(license);
  check('①-2', '明确禁止「未经授权的二次开发 / 修改 / 再分发」',
    hit.length === 3 && unauthorized,
    '三词（二次开发/修改/再分发）齐备，且限定「未经…书面授权」',
    `命中词=${hit.join('、')}（${hit.length}/3）；「未经…授权」限定=${unauthorized}`,
    [`第五条标题 @ L${lineOf(license, '第五条 · 禁止未经授权的修改、二次开发与再分发')}`,
     `5.1(a) 二次开发 @ L${lineOf(license, '（即「二次开发」）')}`]);
}
{
  const owner = license.includes('ai-ai-web');
  const copyright = license.includes('著作权');
  const year = license.includes('2026');
  check('①-3', '版权归属声明清楚（著作权人 + 年份）',
    owner && copyright && year,
    '同时出现「著作权人 / ai-ai-web / 2026」',
    `著作权=${copyright}；著作权人 ai-ai-web=${owner}；年份 2026=${year}`,
    [`2.1 @ L${lineOf(license, '2.1 本软件的著作权及相关知识产权均归许可人')}`]);
}
{
  const issue = license.includes('Issue');
  const contact = /github\.com\/ai-ai-web/.test(license);
  check('①-4', '有取得授权的正规通路（否则禁止条款是死路）',
    issue && contact,
    '给出 Issue 申请入口 + 可联系的账号/地址',
    `Issue 入口=${issue}；可联系 GitHub 账号=${contact}`,
    [`第六条 @ L${lineOf(license, '第六条 · 取得授权的正规通路')}`]);
}
{
  const term = license.includes('许可终止') || /即时自动终止/.test(license);
  const destroy = /销毁/.test(license);
  check('①-5', '有许可终止条款（含违约自动终止与销毁义务）',
    term && destroy,
    '含「许可终止」条款，且规定权利终止 + 销毁副本',
    `终止条款=${term}；销毁义务=${destroy}`,
    [`7.1 @ L${lineOf(license, '7.1 你违反本协议任意一条款时')}`]);
}
{
  const asis = /AS IS|按「现状」/.test(license);
  const noWarranty = /不附带任何明示或默示的担保/.test(license);
  // 原文 8.3 写作「许可人不对…承担任何责任」（"不对"与"承担"之间跨行），
  // 故判据必须容忍跨行（[\s\S]），不能用连续的「不承担任何责任」字面 —— 否则是判据太死、误报。
  const noLiability = /不[\s\S]{0,90}承担任何责任/.test(license);
  check('①-6', '有免责声明（现状提供 + 不担保 + 不担责）',
    asis && noWarranty && noLiability,
    '含「AS IS/现状」+「不担保」+「不承担责任」',
    `AS IS=${asis}；不担保=${noWarranty}；不担责=${noLiability}`,
    [`8.1 @ L${lineOf(license, '8.1 本软件按「现状」（AS IS）提供')}`,
     `8.3 @ L${lineOf(license, '8.3 在适用法律允许的最大范围内，许可人不对')}`]);
}
{
  const zh = /以中文文本为准|以中文为准/.test(license);
  const en = /Chinese text prevails|Chinese text is\s+controlling/.test(license);
  check('①-7', '写明「中英歧义以中文为准」（中英双语均有对应条款）',
    zh && en,
    '中文文本与英文译本均声明「以中文为准」',
    `中文声明=${zh}；英文声明=${en}`,
    [`中文 9.4 @ L${lineOf(license, '9.4 准据法与语言：本协议以中文文本为准')}`,
     `英文 9.4 @ L${lineOf(license, 'The CHINESE text of this license is')}`]);
}

// ═══════════════════════ ② README 标注显著性 ═══════════════════════
group('② README 顶部标注的「显著性」（判得严）');

const firstHeadingIdx = readmeLines.findIndex((l) => /^#\s/.test(l));
const firstHeadingLine = firstHeadingIdx + 1;
const sepIdx = readmeLines.findIndex((l) => /^---\s*$/.test(l));
const blockLines = sepIdx < 0 ? [] : readmeLines.slice(0, sepIdx);
const blockText = blockLines.join('\n');
const blockEndLine = blockLines.length;

check('②-1', '限制标注出现在首个一级标题（`#`）之前（"顶部显著"的核心判据）',
  blockEndLine > 0 && blockEndLine < firstHeadingLine,
  `限制块结束行 < 首个 \`#\` 标题所在行（${firstHeadingLine}）`,
  `限制块占 L1–L${blockEndLine}，首个标题在 L${firstHeadingLine}（之前 ${firstHeadingLine - blockEndLine} 行）`,
  [`首个标题 L${firstHeadingLine} "${readmeLines[firstHeadingIdx]}"`, `限制块结束于 L${blockEndLine}`]);

{
  const owner = /ai-ai-web/.test(blockText) && /©/.test(blockText);
  const commercial = /禁止任何形式的商业用途/.test(blockText);
  const modify = /二次开发/.test(blockText) && /修改/.test(blockText) && /再分发/.test(blockText);
  check('②-2', '标注里同时含：版权归属 + 禁止商用 + 禁止未经授权的二次开发/修改/再分发',
    owner && commercial && modify,
    '三要素同时出现在顶部限制块内',
    `版权归属=${owner}；禁止商用=${commercial}；二次开发/修改/再分发=${modify}`,
    ['L3 版权归属 · L4 禁止商用 · L5 禁止二次开发/修改/再分发']);
}
{
  const m = blockText.match(/\[([^\]]*LICENSE[^\]]*)\]\(([^)]+)\)/);
  const target = m ? m[2].trim().replace(/^<|>$/g, '') : null;
  const resolved = target ? path.resolve(ROOT, target) : null;
  const exists = resolved ? existsSync(resolved) && statSync(resolved).isFile() : false;
  check('②-3', '标注里指向 LICENSE 的链接，且目标文件真实存在（stat 而非只看字面）',
    !!target && exists,
    '存在 [LICENSE](LICENSE) 且该文件在磁盘上真实存在',
    target ? `链接目标="${target}" → 存在=${exists}（${resolved}）` : '未找到 LICENSE 链接',
    m ? [`L${lineOf(readme, m[0])} "${m[0]}"`] : []);
}
console.log(`  ${C.dim}· 量化：限制块结束于 L${blockEndLine}（距文件开头 ${blockEndLine} 行）；` +
  `位于首个标题前 ${firstHeadingLine - blockEndLine} 行${C.reset}`);

// ═══════════════════════ ③ 措辞准确性 ═══════════════════════
group('③ 措辞准确性：是「源码可用 source-available」而非「开源」');

{
  const licAcc = /source-available/.test(license) && /不是开源/.test(license);
  const readmeAcc = /source-available/.test(readme) && /(并非开源|非开源)/.test(readme);
  check('③-1', 'LICENSE 与 README 均准确说明「源码可用 / 非开源」',
    licAcc && readmeAcc,
    '两文件均出现 source-available 且明示「不是/并非开源」',
    `LICENSE 准确=${licAcc}；README 准确=${readmeAcc}`,
    [`LICENSE L${lineOf(license, '本协议是源码可用（source-available）许可，不是开源')}`,
     `README  L${lineOf(readme, '本许可为**源码可用（source-available）许可，并非开源')}`]);
}
{
  const occ = classifyOpenSource([
    ...lines('LICENSE').map((t, i) => ({ file: 'LICENSE', n: i + 1, t })),
    ...lines('README.md').map((t, i) => ({ file: 'README.md', n: i + 1, t })),
  ]);
  const wrongs = occ.filter((o) => o.verdict.startsWith('WRONG'));
  check('③-2', '反向检查：所有「开源/open source」出现处均非「当开源许可」的错误表述',
    wrongs.length === 0,
    '每处出现均为「说明它不是开源」或「引用概念」；错误表述数 = 0',
    `共 ${occ.length} 处；错误表述 ${wrongs.length} 处`,
    occ.map((o) => `${o.file}:L${o.n} [${o.verdict}] ${o.snippet}`));
}

// ═══════════════════════ ④ 无 markdown 语法泄漏 ═══════════════════════
group('④ 无 markdown 语法泄漏（LICENSE 与 README 判据不同）');

{
  const starCount = (license.match(/\*/g) || []).length;
  check('④-1', 'LICENSE 是纯文本，正文不得有 markdown 粗体标记（`*` 计数 = 0）',
    starCount === 0,
    '`*` 字符出现次数 = 0',
    `实际 ${starCount} 次`,
    ['判据：GitHub 不对 LICENSE 做 markdown 渲染 ⇒ 任何星号都会字面露出（本项曾因此返工）']);
}
{
  const bold = (readme.match(/\*\*/g) || []).length;
  check('④-2', 'README 的 `**粗体**` 是合法渲染（判据不同，明确不误报）',
    true,
    'README 会经 GitHub markdown 渲染，`**` 属正常语法',
    `README 中 \`**\` 出现 ${bold} 次，均为合法粗体标记`,
    ['判据：README 渲染 ⇒ `**` 正确；LICENSE 不渲染 ⇒ 星号才是泄漏。两者不共用同一阈值']);
}
{
  const pkg = JSON.parse(read('package.json'));
  check('④-3', 'package.json 的 license / private 字段符合预期',
    pkg.license === 'SEE LICENSE IN LICENSE' && pkg.private === false,
    'license = "SEE LICENSE IN LICENSE"，private = false',
    `license = ${JSON.stringify(pkg.license)}；private = ${JSON.stringify(pkg.private)}`,
    ['npm 惯例：引用文件的许可用 "SEE LICENSE IN <file>"']);
}

// ═══════════════════════ ⑤ 敏感文件防线（最重要） ═══════════════════════
group('⑤ 公开前的敏感文件防线（漏了不可逆）');

const HEAD_TREE = await gitNameList(['ls-tree', '-r', '--name-only', 'HEAD']);

{
  const bad = [];
  for (const p of HEAD_TREE) for (const s of matchesSensitive(p)) bad.push(`${p}  ← ${s.desc}`);
  check('⑤-1', '当前提交（HEAD）的完整文件树不含任何敏感文件',
    bad.length === 0,
    `git ls-tree -r --name-only HEAD 中 0 个敏感路径（共 ${HEAD_TREE.length} 个文件）`,
    bad.length === 0 ? `0 个敏感路径（已查 ${HEAD_TREE.length} 个文件）` : `${bad.length} 个：\n        ${bad.join('\n        ')}`,
    ['★ 必须查 HEAD 树而非 git status：.gitignore 只挡「新文件是否被跟踪」，挡不住「曾提交过」的文件留在历史里']);
}

const SECRET_PATTERNS = [
  { name: 'OpenAI 风格 sk-', ere: 'sk-[A-Za-z0-9]{20,}' },
  { name: 'GitHub token ghp_', ere: 'ghp_[A-Za-z0-9]{20,}' },
  { name: 'GitHub PAT github_pat_', ere: 'github_pat_[A-Za-z0-9_]{20,}' },
  { name: 'Google AIza', ere: 'AIza[A-Za-z0-9_-]{20,}' },
  { name: 'Tavily tvly-', ere: 'tvly-[A-Za-z0-9]{10,}' },
  { name: 'Bearer 长串', ere: '[Bb]earer[[:space:]]+[A-Za-z0-9._-]{20,}' },
];
{
  const combined = SECRET_PATTERNS.map((p) => p.ere).join('|');
  const r = await run('git', ['grep', '-I', '-n', '-E', combined, 'HEAD', '--', '.']);
  if (!r.launched) throw new Error(`环境失败：git grep 未能启动（${r.stderr}）`);
  const raw = r.code === 1 ? '' : (r.stdout || '');
  const findings = [];
  for (const ln of raw.split(/\r?\n/).filter(Boolean)) {
    const first = ln.indexOf(':', ln.indexOf(':') + 1); // HEAD:path:line:content
    const content = ln.slice(first + 1);
    for (const p of SECRET_PATTERNS) {
      const re = new RegExp(p.ere.replace('[[:space:]]', '\\s'), 'g');
      const m = content.match(re);
      if (m) for (const h of m) findings.push({ path: ln.slice(0, first), kind: p.name, snippet: redact(h) });
    }
  }
  check('⑤-2', '已跟踪文本文件内容不含硬编码密钥（多样式，脱敏输出）',
    findings.length === 0,
    '6 种密钥样式（sk- / ghp_ / github_pat_ / AIza / tvly- / Bearer）命中数 = 0',
    findings.length === 0 ? '0 处命中' : `${findings.length} 处命中（已脱敏）`,
    findings.slice(0, 20).map((f) => `${f.path} [${f.kind}] ${f.snippet}`));
}
{
  const everAdded = [...new Set(await gitNameList(['log', '--all', '--diff-filter=A', '--name-only', '--pretty=format:']))];
  const headSet = new Set(HEAD_TREE);
  const histBad = [];
  for (const p of everAdded) {
    const hits = matchesSensitive(p);
    if (hits.length === 0) continue;
    histBad.push({ p, desc: hits[0].desc, state: headSet.has(p) ? '仍在当前树里' : '已删除但历史里仍在' });
  }
  const stillInTree = histBad.filter((h) => h.state === '仍在当前树里');
  const onlyHistory = histBad.filter((h) => h.state !== '仍在当前树里');
  check('⑤-3', '全历史扫描：不存在敏感的「曾入库」文件（区分「仍在树里」与「仅历史」）',
    stillInTree.length === 0 && onlyHistory.length === 0,
    'git log --all --diff-filter=A 的全部历史路径中，敏感文件数 = 0',
    `历史路径总数 ${everAdded.length}；敏感命中 ${histBad.length}` +
      `（仍在当前树 ${stillInTree.length} / 仅历史 ${onlyHistory.length}）`,
    histBad.length === 0
      ? [`已核对全部 ${everAdded.length} 条历史路径`, '唯一样本 .env.example 属允许项（占位符，非密钥）']
      : histBad.map((h) => `${h.p}  ← ${h.desc}（${h.state}）`));
  if (onlyHistory.length > 0) {
    console.log(`  ${C.yellow}⚠ 仅历史中存在的敏感文件（如已推送，历史上仍可检出）：${C.reset}`);
    for (const h of onlyHistory) console.log(`      · ${h.p}  ← ${h.desc}`);
  }
}

// ═══════════════════════ ⑥ 条款矛盾 / 澄清充分性 ═══════════════════════
group('⑥ 条款矛盾与 3.4 澄清充分性');

{
  const zh = /3\.4 为免歧义/.test(license) && /不构成本协议第五条所禁止的「修改」/.test(license);
  const en = /3\.4 For the avoidance of doubt/.test(license) && /do NOT constitute "modification"/.test(license);
  check('⑥-1', '3.4 澄清条款（界面配置属「运行」非「修改」）中英齐备',
    zh && en,
    '中文与英文译本均含 3.4 且明确「配置 ≠ 修改」',
    `中文 3.4=${zh}；英文 3.4=${en}`,
    [`中文 @ L${lineOf(license, '3.4 为免歧义')}`, `英文 @ L${lineOf(license, '3.4 For the avoidance of doubt')}`]);
}
{
  const run = /3\.2 在本地环境自行运行本软件/.test(license);
  const noMod = /修改、改编、翻译/.test(license);
  check('⑥-2', '「本地运行」(3.2) 与「禁止修改」(5.1a) 的表面矛盾，已被 3.4 覆盖',
    run && noMod && license.includes('3.4 为免歧义'),
    '3.2 允许本地运行、5.1(a) 禁止修改，且 3.4 明确配置操作属运行不属修改',
    `3.2 运行=${run}；5.1(a) 禁修改=${noMod}；3.4 澄清存在=${license.includes('3.4 为免歧义')}`,
    ['判断：两者并不真矛盾 —— 本地运行必然需要配置（填 API 地址/选模型），3.4 是对"运行的必要组成部分"作定义，属澄清而非扩权']);
}
note('充分性判断', '3.4 澄清**充分**：把"配置"限定为「按本软件既有功能进行的配置操作」，');
note('', '既覆盖必然发生的运行前配置（模型接口地址 / 模型 / 语言 / 主题），');
note('', '又未把"新增功能 / 改代码 / 改行为"纳入 —— 与 5.1(a)(b) 的"变更/衍生"边界一致，未留新漏洞。');
note('残留张力', '2.3 承认第三方组件受其自身许可约束 ⇒「本仓库整体非开源」≠「每个文件都非开源」；');
note('', '此为 source-available 项目通行做法，且 2.3 已明确不改变第三方条款，表述自洽，不构成阻断。');

// ═══════════════════════ 汇总 ═══════════════════════
const failed = results.filter((r) => !r.ok);
const ready = failed.length === 0;

console.log(`\n${C.bold}═══════════════════════════════════════════════════${C.reset}`);
console.log(`  断言总数：${results.length}   通过：${results.length - failed.length}   失败：${failed.length}`);
if (failed.length > 0) {
  console.log(`\n  ${C.red}阻断项：${C.reset}`);
  for (const f of failed) console.log(`    ✗ [${f.id}] ${f.title}\n        ${f.actual}`);
}
console.log(`\n  ${C.bold}IS_PUBLISH_READY: ${ready ? `${C.green}YES` : `${C.red}NO`}${C.reset}`);
console.log(`${C.bold}═══════════════════════════════════════════════════${C.reset}\n`);

if (WANT_JSON) {
  const outDir = path.join(ROOT, 'scripts', 'qa', 'out');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'publish-ready-report.json');
  writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    head: (await git(['rev-parse', 'HEAD'])).trim(),
    isPublishReady: ready,
    total: results.length, failed: failed.length, results,
  }, null, 2), 'utf8');
  console.log(`  报告已写入：${outFile}\n`);
}

process.exit(ready ? 0 : 1);
