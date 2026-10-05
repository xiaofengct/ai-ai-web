#!/usr/bin/env node
/**
 * 把"归档机制上线前"的产物搬进 release/v0-legacy-<日期>/，并补一份**如实**的清单。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么需要这个脚本（以及为什么它不能被当成"补齐历史"的模板）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-04 要求"保留所有历史版本、APK 与源码一一对应、可追溯"。
 * 但 `apk-out/` 里的东西**先天不满足**这个要求：
 *
 *   ai爱-内置欣然-v1.0.apk      2026-10-04 15:53
 *   ai爱-不内置欣然-v1.0.apk    2026-10-04 15:54
 *   ai爱-源码-2026-10-04.zip    2026-10-04 14:21   ← 早 1.5 小时
 *
 * ★ 关键判断：**那份源码 zip 与那两个 APK 不是同一次构建的产出。**
 *   它们只是"当时恰好并排躺在同一个目录里"。目录邻近性**不构成**对应关系。
 *
 * 所以本脚本**不做**下面这些事（做了就是伪造历史）：
 *   ✗ 不把它们包装成"v1.0 的正式归档"
 *   ✗ 不写 `correspondence: "一一对应"` 这种断言
 *   ✗ 不把两份源码 zip 的哈希互相"对齐"以显得配套
 *
 * 它只做三件事：
 *   ① 原样**复制**（不是移动）到 release/v0-legacy-<日期>/ —— 不删除任何原始文件；
 *   ② 算出每个文件真实的 SHA-256，写进 MANIFEST.json，
 *      并把 `correspondence` 明确标成 **"不可核实"**；
 *   ③ 写 LEGACY-NOTE.md，把上面这段实情用中文讲清楚，供将来翻档的人读到。
 *
 * ★ 目录名用 `v0-legacy-`：`v0` 让它在字典序上排在任何 `v1.x` **之前**（= 最早），
 *   `legacy` 一眼看出不是正规归档。`listBuilds()` 的 `startsWith('v')` 仍能收录它。
 *
 * 幂等：目标目录已存在则直接退出，不覆盖。
 *
 * 用法：
 *   node scripts/archive-legacy.mjs          # 干跑，只打印计划
 *   node scripts/archive-legacy.mjs --apply  # 真的复制 + 写清单
 */
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync,
  openSync, readSync, closeSync, statSync, readdirSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'apk-out');
const RELEASE_DIR = join(ROOT, 'release');
const APPLY = process.argv.includes('--apply');

/** 要搬迁的"产物"（截图等非版本产物不在范围内，留在 apk-out） */
const ARTIFACTS = [
  { file: 'ai爱-内置欣然-v1.0.apk', flavor: 'builtin', kind: 'apk' },
  { file: 'ai爱-不内置欣然-v1.0.apk', flavor: 'standalone', kind: 'apk' },
  { file: 'ai爱-源码-2026-10-04.zip', kind: 'source' },
];

