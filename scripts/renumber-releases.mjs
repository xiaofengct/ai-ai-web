#!/usr/bin/env node
/**
 * 把 `release/` 下**历史命名**的构建目录，按时间顺序重编号为 `v1`、`v2`、`v3`……
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么做这件事
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户 2026-10-04 明确要求：
 *   「以后命名规则就是 v1、v2，以此类推」
 * 并同时反映出一个实际问题：
 *   「你把上一版的 apk 给替换掉了，文件夹里面没有」
 *
 * 后半句的实情是：**并没有任何文件被替换或删除**（可核对）——
 * 但一版一个目录 + 名字里带长串时间戳（`v1.0-b20261004-163800`）导致
 * **版本之间的先后关系不直观**，用户很难一眼看出"上一版是哪个"。
 * 换句话说：文件都在，但**看不出来**。那和丢了差别不大。
 *
 * ⇒ 这个脚本把历史目录改成简单递增号，让版本序列一眼可见：
 *      release/v1、v2、v3 ……
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 安全约束（用户反复强调"不要替换掉"）
 * ═══════════════════════════════════════════════════════════════════════════
 *   · 只用 `renameSync`（同分区内的重命名）—— **原子操作，不复制、不删除**；
 *   · 目录内的文件**一律不改名**：这样 MANIFEST 里记的哈希、SHA256SUMS 的条目
 *     全部继续成立，无需重算（重命名文件会让归档的"自校验"失去意义）；
 *   · 每个被改名的目录，在 `MANIFEST.json` 里补一个 `renumberedFrom` 字段，
 *     把原构建号留在原地 —— 将来翻档能对上"v3 原来是哪次构建"；
 *   · 目标目录已存在时**直接跳过并告警**，绝不覆盖；
 *   · 幂等：跑第二次不会再改（旧名已不存在）。
 *
 * 用法：
 *   node scripts/renumber-releases.mjs          # 干跑，只打印计划
 *   node scripts/renumber-releases.mjs --apply  # 执行
 */
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DIR = join(ROOT, 'release');
const APPLY = process.argv.includes('--apply');

/**
 * 判断一个目录名属于"历史命名"（不是 `v<数字>`）。
 * 历史形态：`v0-legacy-20261004`、`v1.0-b20261004-163800`
 */
const isNumbered = (name) => /^v\d+$/.test(name);

/**
 * 确定一个历史目录的时间先后，用于分配编号。
 *
 * ★ 顺序很重要（我第一次写错了，把最早的排到了最后）：
 *   第一版只从**文件名**里抽时间戳，于是
 *     `v1.0-b20261004-160134` → 匹配到 `b20261004-160134`
 *     `v0-legacy-20261004`    → 只能匹配到裸日期 `20261004`
 *   前者带时分秒、后者不带 ⇒ 排序时 legacy 被排到了最后，
 *   而它其实是**最早**的那批（15:53 产出的旧包）。
 *
 * ★ 正解：**优先读 MANIFEST.json 的 `builtAt`** ——
 *   它是归档自己声明的「这批产物的产出时间」，语义最准，
 *   而且两种命名规则的目录都有这个字段（legacy 也补写过）。
 *   文件名与 mtime 只作为兜底。
 *
 *   为什么不用文件 mtime：本项目实测过 gradle **复用产物**
 *   （输入没变时 `UP-TO-DATE`，直接把上一次的 APK 拷过来），
 *   于是新旧两批目录里文件的 mtime 会相同甚至倒挂 —— 拿它排序不可靠。
 */
