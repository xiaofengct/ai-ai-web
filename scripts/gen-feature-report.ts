#!/usr/bin/env node
/**
 * 「原应用」功能拆解报告生成器（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么要**生成**而不是手写
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户要的是「拆解原应用应有的功能模块 + 对照现有实现 + 明确标注已实现/未实现」。
 *
 * 这类"清单型"交付有个通病：**手写的清单会漂**。
 * 今天写了"141 项，128 项已实现"，明天代码改了，文档还是那个数 ——
 * 而读者（包括未来的自己）无法判断它是"过时"还是"就是这样"。
 *
 * 本项目已经有一份**机器可读的**同源数据：`src/constants/capabilities.ts`
 * 的 `CAPABILITIES`（141 项，每项含 `level` / `reason` / `alternative` / `note` / `group`）。
 * ⇒ 报告从这里生成。文档里的每一项、每一个数字，都能追回到那一行常量。
 *
 * ★ 生成时**只读不改**：本脚本不修改任何源文件。
 *
 * 用法：npx tsx scripts/gen-feature-report.mjs [输出路径]
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CAPABILITIES } from '@/constants/capabilities';
import { FEATURE_NAMES } from '@/features/capabilities/featureNames';
import { t as getCopy } from '@/copy';
import type { CapabilityLevel } from '@/types/common';
import type { CopyKey } from '@/copy/keys';
import type { FeatureId } from '@/constants/featureIds';

const OUT =
  process.argv[2] ?? path.join(process.cwd(), 'docs', '18-原应用功能拆解与实现对照.md');

/** level → 中文标签 */
const LEVEL_LABEL: Record<CapabilityLevel, string> = {
  full: '✅ 已实现',
  partial: '⚠️ 部分实现',
  alternative: '🔁 替代实现',
  unavailable: '❌ 未实现',
};
const GROUP_ORDER = ['页面', '后台能力', '设置项', '平台能力', '蒸馏', '欣然人格'];

const entries = Object.values(CAPABILITIES);
const byGroup = new Map<string, typeof entries>();
for (const g of GROUP_ORDER) byGroup.set(g, []);
for (const e of entries) {
  const list = byGroup.get(e.group);
  if (list) list.push(e);
  else byGroup.set(e.group, [e]);
}

const counts = entries.reduce<Partial<Record<CapabilityLevel, number>>>((acc, e) => {
  acc[e.level] = (acc[e.level] ?? 0) + 1;
  return acc;
}, {});

const txt = (key?: CopyKey): string => {
  if (!key) return '';
  try {
    return getCopy(key);
  } catch {
    return `（缺文案 ${key}）`;
  }
};
const name = (id: FeatureId): string => FEATURE_NAMES[id] ?? '';

const missing = entries.filter((e) => e.level === 'unavailable' || e.level === 'partial');
const alt = entries.filter((e) => e.level === 'alternative');

let md = '';
md += '# 18 · 「原应用」功能拆解与实现对照\n\n';
md += '> **本文档由脚本生成**（`npx tsx scripts/gen-feature-report.ts`），\n';
md += '> 第一节~第四节的数据源是 `src/constants/capabilities.ts` 的 `CAPABILITIES` 常量表\n';
md += '> —— 也就是驱动 `<CapabilityGate>` 的那张表。改代码后重跑即可，**不要手改本文**。\n';
md += '>\n';
md += '> 生成时间：' + new Date().toISOString() + '\n\n';

md += '## 〇、怎么读这份对照\n\n';
md += '「原应用」的功能口径来自**原应用的能力表**（`docs/01-PRD-功能拆解.md`），共 **141 项**，\n';
md += '分 6 组：页面 27 / 后台能力 11 / 设置项 63 / 平台能力 21 / 蒸馏 10 / 欣然人格 9。\n\n';
md += '本文分两部分：\n\n';
md += '- **第一~四节**：这 141 项的**逐项对照**（含"缺什么、缺了会怎样"与替代方案）；\n';
md += '- **第五、六节**：**能力表之外**的内容 —— 能力表是"对齐原应用"的清单，\n';
md += '  而后来的需求（世界设定、朋友圈…）不属于原应用，只能记在这里。\n\n';

md += '> ★ 一条判据上的提醒：**「未实现」≠「坏了」**。\n';
md += '> `❌ unavailable` 指的是"当前架构下做不到"（如 iOS 后台保活、直读原生 `chat.db`），\n';
md += '> 每一项都配了**替代方案文案**，界面上由 `<CapabilityGate>` 置灰并展示原因 ——\n';
md += '> 不存在"静默缺失"（这是 PRD §11 的硬要求）。\n\n';

