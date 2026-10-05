/**
 * 文案表一致性校验（copy 归口人用）。
 *
 * 校验三件事，任一失败即非零退出：
 *   1. `src/copy/registry.ts` 声明的条数 == 源码里实际的条数（防漂移）；
 *   2. 每张表里的每个 key，首段都落在本表声明的 prefixes 内（防越界命名）；
 *   3. 单文件自洽的表（如 distill）key 联合与文案对象条数必须相等。
 *
 * 另外把「两张表声明了同一个前缀」打出来——这是已知且刻意保留的情况（main 与 settings 共有 `ui`），
 * 只在**非白名单**的重复出现时才告警。
 *
 * 用法：
 *   npx tsx scripts/check-copy-tables.ts                      # 校验（verify 链里跑的就是这个）
 *   npx tsx scripts/check-copy-tables.ts --write-baseline     # 把当前条数快照写进 `.copy-baseline.json`
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codeLines } from './lib/scan-source';
import {
  checkCopyTableFilesConsistency,
  COPY_TABLES,
  totalRegisteredByKind,
  totalRegisteredCopyCount,
  type CopyTableRegistration,
} from '../src/copy/registry';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ============================================================================
 * 注册表自检（所有模式先跑）：`files`（机器读）必须与 `path` / `countFiles`（人读）一致。
 *
 * ★ 为什么放在最前、且对**所有**模式生效：`--consumers` 现在**按注册表判定义处**，
 *   若那份清单漂了，工具会**静默给错结论**——错在源头比错在末端难查。
 *   两份描述同一件事的东西一定会漂；漂了就必须红，不许静默取一边。
 * ★ 通过时**不打印任何东西**：主门禁（`lint:copyTables`）的输出格式与退出码保持不变。
 * ========================================================================== */
{
  const fileErrors = checkCopyTableFilesConsistency();
  if (fileErrors.length > 0) {
    console.error('文案表文件清单不一致（`path`/`countFiles` 与 `files` 不符）：');
    for (const e of fileErrors) console.error(`  - ${e}`);
    console.error('⇒ 请把 registry.ts 里的 `files` 与 `path`/`countFiles` 改到一致（两份都必须真）。');
    process.exit(1);
  }
}

/* ============================================================================
 * 模式：`--consumers <key>` —— **改任何一条文案的值之前，先跑它**
 *
 * ★ 归口检查项（software-product-manager 提需求，2026-10-04）：
 *   **凡 key 被 ≥2 处消费、且语义主体不同，改值前必须先枚举全部消费点。**
 *
 *   起因是 `hint.voice`：它同时是
 *     - `VoiceSection.tsx:73` 的**字段级** hint（语义主体＝那一个开关），
 *     - `SettingsPage.tsx:84` 的**分区级** desc（语义主体＝整个语音分区）。
 *   只想改"开关那句"而直接改值，会连带把整个分区描述改掉——
 *   **把"总开关没接线"外推成"整个语音分区不可用"**。
 *
 *   ★ 它和另外两条是同一族，别只记一条：
 *       ① 不许承诺**控制权**（改完的值不得再承诺门控）
 *       ② 不许承诺**未来**（§6.5.3 时间指向可兑现性）
 *       ③ **不许承诺范围**（把字段级事实外推成分区级状态）← 本模式管的就是这条
 *
 * ★ 这类"一个 key 服务两个主体"是**隐性耦合**：平时不响，一改值就污染。
 *   靠人记住不可靠，所以做成一条命令——**不靠自觉，靠跑一下**。
 * ========================================================================== */
