/**
 * ★ 文案自检脚本（`npm run lint:copy`）——架构文档 §6.8 第四道防线（CI 防线）。
 *
 * ★★ 判据（2026-10-04 定稿，§6.8 第 4 条）：**按信息流向归类，不按语法形式归类**。
 *   A 档（用户面向）**不看字符种类，看取值方式**——是不是经 `t()` / 域内表取值函数取的。
 *   旧的「连续 ≥4 个中文字符」判据对**英文泄漏 100% 静默**（用户看到一句没头没尾的英文，
 *   比看到中文更糟），因此降级为**兜底**，不再是 A 档主判据。
 *
 * 两条扫描：
 *   1. **A 档取值方式扫描（主判据）**：只看「A 档出口位置」上的实参——
 *      `new AppError(code, message)` / `new Error(message)` / `mergeReport(..., reason)` /
 *      `pushItem(..., reason)` / `snack.raw(message)`。
 *      若该实参是字符串字面量（中英文都算）而不是 `t()` 调用，即告警。
 *      ★ 必须限定在这些出口位置：**不能全文件扫字符串字面量**，否则 CSS 类名、存储键、
 *        discriminant、`dayjs` format 模板会全量误报（§6.8 明确要求）。
 *   2. **CJK 兜底扫描**：连续 ≥4 个中文字符（沿用旧规则），用于兜住第 1 条没覆盖到的位置。
 *
 * 档位（§6.8 三档）：A 用户面向（默认，从严）/ B 开发者面向 / C 投喂 LLM。
 *   声明方式二选一，文件内标记优先：
 *   - 文件前 40 行内写 `@copy-tier B` / `@copy-tier C`（推荐，跟文件走）；
 *   - 落在下面的 `TIER_B_PREFIXES` / `TIER_C_PREFIXES` 清单里。
 *   ★ 扫描范围提醒（§6.8）：扫描目录外的 A 档文件**必须显式列入** `EXTRA_TIER_A_FILES`
 *     （`src/persona/importer.ts`、`src/backup/import.ts` 都在扫描目录外却属 A 档）。
 *
 * 退出码：默认 0（只告警不阻断），加 `--strict` 时存在告警返回 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { COPY_TABLES } from '../src/copy/registry';
import { ALL_FEATURE_IDS } from '../src/constants/featureIds';

const ROOT = path.resolve(process.cwd());
const SCAN_DIRS = ['src/features', 'src/components'];
const EXCLUDE_DIRS = ['src/copy', 'node_modules', 'dist'];
const EXTENSIONS = ['.ts', '.tsx'];
/** 连续中文阈值（仅用于兜底扫描） */
const MIN_CJK_RUN = 4;
/** 档位标记只在文件头部找，避免正文里出现同名字符串被误读 */
const TIER_MARKER_HEAD_LINES = 40;

/**
 * 扫描目录之外的 A 档文件（§6.8：「导入类文件需显式列入 A 档清单」）。
 * 判定依据：message → `ImportReport.reason` → 导入对话框渲染，属用户面向。
 */
const EXTRA_TIER_A_FILES: readonly string[] = ['src/persona/importer.ts', 'src/backup/import.ts'];

/** B 档（开发者面向，允许中文）：整文件豁免 */
const TIER_B_PREFIXES: readonly string[] = [
  'src/features/crash/',
  'src/features/settings/DeveloperPage.tsx',
  'src/features/settings/DiagnosisPage.tsx',
];

/** C 档（投喂 LLM，允许中文且禁止改走文案表）：整文件豁免 */
const TIER_C_PREFIXES: readonly string[] = ['src/persona/segments/', 'src/distill/prompts/'];

type Tier = 'A' | 'B' | 'C';

export type CopyIssueKind = 'sink' | 'cjk';

export interface CopyIssue {
  file: string;
  line: number;
  text: string;
  /** 命中方式：`sink` = A 档出口取值方式；`cjk` = 中文兜底 */
  kind: CopyIssueKind;
  /** 命中的出口说明（仅 sink） */
  sink?: string;
  /** 出口通路（仅 sink）：`direct` 直进 DOM / `throw` 待人工确认流向 */
  severity?: 'direct' | 'throw';
}

/**
 * A 档出口位置：命中「位置」而非「字符种类」。
 * `severity` 区分两条通路，便于人工判断优先级（§6.8「主/次通路」口径）：
 * - `direct`：message 直进 DOM（`ImportReport.reason` 逐条渲染 / toast）——**确定用户可见**；
 * - `throw` ：`new AppError/Error` 的 message 位——是否进 DOM 取决于下游有没有吃 `.message`
 *   （`backup/import.ts` 的 `failReason()` 已转成 `t(copyKeyForError(code))`，就不进 DOM）。
 *   §6.8 定「A 档文件里的 throw 不豁免」，所以照样报，但标为待人工确认流向。
 */
