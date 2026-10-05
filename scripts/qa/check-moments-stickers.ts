#!/usr/bin/env node
/**
 * 表情包 + 动态 的**逻辑**回归（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 覆盖什么、不覆盖什么
 * ═══════════════════════════════════════════════════════════════════════════
 * 本脚本测的是**纯逻辑**（不启浏览器、不启数据库）：
 *   · 动态发布闸门的七关判定（含边界：正好卡在间隔上、正好卡在上限上）
 *   · 北京日界的"今天"切分（跨时区不跑偏）
 *   · 从自由文本抠 URL（粘贴链接那条路）
 *   · 联网图片的**安全校验**（协议白名单 / 域名黑名单 / 像不像图片 / 去重）
 *   · 语义标签匹配的边界（空标签、没有图片时不配）
 *
 * **不测**（需要浏览器 / 真实搜索服务，属另一条验收线）：
 *   · 真实 `webSearchImages()` 请求（要用户配 Key）
 *   · blob 读写与图片渲染（那是 `check-sticker-e2e` 的职责）
 *
 * ★ 为什么把闸门逻辑单独抽出来测：
 *   它有七条路径，而真机上"为什么这次没发"**看不出来** ——
 *   用户等一小时发现没发，无法区分是"间隔没到"还是"她的作息不允许"。
 *   这类"静默不发生"的逻辑，只能靠单元断言把每条路径钉住。
 *
 * 用法：npx tsx scripts/qa/check-moments-stickers.mjs
 */
import { evaluateMomentGate, beijingDayKey, summarizeRecentMoments } from '@/proactive/momentGate';
import { detectEmotionHint, STICKER_PROBABILITY } from '@/proactive/stickerPicker';
import { screenStickerUrls, validateManualUrl } from '@/features/stickers/stickerSearch';
import { labelFromFileName, isImageFile } from '@/features/stickers/stickerImport';
import { extractUrls } from '@/lib/text';
import { DEFAULT_CHAT_SETTINGS } from '@/constants/defaults';
import type { ChatSettings } from '@/types/settings';
import type { WorldPack } from '@/world/types';