const consumersIdx = process.argv.indexOf('--consumers');
if (consumersIdx !== -1) {
  const key = process.argv[consumersIdx + 1];
  if (!key || key.startsWith('--')) {
    console.error('用法：npx tsx scripts/check-copy-tables.ts --consumers <key>');
    console.error('例如：npx tsx scripts/check-copy-tables.ts --consumers hint.voice');
    process.exit(2);
  }

  /** 递归列出 src 下所有 .ts / .tsx */
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
      return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
    });

  // 精确匹配：前后都不能再接 key 字符，避免 `hint.voice` 命中 `hint.voiceMaster`
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /**
   * ★ 边界前瞻必须**同时**挡 `.`（2026-10-04，全量复扫时查出的一处**既有**假阳性）。
   *
   * 原前瞻是 `(?![A-Za-z0-9_-])`，**独独漏了 `.`**，而**后顾** `(?<![A-Za-z0-9_.-])` 里
   * 已经挡了它——**两边不对称**。后果：**自身是另一个 key 前缀的 key 会命中更长的那个**，
   * 例如 `voice.timbre.provider` 命中 `voice.timbre.provider.webSpeech` /
   * `.siliconflow` / `.custom`，凭空多出 6 处命中：
   *   - 旧启发式判据下，这 6 处被算成**消费点**（凭空 6 个消费者）；
   *   - 新判据（注册表驱动）下它们落在声明文件里，被算成**定义处** ⇒ 报 `定义处 8 处`，
   *     正好被"主表 key 定义处恒为 2"这条指纹照出来。
   * ⇒ 补上 `.` 即可。**影响面已核为恰好一个 key**（`voice.timbre.provider`）：
   *   `chat.image` vs `chat.imageGen` 那类后继是**字母**，本来就被挡住了。
   * ★ 前瞻补 `.` **不会造出假阴**：真实消费点后面跟的是 `)` / 引号，不是 `.`。
   */
  const re = new RegExp(`(?<![A-Za-z0-9_.-])${escaped}(?![A-Za-z0-9_.-])`);
  /**
   * ★★ 「是不是定义」由**注册表**决定，不由**行的形状**决定（2026-10-04，team-lead 裁定）。
   *
   * 这里**曾经**是两条行形状启发式：`defRe`（`'key': '…'`，域内表的对象字面量）与
   * `bareDefRe`（`'key',`，主表的裸数组元素）。**两条都不完备，而且漏的方向相反**：
   *   - **太窄 ⇒ 恒假红**：主表裸字面量被当成消费点 ⇒ 每个主表 key 都满足"被 ≥2 个文件消费"
   *     ⇒ 下面那句「请逐个确认语义主体」的警告**恒响** ⇒ 人学会忽略它
   *     ⇒ **一个总是报警的工具等于没有工具，而且比没有更坏**——它还会让人以为自己已经检查过了。
   *   - **太宽 ⇒ 假绿**：三元 `cond ? 'key' : 'other'` 与映射表 `'key': <值>` 里的**真消费者**
   *     被当成定义 ⇒ 少报消费点：`ok.favorited` / `chat.searchEmpty` 报「0 消费」，
   *     `empty.search` 的「语义主体」警告被**静默压掉**。
   * ⇒ 教训一句话：**判据不该猜行的形状**。声明只会出现在**登记表自己声明的文件**里，
   *   那就去问注册表（`COPY_TABLES[].files`），不再猜。故 `defRe` / `bareDefRe` **两条启发式删除**。
   *
   * 归属判定：某张表的 `files` 里出现**非注释**的该 key，即认为该表声明了它。
   *   - 一般只命中一张表（主表 = `keys.ts` + `xinran.ts`，故主表 key 的「定义处」正常为 2 处）；
   *   - 命中多张时取**并集**——并集让"定义处"集合更大、消费点更少，只会更保守，不会把消费误判成声明；
   *   - 用 `codeLines()` 去注释后再判，避免"注释里提到 key"把文件误认成声明文件。
   *
   * ★ 该判据成立的前提（已核，2026-10-04）：**声明文件里不含对其它 key 的真实消费**。
   *   核法：在全部声明文件里搜真实调用点（`t(` + 字面量）——**零命中**，只有注释提到它。
   *   若将来有人在声明文件里消费 key，此判据需重估。
   */
  const declaredFiles = new Set<string>();
  for (const table of COPY_TABLES) {
    const owns = table.files.some((f) => {
      let source = '';
      try {
        source = readFileSync(join(ROOT, f), 'utf8');
      } catch {
        // 文件读不到**不在这里报错**——报错是一致性校验与主校验的职责，这里只是判定归属。
        return false;
      }
      return codeLines(source).some(({ text }) => re.test(text.trim()));
    });
    if (owns) for (const f of table.files) declaredFiles.add(f.replace(/\\/g, '/'));
  }

  const hits: { file: string; line: number; text: string; isDef: boolean }[] = [];
  /** 只在**注释**里被提到、代码里没有的命中数（PM 提醒的反向风险，见下方输出） */
  let commentOnlyHits = 0;
  for (const file of walk(join(ROOT, 'src'))) {
    const source = readFileSync(file, 'utf8');
    // ★ 路径要先归一成正斜杠再比：`walk()` 返回的是 `join()` 出来的**平台路径**，
    //   Windows 下分隔符是反斜杠。不归一的话这条判定在 Windows 上恒为假，
    //   表现就是"改了代码但读数没变"——**最容易让人误判成修法错**的坑。
    const relPath = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    const isDeclFile = declaredFiles.has(relPath);
    // ★ 用公共的 `codeLines()` 去注释：行号与源文件严格对齐，且不会误切字符串里的 `//`。
    //   原因见 `scripts/lib/scan-source.ts`——「注释导致误报」已经是第三次换工具出现了。
    for (const { line, text } of codeLines(source)) {
      const t = text.trim();
      if (t === '' || !re.test(t)) continue;
      hits.push({
        file: file.slice(ROOT.length + 1),
        line,
        text: t,
        // ★ 判据：命中文件是不是**登记表声明的文件**。不看行的形状（见上方 `declaredFiles`）。
        isDef: isDeclFile,
      });
    }
    for (const raw of source.split('\n')) {
      const r = raw.trim();
      if (re.test(raw) && (r.startsWith('//') || r.startsWith('*') || r.startsWith('/*'))) commentOnlyHits += 1;
    }
  }

  const defs = hits.filter((h) => h.isDef);
  const uses = hits.filter((h) => !h.isDef);
  const useFiles = [...new Set(uses.map((h) => h.file))];

  console.log(`\nkey：${key}`);
  console.log(`定义处 ${defs.length} 处 / 消费点 ${uses.length} 处（分布在 ${useFiles.length} 个文件）\n`);
  if (defs.length > 0) {
    console.log('—— 定义处 ——');
    // ★ 主表 key 会有**两行**：`keys.ts` 的联合/数组声明 + `xinran.ts` 的文案值——
    //   这是真的两处声明，不是重复计数。不解释的话下一个人会以为工具数重了，
    //   进而去"修"这个数——**未解释的数字会变成 folklore**，故在此写明。
    if (defs.length > 1) {
      console.log('   （主表 key 的「定义处」通常 2 处：联合/数组声明 + 文案值，属正常）');
    }
    defs.forEach((h) => console.log(`  ${h.file}:${h.line}  ${h.text.slice(0, 90)}`));
    console.log('');
  }
  // ★ 必须说明下面打印的是**源码原文**：否则行首出现的 `?` / `:` / `){` 之类会被当成
  //   本工具的标记，下一个人会去猜它的意思并按猜的做决定——**未解释的符号会变成 folklore**。
  console.log('—— 消费点（★ 逐个确认语义主体是否相同） ——');
  console.log('   ↓ 下面是**源码原文**；行首的 `?` / `:` 等是代码本身，不是本工具的标记。');
  uses.forEach((h) => console.log(`  ${h.file}:${h.line}  ${h.text.slice(0, 90)}`));
  // ★ 注释里的提及**永远打出来**（不只 0 消费时）：它是"这条 key 被讨论过但可能没接线"的线索，
  //   而且能让上面那条"去注释"逻辑**可见**——否则调用方不知道它排除了什么（黑盒比没有更危险）。
  if (commentOnlyHits > 0) {
    console.log(`\n（另有 ${commentOnlyHits} 处命中在注释里，已按规则排除，不计入消费点。）`);
  }

  if (useFiles.length >= 2) {
    console.log(
      `\n⚠ 该 key 被 ${useFiles.length} 个文件消费。改它的**值**会同时影响上面全部位置——\n` +
        '  请逐个确认它们的**语义主体是否相同**（字段级 / 分区级 / 页面级 / 提示级）。\n' +
        '  若不同：**不要改值**，改为新增一条 key 并只把要改的那处指向它。\n' +
        '  （实例：`hint.voice` 一个开关 vs 整个分区 → 改值会把开关的事实外推成分区的状态。）',
    );
  } else if (useFiles.length === 1) {
    console.log('\n✓ 只有 1 个文件消费它，改值的影响面是单一的——仍建议看一眼上面的行，确认主体没看错。');
  } else {
    // ★ 归因要写准（PM 提醒的反向风险）：排除注释之后，"只在注释里出现过"也会被算成 0 消费。
    //   那说明它**没接线**，但**不等于它没意义**——可能是有文档价值的说明。
    //   写成"建了没用、删掉它"会误导后人删掉一条有注释价值的 key。
    console.log(
      '\n⚠ 代码里没有消费点（注意：这是"**代码没用到**"，不是"这条 key 没意义"——' +
        '它可能只作为说明存在，别据此删）。',
    );
    if (commentOnlyHits > 0) {
      console.log(`  本轮它在注释里被提到 ${commentOnlyHits} 处 ⇒ 属于"**没接线**"，同样不等于"该删"。`);
    }
  }
  process.exit(0);
}