interface Sink {
  /** 出口说明（给人看） */
  label: string;
  /** 调用点匹配 */
  call: RegExp;
  /** 要检查的实参下标；`last` 表示最后一个实参 */
  arg: number | 'last';
  severity: 'direct' | 'throw';
}

const SINKS: readonly Sink[] = [
  { label: 'new AppError(code, message)', call: /\bnew\s+AppError\s*\(/g, arg: 1, severity: 'throw' },
  { label: 'new Error(message)', call: /\bnew\s+Error\s*\(/g, arg: 0, severity: 'throw' },
  { label: 'mergeReport(..., reason)', call: /\bmergeReport\s*\(/g, arg: 'last', severity: 'direct' },
  { label: 'pushItem(..., reason)', call: /\bpushItem\s*\(/g, arg: 'last', severity: 'direct' },
  { label: 'snack.raw(message)', call: /\braw\s*\(/g, arg: 0, severity: 'direct' },
];

/**
 * 「看起来像标识符 / 文案 key / 存储键 / CSS 类名」的字符串。
 * 这类不是面向用户的句子，豁免——否则 `'IMPORT_INVALID'` / `'monospace'` 会全量误报。
 * ★ 只对**句子形态**的出口生效；JSX 属性位另用 `isAttrProse()`（单词在那里也是文案）。
 */
const NON_PROSE_RE = /^[A-Za-z_][\w.:/-]*$/;

/**
 * JSX 属性位出口（software-engineer-2 反馈补入）。
 *
 * 旧判据（数连续中文）对 `label="provider"` 这类**单词型英文**100% 静默，
 * 而它就渲染在表单标签上。属性位不能用句子判据——单词恰恰是这里的泄漏形态。
 */
const JSX_ATTRS: readonly string[] = [
  'aria-label',
  'label',
  'title',
  'placeholder',
  'helperText',
  'secondary',
  'primary',
  'message',
  'description',
  'desc',
  'hint',
  'alt',
];

const JSX_ATTR_RE = new RegExp(
  `\\b(?:${JSX_ATTRS.join('|')})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*(['"\`])([^\\3]*?)\\3\\s*\\})`,
  'g',
);

/**
 * ★ 传染规则（software-engineer-2 提议，2026-10-04 落地）：
 * 出口常常**不在本文件**——`pushItem(report, name, ok, reason)` 的 outlet 是另一个文件的
 * 「原因：{reason}」。只认硬编码的 outlet 名单，换个写法就又静默了。
 * 因此改为**按形参名传染**：本文件里声明的函数，若形参名命中下面的词，
 * 则调用它时对应位置的实参一律当成 A 档出口检查（不看调用点叫什么）。
 */
const TAINT_PARAM_RE = /^(reason|message|title|desc|description|hint|label)$/i;

/** 函数声明（含箭头函数常量）：抽出「名字 → 被污染的形参下标」 */
const FUNC_DECL_RE = /\b(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
const ARROW_DECL_RE = /\bconst\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(?\s*([^)]*?)\s*\)?\s*(?::[^=]+)?=>/g;

/**
 * 能力编号权威清单（software-engineer-2 裁决：豁免要用**成员检查**，不用正则）。
 *
 * 用 `^[A-Z]{2}-\d{2}$` 豁免有两个洞：① 拼错的编号（`SZ-02` / `PL-60`）照样被放过，
 * 而「引用了不存在的能力编号」恰恰是最该报的一类错；② 将来真要加一条编号样式的文案，
 * 也会被一起豁免掉。改成成员检查后顺带白捡一个编号存在性检查。
 */
const FEATURE_ID_SET: ReadonlySet<string> = new Set<string>(ALL_FEATURE_IDS);

/** 纯符号（含中文标点）残留：`：·—←%` 这类不构成文案 */
const SYMBOL_ONLY_RE = /^[\s\d.,:%\-+*/()<>[\]{}"'!?·—…←→：，。、；！？|]*$/;

/**
 * 属性位的值是否算面向用户。
 *
 * ★ 关键一步：**先剥掉所有 `${...}` 插值再判**——
 * `` label={`${cl('level.full')} ${audit.byLevel.full}`} `` 这种「文案全来自取值函数」的
 * 写法，剥完什么都不剩，不该报；剥完还剩英文单词的才是真泄漏。
 * 技术占位符（URL / `sk-` / 能力编号 `SV-02`）也不算面向用户的文案。
 */
function isAttrProse(value: string): boolean {
  let stripped = value.trim();
  if (stripped.length === 0) return false;
  // 插值可能嵌套（三元里再套模板串），反复剥到稳定
  for (let i = 0; i < 3; i += 1) {
    const next = stripped.replace(/\$\{[^}]*\}/g, '').trim();
    if (next === stripped) break;
    stripped = next;
  }
  if (stripped.length === 0) return false;
  if (SYMBOL_ONLY_RE.test(stripped)) return false;
  // 这两个是技术占位符：没有权威清单可查，用前缀正则是对的
  if (/^https?:\/\//i.test(stripped)) return false;
  if (/^sk-[.\w-]*$/i.test(stripped)) return false;
  // 编号形态：**确有其项**才豁免；拼错的编号照报（顺带查出引用了不存在的能力项）
  if (/^[A-Z]{2}-\d{1,3}$/.test(stripped)) return !FEATURE_ID_SET.has(stripped);
  return true;
}

/** 按顶层逗号切形参，去掉类型标注与默认值 */
function splitParams(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of raw) {
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((p) => p.split(':')[0].split('=')[0].replace(/\.\.\./, '').trim());
}

/** 收集本文件里「形参名被污染」的函数：`函数名 → 需检查的实参下标` */
function collectTaintDecls(code: string): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const collect = (name: string, params: string): void => {
    const indices: number[] = [];
    splitParams(params).forEach((param, index) => {
      if (TAINT_PARAM_RE.test(param)) indices.push(index);
    });
    if (indices.length > 0) map.set(name, indices);
  };
  for (const m of code.matchAll(FUNC_DECL_RE)) collect(m[1], m[2] ?? '');
  for (const m of code.matchAll(ARROW_DECL_RE)) collect(m[1], m[2] ?? '');
  return map;
}

/** 把注释替换成等长空格（保留换行，保证行号与偏移不漂移）；同时跳过字符串内部 */
function blankComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1] ?? '';

    if (inLine) {
      out.push(ch === '\n' ? '\n' : ' ');
      if (ch === '\n') inLine = false;
      i += 1;
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        out.push('  ');
        i += 2;
        inBlock = false;
        continue;
      }
      out.push(ch === '\n' ? '\n' : ' ');
      i += 1;
      continue;
    }
    if (quote !== null) {
      out.push(ch);
      if (ch === '\\') {
        out.push(next);
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      out.push('  ');
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      out.push('  ');
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out.push(ch);
      i += 1;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join('');
}

/** 找出一行里所有「连续 ≥N 个中文」的片段（兜底扫描用） */
function findCjkRuns(code: string, min: number): string[] {
  const runs: string[] = [];
  const re = /[㐀-䶿一-鿿]{1,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[0].length >= min) runs.push(m[0]);
  }
  return runs;
}

/** 从 `openIdx`（`(` 的位置）起切出顶层实参列表；括号不匹配返回 null */
function splitArgs(code: string, openIdx: number): string[] | null {
  if (code[openIdx] !== '(') return null;
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = openIdx; i < code.length; i += 1) {
    const ch = code[i];
    if (quote !== null) {
      current += ch;
      if (ch === '\\') {
        current += code[i + 1] ?? '';
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      if (depth === 1) continue;
      current += ch;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) {
        args.push(current);
        return args;
      }
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 1) {
      args.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  return null;
}

/** 抽出实参里所有字符串字面量的内容（含模板串） */
function literalContents(arg: string): string[] {
  const out: string[] = [];
  const re = /'([^']*)'|"([^"]*)"|`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(arg)) !== null) {
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    out.push(value);
  }
  return out;
}

/** 是否是「面向用户的句子」：不是标识符/key，且有一定信息量 */
function isProseLiteral(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // 纯占位符（模板串里的 `${x}` 已被剥掉内容）不算
  if (/^\$\{[^}]*\}$/.test(trimmed)) return false;
  if (NON_PROSE_RE.test(trimmed)) return false;
  return true;
}