md += '## 一、总览\n\n';
md += '| 状态 | 数量 | 含义 |\n|---|---|---|\n';
md += `| ✅ 已实现（full） | ${counts.full ?? 0} | 原样实现，行为与原应用一致 |\n`;
md += `| 🔁 替代实现（alternative） | ${counts.alternative ?? 0} | 换了技术方案达成同一目的（如用 WebRTC/三段式替代原生实时语音） |\n`;
md += `| ⚠️ 部分实现（partial） | ${counts.partial ?? 0} | 有该功能，但已知有边界做不到｜**见第三节逐条说明** |\n`;
md += `| ❌ 未实现（unavailable） | ${counts.unavailable ?? 0} | 当前无法提供｜**见第三节逐条说明** |\n`;
md += `| **合计** | **${entries.length}** | — |\n\n`;

md += '### 分组分布\n\n';
md += '| 分组 | 项数 | ✅ | 🔁 | ⚠️ | ❌ |\n|---|---|---|---|---|---|\n';
for (const [g, list] of byGroup) {
  if (list.length === 0) continue;
  const c = (lv: CapabilityLevel): number => list.filter((e) => e.level === lv).length;
  md += `| ${g} | ${list.length} | ${c('full')} | ${c('alternative')} | ${c('partial')} | ${c('unavailable')} |\n`;
}
md += '\n';

md += '---\n\n## 二、逐项对照（全 ' + entries.length + ' 项）\n\n';
for (const [g, list] of byGroup) {
  if (list.length === 0) continue;
  md += `### ${g}（${list.length} 项）\n\n`;
  md += '| ID | 功能名 | 状态 |\n|---|---|---|\n';
  for (const e of list) {
    md += `| \`${e.id}\` | ${name(e.id)} | ${LEVEL_LABEL[e.level] ?? e.level} |\n`;
  }
  md += '\n';
}

md += '---\n\n## 三、缺什么、以及缺了它会怎样\n\n';
md += `> 这一节只列 **⚠️ 部分实现** 与 **❌ 未实现** 两类 —— 也就是"用户能感觉到少了一块"的那些。\n`;
md += `> 共 ${missing.length} 项。\n\n`;

const sortedMissing = [...missing].sort((a, b) => {
  const rank: Record<string, number> = { unavailable: 0, partial: 1 };
  const d = rank[a.level] - rank[b.level];
  return d !== 0 ? d : a.id.localeCompare(b.id);
});

for (const e of sortedMissing) {
  md += `#### \`${e.id}\` ${name(e.id)}　${LEVEL_LABEL[e.level]}\n\n`;
  md += `- **缺什么 / 差在哪**：${txt(e.reason)}\n`;
  if (e.alternative) md += `- **替代办法**：${txt(e.alternative)}\n`;
  if (e.note) md += `- **边界说明**：${txt(e.note)}\n`;
  md += '\n';
}

md += '---\n\n## 四、替代实现清单（做到了，但方式与原应用不同）\n\n';
md += `共 ${alt.length} 项。这些**不是缺失** —— 功能在，只是底层方案换了。\n\n`;
md += '| ID | 功能名 | 替代方案 |\n|---|---|---|\n';
for (const e of alt.sort((a, b) => a.id.localeCompare(b.id))) {
  md += `| \`${e.id}\` | ${name(e.id)} | ${txt(e.alternative)} |\n`;
}
md += '\n';

md += '---\n\n## 五、能力表之外的功能（后续新增的需求）\n\n';
md += '> 下面这些**不在 141 项里** —— 能力表描述的是"原应用有什么"，\n';
md += '> 而这些是用户在使用过程中**后来提出的新需求**。它们同样需要维护，\n';
md += '> 只是不能挂进那张表（挂进去会污染"实现完成度"这个指标）。\n\n';
md += '| 功能 | 位置 | 状态 | 说明 |\n|---|---|---|---|\n';
md +=
  '| **世界设定** | 设置 → 世界设定（`features/settings/sections/WorldSection.tsx`）；`src/world/**` | ✅ 已实现 | 排班 / 静默时段 / 按班次活跃时段 / 概率门由**代码精确计算**（北京时间，不受设备时区影响）；世界书条目按关键词注入角色卡。**内置欣然版**自带完整世界包（只读）；**不内置版**预留导入窗口（`.md` / `.json`，带识别报告） |\n';