interface Extracted {
  /** key 联合 / 数组里的条数（没有则为 undefined） */
  unionCount?: number;
  /** 文案对象里的条数 */
  objectCount: number;
  /** 文案对象里的全部 key */
  keys: string[];
}

function read(file: string): string {
  return readFileSync(resolve(ROOT, file), 'utf8');
}

/** 抽 `'xxx':` 形式的文案对象条目 */
function objectKeys(source: string): string[] {
  return [...source.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
}

/** 抽 `'xxx',` 形式的 key 联合 / 数组条目。★ 只对**已切好的块**用，不要直接喂全文（见 `blockArrayKeys`）。 */
function arrayKeys(source: string): string[] {
  return [...source.matchAll(/^\s*'([^']+)',$/gm)].map((m) => m[1]);
}

/**
 * 抽**指定数组块**内的条目（`export const X = [` … `\n]`）。
 *
 * ★★ 为什么必须先锚定再扫，不能 `arrayKeys(全文)`：
 *   全文扫会把**对象里跨行的字符串值**也数进"数组条目"里。
 *   实证（2026-10-04，`distill` 表假红）：`src/distill/copy.ts` 有 5 条文案值写成
 *   ```ts
 *   'distill.sources.xxx':
 *     '那是桌面端的工具，网页里没有。PDF 我用 pdfjs 抽文本，图片只能 OCR 或你手写一句描述。',
 *   ```
 *   值那一行长成 `␣␣'…',`，跟数组条目**一模一样**。全文扫把 155 数成 160，
 *   报「key 联合 160 条 != 文案对象 155 条」——**而两张表其实是一致的**。
 *
 * ★ 这是「按形态找」的又一次应验：正则以为"独占一行的 `'x',` 一定是数组条目"，
 *   它没想过对象的值也能长这样。抽全文的正则必须换成"先切块再扫"。
 */
function blockArrayKeys(file: string, anchor: string): string[] {
  const source = read(file);
  const start = source.indexOf(anchor);
  if (start === -1) {
    throw new Error(
      `[copy-tables] 数组块锚点未命中：${anchor}（${file}）。` +
        '块切不出来会把条数数成 0，宁可报错也不要静默返回空。',
    );
  }
  const tail = source.slice(start);
  // ★ 终止符允许缩进：有人把结尾写成 `  ] as const;`（或格式化工具改了缩进）时也要能命中。
  const endMatch = /\n[ \t]*\]/.exec(tail);
  if (!endMatch) {
    throw new Error(
      `[copy-tables] 数组块未找到终止符 \`]\`：${anchor}（${file}）。` +
        '若结尾不是顶格/缩进的 `]`，请检查文件是否被格式化成别的形式；' +
        '这里显式报错，避免退化成「key 联合 0 条 != 文案对象 N 条」那种指不到原因的报错。',
    );
  }
  return arrayKeys(tail.slice(0, endMatch.index));
}

