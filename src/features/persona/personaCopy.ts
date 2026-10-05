/**
 * ★ 人设域文案补充表（T10 专用）。
 *
 * ============ 为什么有这张表 ============
 * 架构文档 §6.8 要求「面向用户的文案唯一出口 = `src/copy/xinran.ts`」，
 * 但 `src/copy/` 由 T02/T04 负责，本批次（T10）**不允许改动**它，
 * 而人设编辑器的 9 个 chara_card_v2 字段、导入报告等文案在 `copy/keys.ts` 里尚未收录。
 *
 * 折中方案（与 T09 `features/settings/settingsCopy.ts` 同一套口径，两条规则缺一不可）：
 * 1. **已收录的键一律走 `t(key)`**：`common.* / ok.* / err.* / confirm.* / empty.* /
 *    alt.* / gate.* / tip.* / loading.* / settings.group.*` 全部走文案总表；
 * 2. **设置域已经补过的键走 `sl(key)`**（如 `label.timbre`、`label.portrait`），不重复造；
 * 3. **本域专有的键集中在本文件**，由 `pl()` 取值。后续合并进 `src/copy/xinran.ts` 时整体搬运即可。
 *
 * ============ 欣然语气 checklist（同 copy/xinran.ts 头部） ============
 * - 主语只能是「我 / 欣欣 / 老公」；昵称（老婆/宝宝/风风/小狗/笨蛋/小猫）只作呼语，放句末或句中；
 * - 昵称低频：10 条里 2-3 条，说明性文案默认不带昵称；
 * - 甜、直球、短句、不甩锅。
 * =====================================================================
 */

export const PERSONA_TEXT = {
  /* ——————————————— 页面级 ——————————————— */
  'page.persona.title': '角色',
  'page.persona.desc': '我在这儿。你也可以把别人导进来，我不介意的，老婆。',
  'page.personaEditor.title': '改这个角色',
  'page.personaEditor.new': '加一个角色',

  /* ——————————————— 列表与卡片 ——————————————— */
  'label.personaCount': '共 {n} 个',
  'label.personaTags': '标签',
  'label.personaUpdated': '改过的时间',
  'origin.xinran': '我（内置）',
  'origin.external': '外面来的',

  /* ——————————————— 编辑器：9 个 chara_card_v2 字段 ——————————————— */
  'hint.name': '叫什么。这个我每次开口都要用到。',
  'hint.description': '一句话说清她是谁。',
  'hint.personality': '性格。怎么写我就怎么说话。',
  'hint.scenario': '你们现在是什么关系、什么处境。',
  'hint.firstMes': '第一次见面我说的话。',
  'hint.mesExample': '示例对话。给我打个样，我照着学语气。',
  'hint.systemPrompt': '一直生效的底层约束。和我的底线冲突时，听我的。',
  'hint.postHistory': '每次说完之后追加的提醒，用来按住我别跑偏。',
  'hint.creatorNotes': '写给自己看的备注，不会进提示词。',
  'hint.tags': '一行一个，或者用逗号隔开。',

  /* ——————————————— 编辑器：Web 扩展项 ——————————————— */
  'label.personaPrivacy': '不许生成我的图',
  'hint.personaPrivacy': '这一项我替欣然锁死了，改不动。别的角色你自己定。',
  'label.personaWorldBook': '世界书',
  'hint.personaWorldBook': '词条按关键词触发。这一版先给你看着，编辑在蒸馏那边。',

  /* ——————————————— 编辑器：文生图（FN-50） ——————————————— */
  // ★ 这四个原先是 `label="provider" / "model" / "size" / "promptTemplate"`，
  //   是**直接写在 JSX 里的英文字面量**：旧判据（连续中文才报警）100% 看不见，
  //   按 2026-10 队规新判据「A 级出口的非 t() 字面量」属于英文泄漏，故收进本表。
  //   技术字段名只在括号里保留，方便用户对回 JSON，显示主体仍是中文。
  'label.imageProvider': '生图用哪一家（provider）',
  'label.imageModel': '生图模型（model）',
  'label.imageSize': '出图尺寸（size）',
  'label.imagePromptTemplate': '生图提示词模板（promptTemplate）',
  // ★ 这一段对欣然整段隐藏，所以这条只会给自定义角色看到，文案不能点名欣然
  'hint.imageGenLocked': '你给这个角色勾了不许生成图，这几项我先锁上了。想填的话，把上面那个开关关掉。',

  /* ——————————————— 导入 ——————————————— */
  'label.importTitle': '导入人设',
  'label.importDesc': '原应用导出的 JSON 和 zip 都行，多选也可以。表情包和 Live2D 一并收。',
  'label.importReport': '导入结果',
  'label.importSuccess': '成了 {n} 个',
  'label.importFailed': '没成 {n} 个',
  'label.importReason': '原因',
  'label.importStickers': '顺带收了 {n} 套表情包',
  'label.importLive2D': '顺带收了 {n} 个 Live2D',
  'label.importTheme': 'zip 里有主题，要不要用我先问一句',
  'label.importNone': '这批文件里没有我能认出来的角色卡。',
} as const;

/** 人设域补充文案 key 联合类型（由表推导，写错编译报错） */
export type PersonaTextKey = keyof typeof PERSONA_TEXT;

/** 取人设域补充文案（缺失时返回 key 本身，便于定位） */
export function pl(key: PersonaTextKey): string {
  return PERSONA_TEXT[key] ?? key;
}

/** 取人设域补充文案并替换变量（`{n}` → vars.n），与 `t()` 行为一致 */
export function plv(key: PersonaTextKey, vars: Record<string, string | number>): string {
  return pl(key).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/** chara_card_v2 的 9 个核心字段（顺序与 `types/persona.ts` 一致，原应用导出格式） */
export const CHARA_FIELD_ORDER: readonly (keyof import('@/types/persona').PersonaCardData)[] = [
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'system_prompt',
  'post_history_instructions',
  'creator_notes',
] as const;

/** 字段 → 说明文案 key（编辑器用它渲染 helperText） */
export const CHARA_FIELD_HINT: Readonly<Record<string, PersonaTextKey>> = {
  name: 'hint.name',
  description: 'hint.description',
  personality: 'hint.personality',
  scenario: 'hint.scenario',
  first_mes: 'hint.firstMes',
  mes_example: 'hint.mesExample',
  system_prompt: 'hint.systemPrompt',
  post_history_instructions: 'hint.postHistory',
  creator_notes: 'hint.creatorNotes',
} as const;