/** 偏移 → 行号（1 基） */
function lineOf(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i += 1) {
    if (code[i] === '\n') line += 1;
  }
  return line;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (EXCLUDE_DIRS.some((d) => rel.startsWith(d))) continue;
    if (entry.isDirectory()) out.push(...walk(full));
    else if (EXTENSIONS.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/** 注册表里所有「文案表文件」——表文件本身就是字面量的家，豁免兜底扫描（加表即生效，脚本零改动） */
function tableFiles(): Set<string> {
  const files = new Set<string>();
  for (const table of COPY_TABLES) {
    const sources: readonly string[] = table.countFiles ?? [table.path];
    for (const source of sources) {
      for (const m of source.matchAll(/[\w./-]+\.tsx?/g)) {
        files.add(m[0].replace(/^\.\//, ''));
      }
    }
  }
  return files;
}

function resolveTier(rel: string, head: string): Tier {
  const marker = head.match(/@copy-tier\s*([ABC])/);
  if (marker) return marker[1] as Tier;
  if (TIER_B_PREFIXES.some((p) => rel.startsWith(p))) return 'B';
  if (TIER_C_PREFIXES.some((p) => rel.startsWith(p))) return 'C';
  return 'A'; // ★ 未声明 = A 档（从严）
}

/**
 * 扫一份源码（**不读盘**）。
 *
 * ★ `--selftest` 走的就是这条函数——自测必须和实扫用**同一套解析函数**，
 *   否则「自测通过」证明不了「规则还在工作」（software-engineer-2 提议）。
 */
export function scanSource(rel: string, raw: string, tables: ReadonlySet<string>): CopyIssue[] {
  const issues: CopyIssue[] = [];
  const head = raw.split(/\r?\n/).slice(0, TIER_MARKER_HEAD_LINES).join('\n');
  const tier = resolveTier(rel, head);
  // B / C 档整文件豁免（§6.8：Sink 豁免只在已声明 B/C 档的文件内生效）
  if (tier !== 'A') return issues;

  const code = blankComments(raw);

  // 去重：同一个实参可能被「硬编码 outlet」与「形参名传染」同时命中
  const seen = new Set<string>();
  const push = (issue: CopyIssue): void => {
    const key = `${issue.file}:${issue.line}:${issue.sink}:${issue.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  // —— 主判据 ①：A 档出口位置上的取值方式（硬编码 outlet 名单）——
  for (const sink of SINKS) {
    const re = new RegExp(sink.call.source, sink.call.flags.replace('g', '') + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const openIdx = m.index + m[0].length - 1;
      const args = splitArgs(code, openIdx);
      if (!args || args.length === 0) continue;
      const index = sink.arg === 'last' ? args.length - 1 : sink.arg;
      const arg = args[index];
      if (arg === undefined) continue;
      for (const value of literalContents(arg)) {
        if (!isProseLiteral(value)) continue;
        push({
          file: rel,
          line: lineOf(code, m.index),
          text: value.trim(),
          kind: 'sink',
          sink: sink.label,
          severity: sink.severity,
        });
      }
    }
  }

  // —— 主判据 ②：JSX 属性位（单词型英文泄漏的兜口）——
  let jsxMatch: RegExpExecArray | null;
  const jsxRe = new RegExp(JSX_ATTR_RE.source, 'g');
  while ((jsxMatch = jsxRe.exec(code)) !== null) {
    const value = jsxMatch[1] ?? jsxMatch[2] ?? jsxMatch[4] ?? '';
    if (!isAttrProse(value)) continue;
    const attr = /(?:\b|^)(aria-label|label|title|placeholder|helperText|secondary|primary|message|description|desc|hint|alt)\s*=/.exec(
      jsxMatch[0],
    );
    push({
      file: rel,
      line: lineOf(code, jsxMatch.index),
      text: value.trim(),
      kind: 'sink',
      sink: `JSX ${attr?.[1] ?? 'attr'}=`,
      severity: 'direct',
    });
  }

  // —— 主判据 ③：形参名传染（出口在别的文件时也拦得住）——
  const taints = collectTaintDecls(code);
  for (const [name, indices] of taints) {
    const callRe = new RegExp(`\\b${name}\\s*\\(`, 'g');
    let callMatch: RegExpExecArray | null;
    while ((callMatch = callRe.exec(code)) !== null) {
      const args = splitArgs(code, callMatch.index + callMatch[0].length - 1);
      if (!args) continue;
      for (const index of indices) {
        const arg = args[index];
        if (arg === undefined) continue;
        for (const value of literalContents(arg)) {
          if (!isProseLiteral(value)) continue;
          push({
            file: rel,
            line: lineOf(code, callMatch.index),
            text: value.trim(),
            kind: 'sink',
            sink: `${name}(…, 形参名传染 #${index + 1})`,
            severity: 'direct',
          });
        }
      }
    }
  }

  // —— 兜底：CJK 扫描（表文件本身豁免，其余 A 档文件照旧）——
  if (tables.has(rel)) return issues;
  const lines = code.split(/\r?\n/);
  lines.forEach((line, index) => {
    const runs = findCjkRuns(line, MIN_CJK_RUN);
    if (runs.length === 0) return;
    issues.push({ file: rel, line: index + 1, text: runs.join(' / '), kind: 'cjk' });
  });

  return issues;
}