/**
 * 抽**指定对象块**内的 key。
 *
 * ★ 为什么需要它：这类表（`SEGMENT_LABELS` / `TEMPLATE_LABEL`）住在**目标文件的一个角落**——
 *   同文件里还有别的导出对象，直接全文扫会数进无关条目。所以要先锚定 `anchor` 切出块再扫。
 *
 * ★ 为什么抽成公共函数而不是在 switch 里再写一个 case：
 *   已经有两张同类表，第三张迟早出现。**每加一张就复制一段「切块 + 正则」= 又一份第二份真相**——
 *   将来改正则只改了一处，另一处静默失准。这里统一成 `style` 两种形态（`identifier:` / `'key':`），
 *   加表只需要在 registry 登记 + switch 里加一个 case 行。
 */
function blockKeys(file: string, anchor: string, style: 'identifier' | 'quoted'): string[] {
  const source = read(file);
  const start = source.indexOf(anchor);
  const end = start === -1 ? -1 : source.indexOf('\n};', start);
  if (start === -1 || end === -1) return [];
  const block = source.slice(start, end);
  return style === 'identifier'
    ? // 未加引号的标识符键（`identity: '角色身份'`），不是 `'identity':`
      [...block.matchAll(/^\s*([A-Za-z_$][\w$]*):/gm)].map((m) => m[1])
    : objectKeys(block);
}

