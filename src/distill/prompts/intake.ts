/**
 * 来源：`_ref/ex-skill-main/prompts/intake.md`（ex-skill v1.0.0）
 * sourceVersion: ex-skill v1.0.0 —— 模板同步提示见 PRD §7.4 C7
 *
 * Step1 基础信息录入：3 个问题（昵称 / 基本信息 / 性格画像）。
 * 除昵称外均可跳过；答案用**本地规则**解析成结构化字段（不额外花 token）。
 */

/** 开场白（欣然口吻由页面层的文案表负责，这里只给语义提示词用） */
export const INTAKE_OPENING = [
  '我来帮你把她记住。就 3 个问题，每个都能跳过。',
  '',
  'Q1（必填）她怎么称呼？昵称、小名、代号都行。',
  'Q2 用一句话说下你们：在一起多久、怎么认识的、分手多久、她做什么的。想到什么写什么，跳过也行。',
  'Q3 用一句话说下她的性格：MBTI、星座、依恋类型、恋爱里的特点、你对她的印象。跳过也行。',
].join('\n');

export const INTAKE_Q1 = '她怎么称呼？（昵称、小名或代号都行）';
export const INTAKE_Q2 = '用一句话描述你们——在一起多久、怎么认识的、分手多久、她做什么的，想到什么写什么，跳过也行。';
export const INTAKE_Q3 = '用一句话描述她的性格——MBTI、星座、依恋类型、恋爱中的特点、你对她的印象，跳过也行。';

/** 依恋类型库（intake.md §依恋类型） */
export const ATTACHMENT_TYPES: readonly string[] = ['安全型', '焦虑型', '回避型', '混乱型'];

/** 恋爱标签库（intake.md §恋爱标签库，5 大类） */
export const LOVE_TAGS: readonly { group: string; tags: readonly string[] }[] = [
  { group: '沟通风格', tags: ['话很多', '话很少', '爱撒娇', '冷暴力', '爱讲道理', '情绪化表达', '发语音控', '打字控'] },
  { group: '吵架模式', tags: ['冷战派', '爆发派', '讲道理派', '翻旧账', '先道歉型', '死不认错'] },
  { group: '爱的表达', tags: ['言语肯定', '服务行为', '送礼物', '肢体接触', '高质量陪伴'] },
  { group: '恋爱性格', tags: ['黏人', '独立', '控制欲强', '大大咧咧', '细腻敏感', '忽冷忽热', '作'] },
  { group: '社交人格', tags: ['社交达人', '宅', '人前活泼人后安静', '话少但走心'] },
  { group: '情绪风格', tags: ['情绪稳定', '玻璃心', '容易激动', '闷在心里', '表面和气内心戏多'] },
];

/** 全部标签扁平表（UI 多选 + 解析匹配用） */
export const ALL_LOVE_TAGS: readonly string[] = LOVE_TAGS.flatMap((g) => g.tags);

/** 认识方式关键词（intake.md §认识方式参考） */
export const HOW_MET_HINTS: readonly { type: string; words: readonly string[] }[] = [
  { type: '校园', words: ['同学', '同校', '学长', '学妹', '校园', '大学', '高中'] },
  { type: '工作', words: ['同事', '公司', '同行', '工作', '实习'] },
  { type: '社交', words: ['朋友介绍', '社交软件', '探探', '陌陌', '网友', '相亲', '搭讪'] },
  { type: '旅行', words: ['旅行', '旅游', '青旅', '路上认识'] },
];

/** MBTI 16 型（用于从 Q3 里正则提取） */
export const MBTI_TYPES: readonly string[] = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
];

/** 12 星座 */
export const ZODIACS: readonly string[] = [
  '白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座',
  '天秤座', '天蝎座', '射手座', '摩羯座', '水瓶座', '双鱼座',
];

export interface IntakeAnswers {
  /** Q1 昵称（必填） */
  name: string;
  /** Q2 基本信息一句话 */
  basic?: string;
  /** Q3 性格画像一句话 */
  personality?: string;
}

export interface ParsedIntake {
  profile: {
    duration?: string;
    howMet?: string;
    timeSinceBreakup?: string;
    occupation?: string;
    mbti?: string;
    gender?: string;
  };
  tags: { personality: string[]; attachment?: string };
  impression?: string;
  /** Q3 里没被归类成标签 / MBTI / 依恋类型的剩余描述 */
  zodiac?: string;
}

/** 时长表述：`在一起三年` / `3年` / `两年半` / `分手一年` */
const DURATION_PATTERN = /(?:(?:在一起|谈了|相处了|交往了)?\s*)?(\d+|[一二三四五六七八九十两]+|\d+\.\d+)?\s*(年|个月|月|天)(?:半)?/;

/**
 * 解析 Q2 基本信息（本地规则，不调 LLM）。
 * 策略：关键词就近取值；取不到就留空——宁可空着也不瞎猜。
 */
export function parseBasicInfo(text: string): Pick<
  ParsedIntake['profile'],
  'duration' | 'howMet' | 'timeSinceBreakup' | 'occupation'