function sha256File(p) {
  const h = createHash('sha256');
  const fd = openSync(p, 'r');
  try {
    const buf = Buffer.alloc(512 * 1024);
    let pos = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
      pos += n;
    }
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

/** 从文件名里挖出日期（`YYYY-MM-DD`）；挖不到就用当前日期 */
function dateTagFrom(name) {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function fmtTime(p) {
  const d = statSync(p).mtime;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/**
 * 在有 MANIFEST 的其他归档目录里找有没有同哈希的产物。
 * 用来回答"这份遗留包是不是就是某个已归档版本" —— 返回 `buildId/文件名` 或 null。
 * 跳过自己（`skipDir`），否则会把刚复制进去的文件当成"已存在"。
 */
function findSameSha(sha, skipDir) {
  if (!existsSync(RELEASE_DIR)) return null;
  for (const d of readdirSync(RELEASE_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = join(RELEASE_DIR, d.name);
    if (dir === skipDir) continue;
    const mfPath = join(dir, 'MANIFEST.json');
    if (!existsSync(mfPath)) continue;
    try {
      const mf = JSON.parse(readFileSync(mfPath, 'utf8'));
      for (const v of mf.variants ?? []) {
        if (v.sha256 === sha) return `${d.name}/${v.file}`;
      }
      if (mf.sourceBackup?.sha256 === sha) return `${d.name}/${mf.sourceBackup.file}`;
    } catch {
      /* MANIFEST 坏了就跳过，不影响迁移 */
    }
  }
  return null;
}

function main() {
  const present = ARTIFACTS.filter((a) => existsSync(join(OUT_DIR, a.file)));
  if (present.length === 0) {
    console.log('apk-out/ 里没有可搬迁的遗留产物，跳过。');
    return;
  }

  const dates = present.map((a) => dateTagFrom(a.file)).sort();
  const buildId = `v0-legacy-${dates[0]}`;
  const destDir = join(RELEASE_DIR, buildId);

  console.log(`\n遗留产物迁移 ${APPLY ? '（APPLY）' : '（干跑，加 --apply 才真做）'}`);
  console.log(`  源目录  ${OUT_DIR}`);
  console.log(`  目标    ${destDir}\n`);

  for (const a of present) {
    const src = join(OUT_DIR, a.file);
    console.log(`  ${a.kind.padEnd(7)} ${a.file}`);
    console.log(`          mtime ${fmtTime(src)}｜${(statSync(src).size / 1024 / 1024).toFixed(2)} MB`);
  }

  // ★ 时间线检查：把"源码是否与 APK 同批次"这件事自动判出来，而不是靠人肉回忆。
  //   判据用 mtime 差值：> 30 分钟即认为不是同一次构建（正常一次构建从 vite 到 gradle 完成
  //   在 10 分钟内；本项目实测两个 flavor 各约 1~2 分钟）。
  const apks = present.filter((a) => a.kind === 'apk').map((a) => statSync(join(OUT_DIR, a.file)).mtimeMs);
  const srcs = present.filter((a) => a.kind === 'source').map((a) => statSync(join(OUT_DIR, a.file)).mtimeMs);
  let correlated = '不可核实（归档机制上线前的产物，无构建号、无同批次证据）';
  if (apks.length > 0 && srcs.length > 0) {
    const gapMin = Math.abs(Math.min(...apks) - Math.min(...srcs)) / 60000;
    console.log(`\n  时间线：APK 与源码 mtime 相差 ${gapMin.toFixed(0)} 分钟`);
    if (gapMin > 30) {
      console.log('  ⇒ 相差超过 30 分钟，判定**不是同一次构建**（这正是本规范要消灭的情况）');
      correlated = '不可核实 ★ 源码备份与 APK 的时间相差超过 30 分钟，**不属于同一次构建** ⇒ 不构成"这一版源码 ↔ 这一版包"的对应关系';
    }
  }
  console.log(`  对应关系判定：${correlated}\n`);

  if (!APPLY) {
    console.log('（干跑结束，未改动任何文件）\n');
    return;
  }

  if (existsSync(destDir)) {
    console.log(`目标目录已存在，拒绝覆盖：${destDir}\n⇒ 本脚本幂等，无需重跑。`);
    return;
  }

  mkdirSync(destDir, { recursive: true });

  const entries = [];
  for (const a of present) {
    const src = join(OUT_DIR, a.file);
    const dst = join(destDir, a.file);
    copyFileSync(src, dst); // ★ 复制而非移动：原始文件保持在 apk-out，绝不删除
    const sha = sha256File(dst);
    const e = {
      file: a.file,
      kind: a.kind,
      ...(a.flavor ? { flavor: a.flavor } : {}),
      bytes: statSync(dst).size,
      sha256: sha,
      mtime: fmtTime(src),
      // ★ 实测发现：这两个遗留 APK 与本次新构建的 APK **字节完全相同**
      //   （gradle 判定 UP-TO-DATE，直接复用了 15:53 的产物）。
      //   这件事必须记下来 —— 否则将来看到两个目录里放着哈希一样的包会以为是重复归档出了 bug。
      //   它也让"哪份东西才是真正不同的旧快照"一目了然：是那份 14:21 的源码 zip。
      ...(findSameSha(sha, destDir)
        ? { sameAsExisting: findSameSha(sha, destDir), note: '与已有归档中的同名哈希产物字节完全相同（同一构建产物，仅命名不同）' }
        : {}),
    };
    entries.push(e);
    console.log(`  ✓ ${a.file}  sha256 ${e.sha256.slice(0, 16)}…${e.sameAsExisting ? `  = ${e.sameAsExisting}` : ''}`);
  }

  const apkEntries = entries.filter((e) => e.kind === 'apk');
  const srcEntry = entries.find((e) => e.kind === 'source') ?? null;

  const manifest = {
    buildId,
    builtAt: fmtTime(join(OUT_DIR, present[0].file)),
    archivedAt: new Date().toISOString(),
    appName: 'ai爱',
    versionName: '1.0',
    versionCode: null,
    legacy: true,
    legacyReason:
      '归档机制（release/ 一版一目录 + MANIFEST + SHA256SUMS）于 2026-10-04 上线，' +
      '本目录装的是上线之前留在 apk-out/ 的产物。它们没有构建号，也没有同批次证据。',
    git: { head: '(未记录)', dirty: null },
    variants: apkEntries.map((e) => ({
      flavor: e.flavor,
      appId: e.flavor === 'builtin' ? 'com.aiai.builtin' : 'com.aiai.standalone',
      appName: 'ai爱',
      file: e.file,
      bytes: e.bytes,
      sha256: e.sha256,
      jsChunks: null,
      seedMarkers: null,
      verifiedAtBuild: false,
      note: '未在构建时做过特征自检（该机制当时还不存在）；哈希为本次迁移时实测',
    })),
    sourceBackup: srcEntry
      ? {
          file: srcEntry.file,
          bytes: srcEntry.bytes,
          sha256: srcEntry.sha256,
          producedBy: 'scripts/backup-source.py（旧调用方式，未带 --out-dir）',
          note: '★ 与上面的 APK **不是同一次构建**，见 correspondence 字段',
        }
      : null,
    correspondence: correlated,
    integrity:
      '本目录内每个文件的 sha256 均为迁移时实测值，收在 SHA256SUMS.txt。' +
      '校验哈希可以证明"文件没被改动过"，但**不能**证明"源码与 APK 配套"。',
    originalLocation: 'apk-out/（原始文件仍保留在原地，本目录是副本）',
  };

  writeFileSync(join(destDir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const sums = entries.map((e) => `${e.sha256}  ${e.file}`);
  writeFileSync(join(destDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);

  // ★ 反引号提成常量：我在模板串里写转义反引号已经踩坑三次
  //   （两次语法错、一次漏闭合），而这段文本本身要大量输出 Markdown 行内代码。
  //   用常量拼接后，模板串里**不再出现任何反引号**，这一类错误从根上消失。
  const BT = '`';
  const note = [
    '# 说明：这不是一次"正规归档"',
    '',
    `本目录（${BT}${buildId}${BT}）装的 **不是** ${BT}scripts/build-apk.mjs${BT} 产出的版本，`,
    `而是 2026-10-04 归档机制上线**之前**留在 ${BT}apk-out/${BT} 的旧产物，为"保留所有历史版本"而搬运至此。`,
    '',
    '## 实情',
    '',
    '| 文件 | 产出时间 | 实情 |',
    '|---|---|---|',
    ...entries.map((e) => {
      const 实情 = e.kind === 'apk' ? '无构建号' : '★ 比上面两个 APK 早，**不是同一次构建**';
      return `| ${BT}${e.file}${BT} | ${e.mtime} | ${实情} |`;
    }),
    '',
    '## 为什么必须把这点写清楚',
    '',
    '这两个 APK 与这份源码 zip **不是同一次构建的产出**，它们只是当时恰好躺在同一个目录里。',
    '**目录邻近性不构成对应关系。**',
    '',
    `因此本目录 ${BT}MANIFEST.json${BT} 的 ${BT}correspondence${BT} 字段明确标为**不可核实** ——`,
    '它只保证"文件内容与这里的 sha256 一致"，**不保证**"这份源码能构建出这两个包"。',
    '',
    '本目录存在的意义是**当反面样本**：它是',
    `${BT}docs/09-版本归档与源码对应规范.md${BT} §5.1 那条「不要靠目录邻近性暗示对应关系」的实证。`,
    '',
    '## 原始位置',
    '',
    `原始文件**仍保留在 ${BT}apk-out/${BT}**（本目录是复制品，未删除任何东西）。`,
    '',
  ].join('\n');
  writeFileSync(join(destDir, 'LEGACY-NOTE.md'), note);

  console.log(`\n✓ 已归档到 ${destDir}`);
  console.log('  MANIFEST.json（correspondence = 不可核实）');
  console.log('  SHA256SUMS.txt');
  console.log('  LEGACY-NOTE.md');
  console.log('\n★ INDEX.md 需手工补一行（本脚本不写索引，避免与 build-apk.mjs 的追加语义打架）。\n');
}

main();
