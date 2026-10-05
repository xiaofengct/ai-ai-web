/**
 * ★ 记忆域文案补充表（T10 专用）。
 *
 * 与 `features/persona/personaCopy.ts`、`features/settings/settingsCopy.ts` 同一套口径：
 * 1. 已收录的键走 `t(key)`；
 * 2. 设置域已补过的键走 `sl(key)`（`label.memoryScope` / `label.memoryThreshold` 等）；
 * 3. 本域专有的键才放这儿，后续整体搬进 `src/copy/xinran.ts`。
 *
 * 语气规则同 `copy/xinran.ts` 头部 checklist。
 */

export const MEMORY_TEXT = {
  /* ——————————————— 页面级 ——————————————— */
  'page.memory.title': '记忆',
  'page.memory.desc': '你跟我说过的事我都记着。想不起来的时候，来这儿翻。',
  'page.memoryEditor.title': '改这条记忆',
  'page.memoryEditor.new': '记一条',

  /* ——————————————— 列表 ——————————————— */
  'label.memoryCount': '共 {n} 条',
  'label.memoryContent': '记了什么',
  'label.memoryTags': '标签',
  'label.memoryScore': '得分',
  'label.memoryWeight': '权重',
  'label.memoryTimeRef': '时间',
  'label.memoryCorrection': '改过的记录',
  'label.memoryAllTags': '全部',
  'label.memoryFilterTag': '按标签',
  'label.memoryMinScore': '得分不低于',
  'label.memoryNothing': '这个条件下我还没记住什么。',
  'hint.memoryWeight': '你手动置顶的权重。越大我越先想起来。',
  'hint.memoryScore': '关键词匹配的相关性分数，不是语义相似度。',
  'hint.memoryTimeRef': '这条事发生的时间。留空就是记下来的时间。',

  /* ——————————————— 总结范围（PG-11 / FN-48）——————————————— */
  'label.summaryTitle': '总结一段对话',
  'label.summaryDesc': '挑一段，我把重点记下来。',
  'label.summarySession': '哪段对话',
  'label.summaryMode': '按什么选',
  'label.summaryFrom': '从',
  'label.summaryTo': '到',
  'label.summaryCount': '最近几条',
  'label.summaryAnchorStart': '从哪条开始',
  'label.summaryAnchorEnd': '到哪条结束',
  'label.summaryStart': '开始总结',
  'label.summaryNoMessage': '这段里还没有消息。',
  'mode.time': '按时间',
  'mode.count': '按条数',
  'mode.anchor': '按锚点',
  'mode.all': '全部',
  'hint.summaryMode': '时间 = 按发生的时间挑；条数 = 取最近几条；锚点 = 你指定起止；全部 = 整段都算。',
} as const;

/** 记忆域补充文案 key 联合类型 */
export type MemoryTextKey = keyof typeof MEMORY_TEXT;

/** 取记忆域补充文案（缺失时返回 key 本身） */
export function ml(key: MemoryTextKey): string {
  return MEMORY_TEXT[key] ?? key;
}

/** 取记忆域补充文案并替换变量（`{n}` / `{m}` → vars） */
export function mlv(key: MemoryTextKey, vars: Record<string, string | number>): string {
  return ml(key).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}