let failed = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (!cond) failed += 1;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? `  ${detail}` : ''}`);
}
function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, a === e ? '' : `实际 ${a}｜期望 ${e}`);
}

/** 造一份 chat 设置（覆盖 moments 部分字段） */
function chatWith(moments: Partial<ChatSettings['moments']>): ChatSettings {
  return {
    ...DEFAULT_CHAT_SETTINGS,
    moments: { ...DEFAULT_CHAT_SETTINGS.moments, ...moments },
  };
}

console.log('\n═══ 表情包 / 动态 逻辑回归 ═══\n');

/* ══════════════ ① 动态闸门：七关 ══════════════ */
console.log('① 动态发布闸门（七关，逐条钉住）');

ok(
  '默认设置就是关的（这是"要用户显式打开"的保证）',
  DEFAULT_CHAT_SETTINGS.moments.enabled === false,
  `实际 enabled=${DEFAULT_CHAT_SETTINGS.moments.enabled}`,
);

eq(
  '① 没开 ⇒ disabled',
  evaluateMomentGate({ chat: chatWith({ enabled: false }), personaId: 'p', todayCount: 0 }).reason,
  'disabled',
);
eq(
  '② 没角色 ⇒ noPersona',
  evaluateMomentGate({ chat: chatWith({ enabled: true }), todayCount: 0 }).reason,
  'noPersona',
);
eq(
  '③ 间隔不够 ⇒ tooSoon',
  evaluateMomentGate({
    chat: chatWith({ enabled: true, intervalMin: 60 }),
    personaId: 'p',
    minutesSinceLast: 59.9,
    todayCount: 0,
  }).reason,
  'tooSoon',
);
{
  const r = evaluateMomentGate({
    chat: chatWith({ enabled: true, intervalMin: 60 }),
    personaId: 'p',
    minutesSinceLast: 59,
    todayCount: 0,
  });
  eq('③ 附带的"还要等多久" = 1 分钟', r.waitMinutes, 1);
}
ok(
  '③ 间隔**正好**到（60 ≥ 60）⇒ 放行（边界含等号）',
  evaluateMomentGate({
    chat: chatWith({ enabled: true, intervalMin: 60 }),
    personaId: 'p',
    minutesSinceLast: 60,
    todayCount: 0,
  }).allowed,
);
eq(
  '④ 今日发满 ⇒ dailyCap',
  evaluateMomentGate({
    chat: chatWith({ enabled: true, intervalMin: 30, maxPerDay: 3 }),
    personaId: 'p',
    todayCount: 3,
  }).reason,
  'dailyCap',
);
eq(
  '④ 差一条就满 ⇒ 放行，且剩余 1',
  evaluateMomentGate({
    chat: chatWith({ enabled: true, intervalMin: 30, maxPerDay: 3 }),
    personaId: 'p',
    todayCount: 2,
  }).remainingToday,
  1,
);
ok(
  '无世界设定 ⇒ 世界三关全跳过（旧行为，不内置版要能用）',
  evaluateMomentGate({
    chat: chatWith({ enabled: true, intervalMin: 30 }),
    personaId: 'p',
    todayCount: 0,
  }).allowed,
);

/* —— 世界相关三关 —— */
/** 造一个"永远静默"的世界（静默覆盖全天，且锚点固定） */
const QUIET_WORLD: WorldPack = {
  version: 1,
  source: { kind: 'builtin', name: 'test' },
  rhythm: { quietHours: { from: '00:00', to: '23:59' } },
  entries: [],
  report: { recognized: [], textOnly: [], warnings: [] },
};
/** 造一个"活跃时段为空"的世界（白班活跃窗口设成不可能的区间） */
const NO_ACTIVE_WORLD: WorldPack = {
  version: 1,
  source: { kind: 'builtin', name: 'test' },
  rhythm: {
    activeHours: { 白班: { from: '03:00', to: '03:01' } },
  },
  schedule: { anchorDate: '2026-09-05', cycle: ['白班'] },
  entries: [],
  report: { recognized: [], textOnly: [], warnings: [] },
};

{
  // 用一个"北京时间正午"的时刻，避开真实当前时间带来的不确定性
  const noon = new Date('2026-10-04T04:00:00Z'); // UTC 04:00 = 北京 12:00
  eq(
    '⑤ 世界深夜静默 ⇒ worldQuiet',
    evaluateMomentGate({
      chat: chatWith({ enabled: true, intervalMin: 30 }),
      personaId: 'p',
      todayCount: 0,
      world: QUIET_WORLD,
      now: noon,
    }).reason,
    'worldQuiet',
  );
  eq(
    '⑥ 不在活跃时段 ⇒ notActiveHours',
    evaluateMomentGate({
      chat: chatWith({ enabled: true, intervalMin: 30, onlyActiveHours: true }),
      personaId: 'p',
      todayCount: 0,
      world: NO_ACTIVE_WORLD,
      now: noon,
    }).reason,
    'notActiveHours',
  );
  ok(
    '⑥ 关掉 onlyActiveHours ⇒ 同样条件下**放行**（用户表达的是"别管她的作息"）',
    evaluateMomentGate({
      chat: chatWith({ enabled: true, intervalMin: 30, onlyActiveHours: false }),
      personaId: 'p',
      todayCount: 0,
      world: NO_ACTIVE_WORLD,
      now: noon,
    }).allowed,
  );
}

/* ══════════════ ② 北京日界 ══════════════ */
console.log('\n② 「今天」按北京时间切（不受设备时区影响）');
{
  // UTC 2026-10-04 16:30 = 北京 2026-10-05 00:30 ⇒ 北京已经是"5 号"
  eq('UTC 16:30 属北京次日', beijingDayKey(new Date('2026-10-04T16:30:00Z')), '2026-10-05');
  // UTC 2026-10-04 15:59 = 北京 23:59 ⇒ 还是 4 号
  eq('UTC 15:59 仍属北京当日', beijingDayKey(new Date('2026-10-04T15:59:00Z')), '2026-10-04');
}

/* ══════════════ ③ 今日计数与上一条时间 ══════════════ */
console.log('\n③ 统计「今天发了几条 / 上一条多久前」');
{
  const now = new Date('2026-10-04T12:00:00Z'); // 北京 20:00
  const moments = [
    // 北京 19:30 发的（同一天）
    { authorKind: 'persona', createdAt: '2026-10-04T11:30:00Z' },
    // 北京 10:00 发的（同一天）
    { authorKind: 'persona', createdAt: '2026-10-04T02:00:00Z' },
    // 用户自己发的，**不该计数**（只数角色发的）
    { authorKind: 'user', createdAt: '2026-10-04T11:55:00Z' },
    // 北京昨天发的，不该计入今天
    { authorKind: 'persona', createdAt: '2026-10-03T02:00:00Z' },
  ];
  const s = summarizeRecentMoments(moments, now);
  eq('今天角色发了 2 条（用户那 1 条不算）', s.todayCount, 2);
  eq('上一条是 30 分钟前', Math.round(s.minutesSinceLast ?? -1), 30);
}
{
  const s = summarizeRecentMoments([], new Date());
  eq('一条都没有时 todayCount = 0', s.todayCount, 0);
  ok('一条都没有时 minutesSinceLast 为 undefined（= 立即可发）', s.minutesSinceLast === undefined);
}

/* ══════════════ ④ 情绪线索识别 ══════════════ */
console.log('\n④ 情绪线索（决定"要不要配表情"）');
ok('「累死了」命中累', detectEmotionHint('今天白班，累死了') === '累');
ok('「哈哈」命中哈哈', detectEmotionHint('哈哈哈哈这个太好笑了') !== null);
ok('「想你」命中想你', detectEmotionHint('突然有点想你') !== null);
ok(
  '中性陈述**不命中**（"文件我收到了"）',
  detectEmotionHint('文件我收到了，明天给你') === null,
  `实际 ${JSON.stringify(detectEmotionHint('文件我收到了，明天给你'))}`,
);
ok('空文本不命中', detectEmotionHint('') === null);
ok(
  `概率门槛在 (0,1] 之间（实际 ${STICKER_PROBABILITY}）`,
  STICKER_PROBABILITY > 0 && STICKER_PROBABILITY <= 1,
);

/* ══════════════ ⑤ 从自由文本抠 URL ══════════════ */
console.log('\n⑤ 粘贴链接（用户经常连上下文一起复制）');
eq('纯链接', extractUrls('https://a.com/x.png'), ['https://a.com/x.png']);
eq(
  '带前后文字',
  extractUrls('这张不错 https://a.com/x.png 收下了'),
  ['https://a.com/x.png'],
);
eq('末尾带中文标点也能抠出来', extractUrls('看这个https://a.com/x.png。'), ['https://a.com/x.png']);
eq('末尾带英文句号也能抠出来', extractUrls('see https://a.com/x.png.'), ['https://a.com/x.png']);
eq('多个链接都抠出来', extractUrls('a https://a.com/1.png b https://b.com/2.gif').length, 2);
eq('重复链接只留一个', extractUrls('https://a.com/x.png https://a.com/x.png').length, 1);
eq('没有链接就返回空数组', extractUrls('这里一个链接都没有'), []);
eq('非法 URL 不当候选', extractUrls('https://'), []);

/* ══════════════ ⑥ 联网图片的安全校验 ══════════════ */
console.log('\n⑥ 联网图片校验（内容安全的第一道关）');
{
  const r = screenStickerUrls(
    [
      'https://i.imgur.com/abc123.png', // ✅ 好
      'http://insecure.com/a.png', // ❌ 非 https
      'https://pornhub.com/a.png', // ❌ 域名黑名单
      'https://example.com/page.html', // ❌ 不像图片
      'javascript:alert(1)', // ❌ 伪协议
      'data:image/png;base64,AAAA', // ❌ 伪协议
      'https://i.imgur.com/abc123.png', // ❌ 与第 1 条重复
      'not a url at all', // ❌ 格式不对
      'https://media.giphy.com/media/x/giphy.gif', // ✅ giphy 命中图床白名单
    ],
    '猫',
  );
  eq('通过 2 张', r.candidates.length, 2);
  ok('https 图床链接通过', r.candidates[0]?.url === 'https://i.imgur.com/abc123.png');
  ok('giphy 命中"图床放宽"规则（URL 结尾有 .gif 也过，只是双重保证）', r.candidates.some((c) => c.host.includes('giphy')));
  const reasons = new Set(r.rejected.map((x) => x.reason));
  ok('http 被挡（badProtocol）', reasons.has('badProtocol'));
  ok('黑名单域名被挡（blockedDomain）', reasons.has('blockedDomain'));
  ok('非图片路径被挡（notAnImage）', reasons.has('notAnImage'));
  ok('重复被去重（duplicate）', reasons.has('duplicate'));
  ok('格式不对被挡（malformed）', reasons.has('malformed'));
  ok('默认语义标签 = 搜索词（看不到图时不瞎猜）', r.candidates.every((c) => c.description === '猫'));
  ok('每张都带来源域名（内容安全可见）', r.candidates.every((c) => c.host.length > 0));
}
{
  const r = screenStickerUrls(['https://a.com/1.png', 'https://a.com/2.png', 'https://a.com/3.png'], 'x', 2);
  eq('limit 生效（只要前 2 张）', r.candidates.length, 2);
}
{
  eq('手动粘贴 https 图片 ⇒ ok', validateManualUrl('https://i.imgur.com/x.png').ok, true);
  eq('手动粘贴 http ⇒ 拒绝', validateManualUrl('http://x.com/a.png').ok, false);
  eq('手动粘贴黑名单 ⇒ 拒绝', validateManualUrl('https://pornhub.com/a.jpg').ok, false);
  eq('手动粘贴纯文字 ⇒ 拒绝', validateManualUrl('随便写点东西').ok, false);
}

/* ══════════════ ⑦ 导入：文件名与格式判定 ══════════════ */
console.log('\n⑦ 导入（标签推断与格式判定）');
eq('去扩展名当标签', labelFromFileName('喵.png'), '喵');
eq('去掉前导序号（01_喵）', labelFromFileName('01_喵.png'), '喵');
eq('去掉 12-开心', labelFromFileName('12-开心.gif'), '开心');
eq('去掉 3.生气', labelFromFileName('3.生气.jpg'), '生气');
eq('没扩展名也能用', labelFromFileName('贴贴'), '贴贴');
eq('纯数字文件名不崩', labelFromFileName('01.png'), '01.png'.replace(/\.png$/, ''));

ok('png 认', isImageFile('a.png'));
ok('手机拍的 JPEG 认（大写扩展名）', isImageFile('IMG_0001.JPEG'));
ok('MIME 说 image 就认（哪怕没有扩展名）', isImageFile('blob', 'image/webp'));
ok('gif 认', isImageFile('x.gif'));
ok('zip **不**算图片', !isImageFile('pack.zip'));
ok('mp4 不算图片', !isImageFile('v.mp4'));

/* ══════════════ 汇总 ══════════════ */
console.log('\n═══════════════════════════════════════════');
console.log(failed === 0 ? '\x1b[32m全部通过\x1b[0m' : `\x1b[31m失败 ${failed} 项\x1b[0m`);
console.log('═══════════════════════════════════════════\n');
process.exit(failed === 0 ? 0 : 1);
