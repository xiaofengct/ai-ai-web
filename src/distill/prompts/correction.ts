/**
 * 来源：`_ref/ex-skill-main/prompts/correction_handler.md`
 * sourceVersion: ex-skill v1.0.0
 *
 * 进化模式：对话纠正（EX-10）。
 * 触发 → 判断归属（memories / persona）→ 生成 Correction 记录 → 追加到对应文件 → 升版本。
 */

/** 纠正意图的触发词（correction_handler.md §触发条件识别） */
export const CORRECTION_TRIGGERS: readonly string[] = [
  '这不对', '不对', '错了', '说错了', '不像她', '不像',
  '她不会这样', '她不会这么说', '她不说', '她不会',
  '她应该是', '她其实是', '她更倾向于', '她其实',
  '你说的不像她', '感觉不太像', '不太像',
  '她遇到这种情况会', '她一般会',
];

/** Correction 记录最多保留条数（correction_handler.md §Correction 层维护规则） */
export const MAX_CORRECTIONS = 50;

export const CORRECTION_HANDLER_PROMPT = `# Correction 处理任务

识别用户的纠正意图，生成标准格式的 Correction 记录，追加到对应文件的 Correction 层。

---

## 用户的原话

{utterance}

## 现有 persona.md（摘要）

{currentPersona}

## 现有 memories.md（摘要）

{currentMemories}

---

## 处理步骤

### Step 1：理解纠正内容
提取：
- **场景**：在什么情况下发生（被冷落 / 吵架 / 撒娇 / 约会 / 节日 …）
- **错误行为**：AI 做了什么不像她的事
- **正确行为**：她实际上会怎么做

### Step 2：判断归属
- 涉及共同记忆、时间地点、偏好习惯 → \`memories.md\`
- 涉及沟通方式、情绪反应、性格表现 → \`persona.md\`

### Step 3：生成 Correction 记录
格式（一行一条）：
\`- [场景：{场景描述}] 不应该 {错误行为}，应该 {正确行为}\`

### Step 4：检查冲突
如果新的 correction 与现有规则冲突，在 \`conflicts\` 里列出，由用户决定「以新纠正为准」还是「两条都保留」。

---

## 输出（严格 JSON，不要代码块）

{"target":"persona","scene":"被冷落时","wrong":"直接说\"你不理我了\"","correct":"已读不回然后发朋友圈","conflicts":[]}

- target：只能是 \`persona\` 或 \`memories\`
- 判断不出来时：target 用 \`persona\`，scene 用 \`通用\`
- conflicts：字符串数组，没有就空数组
`;

/** Correction 记录的结构 */
export interface CorrectionRecord {
  /** 归属 */
  target: 'memories' | 'persona';
  /** 场景 */
  scene: string;
  /** 错误行为（不应该…） */
  wrong: string;
  /** 正确行为（应该…） */
  correct: string;
}

/** 渲染成一行 Correction 记录（与 ex-skill 完全一致的格式） */
export function formatCorrection(r: CorrectionRecord): string {
  return `- [场景：${r.scene}] 不应该 ${r.wrong}，应该 ${r.correct}`;
}

/**
 * 从 Markdown 里解析已有的 Correction 记录块。
 * 用于：展示历史纠正、去重、超限合并。
 */
export function parseCorrections(md: string, target: 'memories' | 'persona'): CorrectionRecord[] {
  const heading = target === 'persona' ? '## Correction 记录' : '## Correction 记录';
  const idx = md.indexOf(heading);
  if (idx === -1) return [];
  const rest = md.slice(idx + heading.length);
  const end = rest.search(/\n---/);
  const block = end === -1 ? rest : rest.slice(0, end);

  const out: CorrectionRecord[] = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^-\s*\[场景：([^\]]+)\]\s*不应该\s*(.+?)，?应该\s*(.+)$/);
    if (m) {
      out.push({ target, scene: m[1].trim(), wrong: m[2].trim(), correct: m[3].trim() });
    }
  }
  return out;
}

/**
 * 把一条 Correction 追加进 Markdown 的 `## Correction 记录` 节。
 * ★ 与 ex-skill 的 skill_writer.update_skill 行为一致：
 *   - 有该节 → 插到标题后（并移除「（暂无记录）」占位）
 *   - 没有该节 → 在文末新建
 */
export function appendCorrection(md: string, line: string): string {
  const heading = '## Correction 记录';
  const idx = md.indexOf(heading);
  if (idx === -1) {
    return `${md.trimEnd()}\n\n## Correction 记录\n\n${line}\n`;
  }
  const insertAt = idx + heading.length;
  let rest = md.slice(insertAt);
  const placeholder = '\n\n（暂无记录）';
  if (rest.startsWith(placeholder)) rest = rest.slice(placeholder.length);
  return `${md.slice(0, insertAt)}\n${line}${rest}`;
}

/** 检测用户这句话是不是纠正意图（本地规则，不花 token） */
export function looksLikeCorrection(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  if (!t) return false;
  return CORRECTION_TRIGGERS.some((k) => t.includes(k.replace(/\s+/g, '')));
}

/**
 * Correction 超限合并（correction_handler.md §Correction 层维护规则：最多 50 条）。
 * 策略：同一 `scene` 的多条合并为 1 条，保留**最新**的表述（后面的覆盖前面的）。
 */
export function mergeCorrections(records: readonly CorrectionRecord[]): {
  merged: CorrectionRecord[];
  mergedCount: number;
} {
  const byScene = new Map<string, CorrectionRecord>();
  const order: string[] = [];
  for (const r of records) {
    const key = r.scene.trim();
    if (!byScene.has(key)) order.push(key);
    // 后来者覆盖前者（优先保留最新表述）
    byScene.set(key, r);
  }
  const merged = order.map((k) => byScene.get(k) as CorrectionRecord);
  return { merged, mergedCount: records.length - merged.length };
}