md +=
  '| **朋友圈** | 底部/侧栏导航 → 朋友圈（`features/moments/**`） | ✅ 已实现 | 发布动态（文字 + 可选配图 + 可选心情）、浏览时间线（全部 / 我的 / 她的）、点赞（乐观更新）、删除（二次确认）。★ **不含**"角色自己发动态"（需 LLM 生成，属独立新功能），写入端字段已预留 |\n';
md +=
  '| **快捷入口迁移** | 设置 → 快捷入口（`features/settings/sections/ShortcutsSection.tsx`） | ✅ 已实现 | 原先挂在首页的 6 个磁贴（记忆 / 蒸馏 / 收藏 / 语音 / 模型 / 设置）按用户要求收进设置页，首页回归"看会话、开新会话"。**收藏**是全应用唯一入口，故必须保留 |\n';
md +=
  '| 角色自动发动态 | — | ❌ 未做 | 需要按人格 + 世界设定调用 LLM 生成动态，与"发布/浏览"是两件事；数据结构已预留 `authorKind: \'persona\'` + `authorId` |\n';
md += '\n';

md += '---\n\n## 六、功能模块 → 子功能（代码结构视角）\n\n';
md += '> 按 `src/features/**` 的模块划分列出，便于"想改某功能时该翻哪个目录"。\n';
md += '> 括号内是对应的能力项 ID 段。\n\n';
md += '| 模块目录 | 职责 | 主要子功能 |\n|---|---|---|\n';
const MODULES = [
  ['`features/home/`', '首页（PG-14 / PG-15）', '会话列表、角色轨、新建会话、搜索、归档/删除、布局 v1/v2、无角色引导'],
  ['`features/chat/`', '主聊天（PG-16 / PG-01 / PG-03 / PG-09 / PG-10）', '消息收发、流式、转发溯源、聊天内搜索、统计、会话级设置、上下文窗口'],
  ['`features/memory/`', '记忆库（PG-12 / PG-13 / FN-56~63）', '记忆列表、标签/范围筛选、编辑、纠正记录、与对话的引用关系'],
  ['`features/distill/`', '蒸馏（EX-01~EX-10）', '5 步向导、数据源导入（txt/csv/json/图片）、解析、预览、产物管理、版本回滚'],
  ['`features/persona/`', '角色/人设（T10 + XR-01~XR-07）', '角色卡查看、编辑器、导入/导出（json/zip/png）、隐私红线、世界书条目'],
  ['`features/settings/`', '设置体系（PG-17~PG-23 / FN-01~FN-63）', '模型、聊天、上下文、主动消息、记忆、世界设定、语音、微信 ClawBot、外观、备份、高级、关于、连接测试、开发者、诊断'],
  ['`features/moments/`', '朋友圈（**能力表外**）', '发布（文字/配图/心情）、时间线、筛选、点赞、删除'],
  ['`features/favorites/`', '收藏夹（PG-08）', '收藏消息列表、按会话分组、跳回原消息'],
  ['`features/voice/`', '语音（PG-04 / PG-05）', '音色试听、音色管理、实时通话（三段式替代实现）'],
  ['`features/media/`', '媒体（PG-06）', '图片预览、缩放、blob 读取'],
  ['`features/capabilities/`', '能力总览', '141 项能力表展示、分级筛选、原因与替代方案'],
  ['`features/crash/`', '崩溃兜底', '错误边界、启动失败面板、日志导出'],
  ['`features/pet/`', '桌宠', 'PetOverlay 悬浮层'],
  ['`features/module/`', '沙箱模块（PG-23~PG-25）', '模块 WebView、权限清单'],
  ['`features/guide/`', '首次引导（PG-07）', '4 步向导、双版本分支文案'],
];
for (const [d, duty, sub] of MODULES) md += `| ${d} | ${duty} | ${sub} |\n`;
md += '\n';

writeFileSync(OUT, md, 'utf8');
console.log(`✓ 已生成 ${OUT}`);
console.log(`  共 ${entries.length} 项：✅${counts.full ?? 0} / 🔁${counts.alternative ?? 0} / ⚠️${counts.partial ?? 0} / ❌${counts.unavailable ?? 0}`);
console.log(`  第三节（缺什么）收录 ${missing.length} 项；第四节（替代）收录 ${alt.length} 项`);