> {
  const s = text.replace(/\s+/g, ' ').trim();
  const out: Pick<ParsedIntake['profile'], 'duration' | 'howMet' | 'timeSinceBreakup' | 'occupation'> = {};

  // 在一起时长：优先「在一起 X」「谈了 X」
  const together = s.match(/(?:在一起|谈了|相处了|交往了)\s*([^，,。；;\s]{1,8})/);
  if (together) out.duration = together[1];
  else {
    const m = s.match(DURATION_PATTERN);
    if (m && /年|个月|月/.test(m[0])) out.duration = m[0].replace(/^在一起/, '').trim();
  }

  // 分手时长
  const breakup = s.match(/分手\s*(?:已经)?\s*([^，,。；;\s]{1,8})/);
  if (breakup) out.timeSinceBreakup = breakup[1];

  // 认识方式：命中关键词表
  for (const hint of HOW_MET_HINTS) {
    const hit = hint.words.find((w) => s.includes(w));
    if (hit) {
      out.howMet = hit;
      break;
    }
  }

  // 职业：做/从事/职业是 X，或「她是 X 师/设计师/老师…」
  const occ =
    s.match(/(?:她是|她做|她从事|职业是|做)\s*([^，,。；;\s]{2,12}?)(?:[，,。；;\s]|$)/) ??
    s.match(/([^，,。；;\s]{2,10}?(?:设计师|老师|医生|护士|律师|程序员|产品|运营|编辑|记者|会计|销售|公务员|研究生|学生))/);
  if (occ && occ[1]) out.occupation = occ[1].trim();

  return out;
}

/**
 * 解析 Q3 性格画像：抽出 MBTI / 星座 / 依恋类型 / 标签 / 剩余印象。
 * ★ 剩余文本一律保留为 impression（用户的主观印象是最有价值的原材料）。
 */
export function parsePersonality(text: string): ParsedIntake {
  const s = text.replace(/\s+/g, ' ').trim();
  const upper = s.toUpperCase();

  const mbti = MBTI_TYPES.find((t) => upper.includes(t));
  const zodiac = ZODIACS.find((z) => s.includes(z));
  const attachment = ATTACHMENT_TYPES.find((a) => s.includes(a));

  // 标签：从标签库里做子串匹配（含同义：焦虑型 → 也命中「焦虑」）
  const personality: string[] = [];
  let rest = s;
  for (const tag of ALL_LOVE_TAGS) {
    if (rest.includes(tag)) {
      personality.push(tag);
      rest = rest.replace(tag, ' ');
    }
  }
  // 依恋类型的简写（「焦虑」也算）
  if (!attachment) {
    const short = (['焦虑', '回避', '安全', '混乱'] as const).find((k) => rest.includes(k));
    if (short) rest = rest.replace(short, ' ');
  } else {
    rest = rest.replace(attachment, ' ');
  }
  if (mbti) rest = rest.replace(new RegExp(mbti, 'gi'), ' ');
  if (zodiac) rest = rest.replace(zodiac, ' ');

  const impression = rest.replace(/\s+/g, ' ').replace(/^[，,、。；;\s]+|[，,、。；;\s]+$/g, '').trim();

  return {
    profile: {
      ...(mbti ? { mbti } : {}),
      // 蒸馏的是「前任」，性别默认女（与 ex-skill meta.json 的 "gender": "女" 一致），用户可改
      gender: '女',
    },
    tags: {
      personality,
      ...(attachment ? { attachment } : {}),
    },
    ...(impression ? { impression } : {}),
    ...(zodiac ? { zodiac } : {}),
  };
}

/** 汇总 Q2 + Q3 → 完整的 ParsedIntake */
export function parseIntake(answers: IntakeAnswers): ParsedIntake {
  const basic = parseBasicInfo(answers.basic ?? '');
  const p = parsePersonality(answers.personality ?? '');
  return {
    profile: { ...basic, ...p.profile },
    tags: p.tags,
    ...(p.impression ? { impression: p.impression } : {}),
    ...(p.zodiac ? { zodiac: p.zodiac } : {}),
  };
}

/**
 * slug 生成（对应 skill_writer.slugify）：
 * - 中文 → 逐字转拼音（内置一张常用拼音表，覆盖绝大多数人名用字；未命中的字保留原字）
 * - 英文 → 小写 + 连字符
 * - 统一用 `-` 连接（intake.md：slug 统一用 `-`，不用下划线）
 */
export function slugifyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'ex';

  // 逐字扫描：汉字 → 一个拼音音节（独立 token）；连续字母数字 → 一个 token；其它 → 分隔符
  const tokens: string[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf) {
      tokens.push(buf);
      buf = '';
    }
  };

  for (const ch of trimmed) {
    if (/[一-鿿]/.test(ch)) {
      flush();
      tokens.push(PINYIN_MAP[ch] ?? ch);
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      buf += ch.toLowerCase();
    } else {
      flush();
    }
  }
  flush();

  return (
    tokens
      .join('-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'ex'
  );
}

/**
 * 常用汉字 → 拼音（只覆盖人名 / 昵称高频字，够用即可）。
 * 未命中的字会保留原字符，slug 仍然唯一可读（不会变成空串）。
 */