export function checkCopy(): CopyIssue[] {
  const tables = tableFiles();
  const files = [
    ...SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))),
    ...EXTRA_TIER_A_FILES.map((f) => path.join(ROOT, f)),
  ];
  const issues: CopyIssue[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    issues.push(...scanSource(rel, fs.readFileSync(file, 'utf8'), tables));
  }
  return issues;
}

/**
 * `--selftest` 用**内存里的合成源码**（software-engineer-2 提议：绝不落盘成 fixture 文件——
 * 放 `src/` 下要么永久报警，要么得给它开豁免，又多一份例外清单）。
 *
 * 覆盖三种形态：脏实参 / 走取值函数的干净实参 / 另一个形参名；外加编号豁免的正反两面。
 */
const SELFTEST_SRC: string = [
  'function pushItem(report: R, name: string, ok: boolean, reason?: string): void {}',
  'pushItem(r, \'x\', true, `${n} blob(s) failed`);',
  'pushItem(r, \'x\', true, t(\'err.importInvalid\'));',
  'function logIt(message: string): void {}',
  'logIt(\'raw english\');',
  `<Chip label="${ALL_FEATURE_IDS[0]}" />`,
  '<Chip label="SZ-99" />',
].join('\n');

/** 期望命中的行号（1 基） */
const SELFTEST_EXPECTED_LINES: readonly number[] = [2, 5, 7];

