/**
 * ★★ 内置数据的「值快照 / 比对」工具（隐私脱敏 L2 的验证核心）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么不能用文件哈希（这是本工具存在的唯一理由）
 * ═══════════════════════════════════════════════════════════════════════════
 * L2 会把两处**数据**从源码搬进私有目录、再由生成脚本填回原位，
 * 源码本身变成 `export ... from '...'` 的薄壳。
 *
 * ⇒ **文件文本必然变化**（哪怕一个数据值都没改）。
 *   所以"数据没变"这件事**无法用文件哈希证明** —— 拿文件哈希比，
 *   结果一定是"不同"，那这个断言就永远为红，等于没有断言。
 *
 * ⇒ 正确的判据是**导出值的哈希**：把运行时真正消费的那份内容
 *   （两个模块的导出）序列化后算 SHA-256。它只看"内容值"，
 *   不看"这些值写在哪个文件里、怎么被引入的"。
 *
 * 用法：
 *   # 改动前：采基线
 *   npx tsx scripts/qa/snapshot-builtin-data.ts --write .qa-tmp/data-baseline.json
 *
 *   # 改动后：比对（逐字段列出差异，不是只报"不一致"）
 *   npx tsx scripts/qa/snapshot-builtin-data.ts --check .qa-tmp/data-baseline.json
 *
 * 退出码：0 = 一致；1 = 有差异（或基线文件缺失/损坏）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { XINRAN_WORLD, XINRAN_WORLD_ANCHOR, XINRAN_WORLD_CYCLE } from '@/world/builtinWorlds';
import {
  XINRAN_CREATOR_NOTES,
  XINRAN_GREETINGS,
  XINRAN_LAYERS,
  XINRAN_NAME,
} from '@/copy/xinran';

/**
 * 取当前导出值，切成**便于逐项比对**的若干片。
 *
 * ★ 切成多片而不是整块一个哈希：这样比对失败时能**指出是哪一片变了**
 *   （"世界条目变了" vs "人格层变了"），而不是只报一句"整体不一致"——
 *   后者对排查没有帮助，还得手工去 diff。
 */
function snapshot(): Record<string, unknown> {
  return {
    'world.anchor': XINRAN_WORLD_ANCHOR,
    'world.cycle': XINRAN_WORLD_CYCLE,
    'world.pack': XINRAN_WORLD,
    'persona.layers': XINRAN_LAYERS,
    'persona.greetings': XINRAN_GREETINGS,
    'persona.name': XINRAN_NAME,
    'persona.creatorNotes': XINRAN_CREATOR_NOTES,
  };
}

/** 稳定序列化：键按字典序排列，避免属性顺序变化造成假差异 */
function stable(obj: unknown): string {
  if (Array.isArray(obj)) return `[${obj.map(stable).join(',')}]`;
  if (obj !== null && typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(obj) ?? 'null';
}

const hashOf = (v: unknown): string => createHash('sha256').update(stable(v)).digest('hex');

const argv = process.argv.slice(2);
const mode = argv.includes('--write') ? 'write' : argv.includes('--check') ? 'check' : null;
const fileArg = argv.find((a) => !a.startsWith('--')) ?? '.qa-tmp/data-baseline.json';
const file = path.resolve(process.cwd(), fileArg);

const snap = snapshot();
const hashes: Record<string, string> = {};
for (const [k, v] of Object.entries(snap)) hashes[k] = hashOf(v);
const overall = hashOf(snap);

if (mode === 'write') {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ hashes, overall }, null, 2)}\n`, 'utf8');
  console.log('\n═══ 内置数据基线已记录 ═══\n');
  for (const [k, h] of Object.entries(hashes)) console.log(`  ${k.padEnd(22)} ${h.slice(0, 16)}`);
  console.log(`\n  整体 ${overall.slice(0, 16)}`);
  console.log(`  写入 ${file}\n`);
  process.exit(0);
}

if (mode === 'check') {
  if (!existsSync(file)) {
    console.error(`\n✗ 基线文件不存在：${file}`);
    console.error('  先跑：npx tsx scripts/qa/snapshot-builtin-data.ts --write .qa-tmp/data-baseline.json\n');
    process.exit(1);
  }
  let base: { hashes?: Record<string, string>; overall?: string };
  try {
    base = JSON.parse(readFileSync(file, 'utf8')) as typeof base;
  } catch (e) {
    console.error(`\n✗ 基线文件解析失败：${(e as Error).message}\n`);
    process.exit(1);
  }

  console.log('\n═══ 内置数据一致性核对（值哈希，非文件哈希）═══\n');
  const bad: string[] = [];
  for (const [k, h] of Object.entries(hashes)) {
    const want = base.hashes?.[k];
    const ok = want === h;
    if (!ok) bad.push(k);
    console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${k.padEnd(22)} ${h.slice(0, 16)}${ok ? '' : `  期望 ${want?.slice(0, 16) ?? '(基线中缺失)'}`}`);
  }

  console.log('\n' + '─'.repeat(47));
  if (bad.length === 0 && base.overall === overall) {
    console.log('\x1b[32m全部一致：内置数据值未变 ✓\x1b[0m');
    console.log('─'.repeat(47) + '\n');
    process.exit(0);
  }
  console.log(`\x1b[31m以下分片与基线不一致：\x1b[0m`);
  for (const k of bad) console.log(`  · ${k}`);
  console.log('─'.repeat(47) + '\n');
  process.exit(1);
}

console.log('\n用法：');
console.log('  npx tsx scripts/qa/snapshot-builtin-data.ts --write <基线文件>');
console.log('  npx tsx scripts/qa/snapshot-builtin-data.ts --check <基线文件>\n');
process.exit(1);