/** 数 `export const` 条目（用于「导出常量」形态的表，如提示词模板） */
function countExportConst(files: readonly string[]): number {
  return files.reduce(
    (sum, file) => sum + [...read(file).matchAll(/^export const/gm)].length,
    0,
  );
}

/** 把 key 列表包成 `Extracted`（对象条数即 key 条数） */
function objectOf(keys: string[]): Extracted {
  return { objectCount: keys.length, keys };
}

function extract(table: CopyTableRegistration): Extracted {
  if (table.countMode === 'exportConst') {
    return { objectCount: countExportConst(table.countFiles ?? [table.path]), keys: [] };
  }
  switch (table.id) {
    case 'main': {
      const union = arrayKeys(read('src/copy/keys.ts'));
      const obj = objectKeys(read('src/copy/xinran.ts'));
      return { unionCount: union.length, objectCount: obj.length, keys: obj };
    }
    case 'settings':
      return { objectCount: objectKeys(read(table.path)).length, keys: objectKeys(read(table.path)) };
    case 'distill': {
      // ★ 这张表**数组与对象同住一个文件**，所以两侧都必须先切块再扫：
      //   - 数组侧不切块 → 会把对象里跨行的文案值数成数组条目（见 `blockArrayKeys` 注释）；
      //   - 对象侧不切块 → 将来文件里出现第二个带 `'key':` 行的对象时会被一起数进来。
      //     ★ 今天两种扫法结果相同（都是 156），所以这次是**纯等价替换，不改变任何计数**；
      //       现在就切，是为了让"将来加了第二个对象"不会变成一次指不到原因的红。
      const union = blockArrayKeys(table.path, 'export const DISTILL_COPY_KEYS');
      const obj = blockKeys(table.path, 'export const distillCopy', 'quoted');
      return { unionCount: union.length, objectCount: obj.length, keys: obj };
    }
    case 'persona':
    case 'memory':
    case 'capabilities':
    case 'backupText':
    case 'featureNames':
    // ★ 2026-10-04 加 'moments'（朋友圈域文案表）。
    //   ★★ 这里是个**容易踩的坑，值得写下来**：`registry.ts` 里加一张表时，
    //     只改 registry **不够** —— 本 switch 的 `default` 分支返回
    //     `{ objectCount: 0 }`，于是新表会报「声明 N 条，源码实际 0 条」。
    //     那个报错**指不到真正原因**：它看起来像"那张表写错了/文件没找到"，
    //     实际只是这里少了分支。
    //     ⇒ 加新域内表 = registry 登记 **+** 本 switch 加 case（两处，缺一不可）。
    //     （registry 头部有句"加表即豁免，脚本零改动"——那句只对 `scanExempt`
    //       成立，**不包括计数**。别被那句话误导。）
    case 'moments':
    // ★ 加 'stickers'（表情包域文案表，2026-10-04）。同一处坑，见上面那段注释。
    case 'stickers':
    // ★ 加 'feedback'（反馈域文案表，2026-10-04）。**同一处坑**：
    //   registry 登记了但这里没加 case ⇒ 落到 `default` ⇒ 报「声明 66 条，源码实际 0 条」，
    //   而那个报错指不到真正原因（看起来像文件写错了）。加表 = registry + 这里，两处缺一不可。
    case 'feedback':
      return { objectCount: objectKeys(read(table.path)).length, keys: objectKeys(read(table.path)) };
    case 'segmentLabels':
      return objectOf(blockKeys(table.path, 'export const SEGMENT_LABELS', 'identifier'));
    case 'templateLabels':
      return objectOf(blockKeys(table.path, 'export const TEMPLATE_LABEL', 'identifier'));
    case 'tone': {
      // tone 表是 9 簇 × 5 档的嵌套结构，按档位条目计数
      const source = read(table.path);
      const tiers = [...source.matchAll(/^\s{4}[1-5]:\s*\[$/gm)].length;
      return { objectCount: tiers, keys: [] };
    }
    default:
      return { objectCount: 0, keys: [] };
  }
}

const errors: string[] = [];
const warnings: string[] = [];
/** 每张表实际抽到的 key（供跨表重名检查用） */
const keysByTable = new Map<string, string[]>();
/** 每张表的条数快照（供 `--write-baseline` 落盘） */
const snapshot: {
  id: string;
  path: string;
  declared: number;
  actual: number;
  union: number | null;
}[] = [];

console.log('文案表一致性校验\n');
console.log('id        声明  实际  前缀  状态');
console.log('─'.repeat(52));

for (const table of COPY_TABLES) {
  const got = extract(table);
  const actual = got.objectCount;
  keysByTable.set(table.id, got.keys);

  // ① 条数漂移
  if (actual !== table.declaredCount) {
    errors.push(
      `${table.id}: 声明 ${table.declaredCount} 条，源码实际 ${actual} 条（${table.path}）`,
    );
  }

  // ② 单文件自洽表的 key 联合与文案对象必须等长
  if (got.unionCount !== undefined && got.unionCount !== got.objectCount) {
    errors.push(
      `${table.id}: key 联合 ${got.unionCount} 条 != 文案对象 ${got.objectCount} 条（${table.path}）`,
    );
  }

  // ③ key 首段必须落在本表声明的前缀内
  //    ★ `prefixes` 为空 = 有意跳过：key 空间由 TS 联合类型强制（如 `PromptSegmentId`），
  //      用前缀校验反而会漏报真问题。
  const allowed = new Set(table.prefixes);
  const outOfRange =
    allowed.size === 0
      ? []
      : got.keys.filter((key) => !allowed.has(key.split(table.prefixDelimiter)[0]));
  if (outOfRange.length > 0) {
    errors.push(
      `${table.id}: ${outOfRange.length} 个 key 的前缀未在 registry 声明，例如 ${outOfRange
        .slice(0, 5)
        .join(', ')}`,
    );
  }

  snapshot.push({
    id: table.id,
    path: table.path,
    declared: table.declaredCount,
    actual,
    union: got.unionCount ?? null,
  });

  const status = errors.some((e) => e.startsWith(`${table.id}:`)) ? '✗' : '✓';
  const unionText = got.unionCount === undefined ? '—' : String(got.unionCount);
  console.log(
    `${table.id.padEnd(14)}${String(table.declaredCount).padEnd(6)}${String(actual).padEnd(6)}${unionText.padEnd(6)}${status}`,
  );
}

console.log('');

// 前缀共有：不算错误（通用前缀是历史形成的），只列出来供归口人掌握
const prefixOwner = new Map<string, string[]>();
for (const table of COPY_TABLES) {
  for (const prefix of table.prefixes) {
    const list = prefixOwner.get(prefix) ?? [];
    list.push(table.id);
    prefixOwner.set(prefix, list);
  }
}
const sharedPrefixes = [...prefixOwner.entries()].filter(([, owners]) => owners.length > 1);
if (sharedPrefixes.length > 0) {
  console.log('共有前缀（允许，精确 key 不冲突即可）：');
  for (const [prefix, owners] of sharedPrefixes) {
    console.log(`  ${prefix} → ${owners.join(' / ')}`);
  }
  console.log('');
}

// ★ 真正的硬约束：跨表不得出现完全相同的 key
const ids = [...keysByTable.keys()];
for (let i = 0; i < ids.length; i += 1) {
  for (let j = i + 1; j < ids.length; j += 1) {
    const a = new Set(keysByTable.get(ids[i]) ?? []);
    const dup = (keysByTable.get(ids[j]) ?? []).filter((key) => a.has(key));
    if (dup.length > 0) {
      errors.push(`跨表重名：${ids[i]} 与 ${ids[j]} 共有 ${dup.length} 个 key，例如 ${dup.slice(0, 5).join(', ')}`);
    }
  }
}

const byKind = totalRegisteredByKind();
console.log(`\n登记条目合计：${totalRegisteredCopyCount()}（${COPY_TABLES.length} 张表），按种类分：`);
console.log(`  界面文案 ui     ${byKind.ui}`);
console.log(`  功能名   name   ${byKind.name}`);
console.log(`  LLM指令  prompt ${byKind.prompt}`);
console.log('（★ 对外报数请按种类分别引用，别把三类混成一个总数。）');

if (warnings.length > 0) {
  console.log('\n警告：');
  for (const w of warnings) console.log(`  - ${w}`);
}

if (errors.length > 0) {
  console.log('\n错误：');
  for (const e of errors) console.log(`  - ${e}`);
  console.log('\n文案表校验未通过。');
  process.exit(1);
}

/**
 * ★ `--write-baseline`：把当前各表的条数快照写进 `.copy-baseline.json`。
 *
 * 用途：141 条 `cap.reason.*` + 19 条 `cap.note.*` + 1 条 `cap.reason.full` 归口是一次 **+161** 的大 diff。
 * 开工前拍一张 before，改完再拍一张 after，用两张快照证明
 * **"只多了这 161 条，没丢任何既有条目"**——
 * 1138 条靠人眼对是不可能的，靠"我觉得没动"更不可能（这轮我们已经吃过三次亏）。
 *
 * ★ 为什么复用本脚本而不是另写一个小脚本：
 *   另写就得再实现一遍"每张表怎么数"，那就是**第二份真相**——
 *   将来改了这里的取数逻辑，那份静默失准。我们已经在 `arrayKeys` 抽全文这件事上栽过一次，
 *   不想再栽第二次。**只写一次取数逻辑**是这条规矩的全部内容。
 *
 * ★ 只在校验通过时落盘：带着错误拍的基线是脏的，比没有更危险。
 */
if (process.argv.includes('--write-baseline')) {
  const payload = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    generator: 'tsx scripts/check-copy-tables.ts --write-baseline',
    // ★ 这里**不要写死任何条数**（不要写「141 条」这类数）：`declaredCount` 是**滚动数**，
    //   写死的注释会在下一次归口后变成假信息，而下一个人会拿它当现状——
    //   这正是本项目反复踩过的「一次观测 → 写成规律 → 后人照做」。
    //   本文件只回答「此刻每张表声明了多少 / 源码实际有多少」，不回答「应该是多少」。
    purpose:
      '文案表条数快照（schema 1）。用途：改表**前**跑一次存成 before，改完跑一次生成 after，' +
      '两张逐表对比可证明「只增不减」（防止为了消红而删 key）。' +
      '★ 只在校验通过时才写（见上方调用条件），所以文件里不会出现"红着的中间态"。',
    total: totalRegisteredCopyCount(),
    byKind,
    tables: snapshot,
  };
  writeFileSync(resolve(ROOT, '.copy-baseline.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `\n已写入基线 .copy-baseline.json：${snapshot.length} 张表，合计 ${payload.total} 条。`,
  );
}

console.log('\n文案表校验通过。');