/** 自测：命中集合必须与期望**完全一致**，多一个少一个都算失败 */
export function runSelfTest(): number {
  const hits = scanSource('selftest://fixture.tsx', SELFTEST_SRC, new Set<string>());
  const lines = [...new Set(hits.map((h) => h.line))].sort((a, b) => a - b);
  const ok =
    lines.length === SELFTEST_EXPECTED_LINES.length &&
    lines.every((line, i) => line === SELFTEST_EXPECTED_LINES[i]);

  const log = (line: string): void => {
    // eslint-disable-next-line no-console
    console.log(line);
  };

  if (ok) {
    log(`[selftest] 通过：传染规则/取值函数/编号豁免 三组断言全部命中（行 ${lines.join(', ')}）。`);
    return 0;
  }
  log(`[selftest] 失败：期望命中行 ${SELFTEST_EXPECTED_LINES.join(', ')}，实际 ${lines.join(', ') || '(无)'}`);
  for (const hit of hits) {
    log(`  实际命中 ${hit.line}  →  ${hit.sink ?? hit.kind} = ${hit.text}`);
  }
  log('  含义：解析逻辑被改动后规则可能已静默失效，请修复后再跑。');
  return 1;
}

/** CLI 入口 */
function main(): void {
  if (process.argv.includes('--selftest')) {
    process.exitCode = runSelfTest();
    return;
  }
  const strict = process.argv.includes('--strict');
  const issues = checkCopy();
  const sinkIssues = issues.filter((i) => i.kind === 'sink');
  const directIssues = sinkIssues.filter((i) => i.severity === 'direct');
  const throwIssues = sinkIssues.filter((i) => i.severity === 'throw');
  const cjkIssues = issues.filter((i) => i.kind === 'cjk');
  const warn = (line: string): void => {
    // eslint-disable-next-line no-console
    console.warn(line);
  };

  if (issues.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[lint:copy] 没有发现硬编码的文案，很好。');
    return;
  }

  if (directIssues.length > 0) {
    warn(`[lint:copy] ★ 确定进 DOM：A 档出口非 t() 取值的字符串字面量 ${directIssues.length} 处（中英文都算）：`);
    for (const issue of directIssues) {
      warn(`  ${issue.file}:${issue.line}  →  ${issue.sink} = ${issue.text}`);
    }
  }
  if (throwIssues.length > 0) {
    warn(
      `[lint:copy] throw message 位 ${throwIssues.length} 处（§6.8：A 档 throw 不豁免，但是否进 DOM 需人工确认流向）：`,
    );
    for (const issue of throwIssues) {
      warn(`  ${issue.file}:${issue.line}  →  ${issue.sink} = ${issue.text}`);
    }
  }
  if (cjkIssues.length > 0) {
    warn(`[lint:copy] CJK 兜底扫描命中 ${cjkIssues.length} 处（连续 ≥${MIN_CJK_RUN} 中文）：`);
    for (const issue of cjkIssues) {
      warn(`  ${issue.file}:${issue.line}  →  ${issue.text}`);
    }
  }
  warn('提示：面向用户的文案请走取值函数（主表 t() / 各域内表取值函数）。');

  if (strict) process.exitCode = 1;
}

main();