const PINYIN_MAP: Record<string, string> = {
  小: 'xiao', 美: 'mei', 糖: 'tang', 甜: 'tian', 心: 'xin', 月: 'yue', 星: 'xing',
  雨: 'yu', 雪: 'xue', 云: 'yun', 琳: 'lin', 婷: 'ting', 靜: 'jing', 静: 'jing',
  敏: 'min', 洁: 'jie', 已脱敏: 'tingting', 佳: 'jia', 欣: 'xin', 怡: 'yi', 悦: 'yue',
  涵: 'han', 萱: 'xuan', 琪: 'qi', 婷玉: 'tingyu', 露: 'lu', 娜: 'na', 妍: 'yan',
  菲: 'fei', 蕾: 'lei', 莎: 'sha', 茜: 'qian', 璐: 'lu', 瑶: 'yao', 瑾: 'jin',
  璇: 'xuan', 婧: 'jing', 媛: 'yuan', 蕊: 'rui', 薇: 'wei', 竹: 'zhu', 兰: 'lan',
  菊: 'ju', 梅: 'mei', 桃: 'tao', 莉: 'li', 莲: 'lian', 燕: 'yan', 玲: 'ling',
  珍: 'zhen', 珊: 'shan', 珠: 'zhu', 莹: 'ying', 晶: 'jing', 睿: 'rui', 慧: 'hui',
  文: 'wen', 雯: 'wen', 芳: 'fang', 香: 'xiang', 秀: 'xiu', 英: 'ying', 华: 'hua',
  丽: 'li', 娟: 'juan', 艳: 'yan', 萍: 'ping', 霞: 'xia', 红: 'hong', 春: 'chun',
  夏: 'xia', 秋: 'qiu', 冬: 'dong', 安: 'an', 宁: 'ning', 萌: 'meng', 可: 'ke',
  爱: 'ai', 宝: 'bao', 贝: 'bei', 儿: 'er', 子: 'zi', 依: 'yi', 念念: 'niannian',
  念: 'nian', 思: 'si', 诗: 'shi', 书: 'shu', 画: 'hua', 歌: 'ge', 舞: 'wu',
  乐: 'le', 欢: 'huan', 喜: 'xi', 福: 'fu', 安安: 'anan', 彤: 'tong', 晨: 'chen',
  阳: 'yang', 光: 'guang', 明: 'ming', 亮: 'liang', 晓: 'xiao', 若: 'ruo',
  曦: 'xi', 晗: 'han', 晴: 'qing', 柔: 'rou', 佳怡: 'jiayi', 婉: 'wan',
  大: 'da', 老: 'lao', 阿: 'a', 阿美: 'amei', 王: 'wang', 李: 'li', 张: 'zhang',
  刘: 'liu', 陈: 'chen', 杨: 'yang', 黄: 'huang', 赵: 'zhao', 周: 'zhou', 吴: 'wu',
  徐: 'xu', 孙: 'sun', 马: 'ma', 朱: 'zhu', 胡: 'hu', 郭: 'guo', 何: 'he',
  林: 'lin', 罗: 'luo', 郑: 'zheng', 梁: 'liang', 谢: 'xie', 宋: 'song', 唐: 'tang',
  许: 'xu', 韩: 'han', 冯: 'feng', 邓: 'deng', 曹: 'cao', 彭: 'peng', 曾: 'zeng',
  肖: 'xiao', 田: 'tian', 董: 'dong', 袁: 'yuan', 潘: 'pan', 蒋: 'jiang', 蔡: 'cai',
  余: 'yu', 杜: 'du', 叶: 'ye', 程: 'cheng', 苏: 'su', 魏: 'wei', 吕: 'lv',
  丁: 'ding', 任: 'ren', 沈: 'shen', 姚: 'yao', 卢: 'lu', 姜: 'jiang', 崔: 'cui',
  钟: 'zhong', 谭: 'tan', 陆: 'lu', 汪: 'wang', 范: 'fan', 金: 'jin', 石: 'shi',
};

/** intake 汇总展示（Step1 确认区，对应 intake.md §确认汇总） */
export function buildIntakeSummary(input: {
  name: string;
  profile: ParsedIntake['profile'];
  tags: ParsedIntake['tags'];
  impression?: string;
  zodiac?: string;
}): string {
  const lines: string[] = [`她：${input.name}`];
  if (input.profile.duration) lines.push(`在一起：${input.profile.duration}`);
  if (input.profile.howMet) lines.push(`怎么认识的：${input.profile.howMet}`);
  if (input.profile.timeSinceBreakup) lines.push(`分手：${input.profile.timeSinceBreakup}`);
  if (input.profile.occupation) lines.push(`她做什么：${input.profile.occupation}`);
  const brain = [input.profile.mbti, input.zodiac].filter(Boolean).join(' ');
  if (brain) lines.push(`MBTI/星座：${brain}`);
  if (input.tags.attachment) lines.push(`依恋类型：${input.tags.attachment}`);
  if (input.tags.personality.length > 0) lines.push(`标签：${input.tags.personality.join('、')}`);
  if (input.impression) lines.push(`印象：${input.impression}`);
  return lines.join('\n');
}