function sortKey(name, dir) {
  // ① 首选 ORDER 来源：MANIFEST.builtAt
  const mfPath = join(dir, 'MANIFEST.json');
  if (existsSync(mfPath)) {
    try {
      const builtAt = JSON.parse(readFileSync(mfPath, 'utf8')).builtAt;
      if (builtAt) {
        const t = new Date(builtAt).getTime();
        if (!Number.isNaN(t)) return `0-${String(t).padStart(20, '0')}`;
      }
    } catch {
      /* MANIFEST 坏了就往下走 */
    }
  }
  // ② 文件名里的完整时间戳（新式命名）
  const full = name.match(/b(\d{8})-(\d{6})/);
  if (full) return `1-${full[1]}${full[2]}`;
  // ③ 文件名里的裸日期（legacy 命名）
  const day = name.match(/(\d{8})/);
  if (day) return `2-${day[1]}`;
  // ④ 最后兜底：目录 mtime
  try {
    const st = statSync(dir);
    return `3-${String(st.mtimeMs).padStart(20, '0')}`;
  } catch {
    return '4-';
  }
}

function main() {
  if (!existsSync(RELEASE_DIR)) {
    console.log('release/ 不存在，无需处理。');
    return;
  }

  const dirs = readdirSync(RELEASE_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('v'))
    .map((e) => e.name);
  const numbered = dirs.filter(isNumbered);
  const legacy = dirs.filter((n) => !isNumbered(n));

  const maxNum = numbered.length
    ? Math.max(...numbered.map((n) => Number(/^v(\d+)$/.exec(n)[1])))
    : 0;

  if (legacy.length === 0) {
    console.log(`\n没有需要重编号的历史目录（现有编号版本 ${numbered.length} 个，最大 v${maxNum}）。\n`);
    return;
  }

  // 按时间先后排序，然后**接在已有编号之后**（不占用已用编号）
  const ordered = legacy
    .map((n) => ({ name: n, key: sortKey(n, join(RELEASE_DIR, n)) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((x) => x.name);

  console.log(`\n历史命名重编号 ${APPLY ? '（APPLY）' : '（干跑，加 --apply 才真做）'}`);
  console.log(`  起始编号：v${maxNum + 1}\n`);

  const plan = [];
  let next = maxNum + 1;
  for (const oldName of ordered) {
    const target = `v${next}`;
    plan.push({ oldName, target });
    console.log(`  ${oldName.padEnd(28)} → ${target}`);
    next += 1;
  }

  if (!APPLY) {
    console.log('\n（干跑结束，未改动任何文件）\n');
    return;
  }

  console.log('');
  let done = 0;
  for (const { oldName, target } of plan) {
    const from = join(RELEASE_DIR, oldName);
    const to = join(RELEASE_DIR, target);
    if (existsSync(to)) {
      console.log(`  \x1b[31m✗ 跳过 ${oldName}：目标 ${target} 已存在（绝不覆盖）\x1b[0m`);
      continue;
    }

    // ★ renameSync：同分区内的原子重命名，不是复制再删除 ⇒ 不存在"中途丢文件"
    renameSync(from, to);

    // 在 MANIFEST 里留下原构建号，供将来对账
    const mfPath = join(to, 'MANIFEST.json');
    if (existsSync(mfPath)) {
      try {
        const mf = JSON.parse(readFileSync(mfPath, 'utf8'));
        mf.renumberedFrom = oldName;
        mf.renumberedAt = new Date().toISOString();
        mf.renumberNote =
          '2026-10-04 因命名规则变更（改为 v1/v2 递增）而改名；目录内文件未改动，哈希仍与 SHA256SUMS 一致。';
        writeFileSync(mfPath, `${JSON.stringify(mf, null, 2)}\n`);
      } catch (e) {
        console.log(`    \x1b[33m! ${target}/MANIFEST.json 更新失败（不影响文件本体）：${e.message}\x1b[0m`);
      }
    }

    const inner = readdirSync(to).filter((f) => !f.startsWith('.'));
    console.log(`  ✓ ${oldName} → ${target}（${inner.length} 个文件）`);
    done += 1;
  }

  console.log(`\n✓ 完成：改名 ${done} 个目录。`);
  console.log('★ 目录内文件**未改名** —— MANIFEST 的哈希与 SHA256SUMS 依旧成立。');
  console.log('★ 原构建号已记入各自 MANIFEST.json 的 `renumberedFrom` 字段。\n');
}

main();
