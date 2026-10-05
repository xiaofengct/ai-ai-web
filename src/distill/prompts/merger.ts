/**
 * 来源：`_ref/ex-skill-main/prompts/merger.md`
 * sourceVersion: ex-skill v1.0.0
 *
 * 进化模式：追加原材料（done → analyzing，EX-09）。
 * 原则：**只追加增量，不覆盖已有结论**；发现冲突时输出冲突提示交由用户决定。
 */

export const MERGER_PROMPT = `# 增量合并任务

你将收到：
1. 现有的 \`memories.md\` 内容
2. 现有的 \`persona.md\` 内容
3. 新的原材料内容（聊天记录、照片或其他）

你的任务是判断新内容应该更新哪个部分，并输出增量更新内容。

**原则：只追加增量，不覆盖已有结论。如有冲突，输出冲突提示让用户决定。**

---

## Step 1：分类判断

| 信息类型 | 归入 |
|---------|------|
| 共同记忆、日期、地点、活动 | → memories.md |
| 偏好习惯、食物/旅行/礼物 | → memories.md |
| 冲突事件、吵架经过 | → memories.md（事件）+ persona.md（行为模式） |
| 沟通风格、口头禅、表达习惯 | → persona.md |
| 情感反应、情绪模式、依恋表现 | → persona.md |
| 两者都有 | → 分别归入 |

## Step 2：检查冲突

- 新内容**补充**了现有信息 → 直接追加
- 新内容**确认**了现有信息 → 忽略（不重复写）
- 新内容**与现有信息矛盾** → 输出冲突提示：

\`\`\`
⚠️ 发现冲突：
- 现有：{现有描述}
- 新发现：{新内容描述}
- 来源：{文件名/时间}

建议：[保留现有 / 更新为新内容 / 两者都保留并标注时间]
请用户决定。
\`\`\`

## Step 3：生成更新 Patch

严格按以下格式输出（两段都要有，没有更新就写 [无更新]）：

\`\`\`
=== memories.md 更新 ===

[追加到"重要时刻"节]
- {新的时间线事件}

[追加到"她的偏好/吃"节]
- {新的食物偏好}

[无更新] 或 [以上章节有更新]
\`\`\`

\`\`\`
=== persona.md 更新 ===

[追加到"Layer 2/口头禅"节]
- 新口头禅："{xxx}"

[追加到"Layer 3/情感逻辑"节]
- {新的行为描述}

[无更新] 或 [以上章节有更新]
\`\`\`

## Step 4：更新摘要

\`\`\`
本次更新摘要：
- memories.md：追加了 {N} 条新信息（{简要描述}）
- persona.md：追加了 {N} 条新信息（{简要描述}）
- 发现 {N} 处冲突，需要你确认（见上方）

版本将从 {vN} 升级到 {vN+1}。
\`\`\`

---

## 现有 memories.md

{currentMemories}

---

## 现有 persona.md

{currentPersona}

---

## 新原材料

{newKnowledge}
`;

/** 解析 merger 输出：拆成 memories / persona 两段 patch + 冲突数 */
export interface MergerPatch {
  memoriesPatch: string;
  personaPatch: string;
  summary: string;
  conflictCount: number;
  hasUpdate: boolean;
}

/**
 * ★ 容错解析：LLM 输出格式经常跑偏（PRD C6「JSON 模式 + 容错解析」）。
 * 规则：按 `=== xxx ===` 标记切；标记缺失时按关键词兜底；再不行整段当 memories patch。
 */
export function parseMergerOutput(text: string): MergerPatch {
  // ★ 段结束标记：`=== 下一段 ===` 或「本次更新摘要：」（LLM 经常不给下一段加 ===）
  const sectionEnd = String.raw`(?====\s*(?:memories\.md|persona\.md)|\n本次更新摘要|\n更新摘要|$)`;
  const memoriesMatch = text.match(
    new RegExp(String.raw`===\s*memories\.md[^=]*===([\s\S]*?)` + sectionEnd),
  );
  const personaMatch = text.match(
    new RegExp(String.raw`===\s*persona\.md[^=]*===([\s\S]*?)` + sectionEnd),
  );
  const summaryMatch = text.match(/本次更新摘要：([\s\S]*)$/);

  let memoriesPatch = (memoriesMatch?.[1] ?? '').trim();
  let personaPatch = (personaMatch?.[1] ?? '').trim();

  if (!memoriesPatch && !personaPatch) {
    // 完全没按格式输出 → 整段当 memories 增量，绝不丢内容
    const cleaned = text
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/^#+.*$/gm, '')
      .trim();
    memoriesPatch = cleaned;
  }

  memoriesPatch = cleanPatch(memoriesPatch);
  personaPatch = cleanPatch(personaPatch);

  const conflictCount = (text.match(/⚠️|发现冲突|冲突：/g) ?? []).length;

  return {
    memoriesPatch,
    personaPatch,
    summary: (summaryMatch?.[1] ?? '').trim(),
    conflictCount,
    hasUpdate: !isNoUpdate(memoriesPatch) || !isNoUpdate(personaPatch),
  };
}

function cleanPatch(s: string): string {
  return s
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^\s*\[无更新\]\s*$/gm, '')
    .replace(/^\s*\[以上章节有更新\]\s*$/gm, '')
    .trim();
}

function isNoUpdate(s: string): boolean {
  const t = s.trim();
  return t === '' || t === '[无更新]' || /^无更新$/.test(t);
}
