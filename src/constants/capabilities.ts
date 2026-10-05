import type { CopyKey } from '@/copy/keys';
import type { CapabilityLevel } from '@/types/common';
import type { FeatureId } from './featureIds';
import { ALL_FEATURE_IDS, TOTAL_FEATURE_COUNT } from './featureIds';

/**
 * ★ 能力表：141 项功能的可行性 / 原因 / 替代方案（架构文档 §6.10、D5）。
 *
 * 用途：驱动 `<CapabilityGate>` 统一表达「不可实现 / 部分实现」——
 * 置灰 + 原因 Tooltip + 替代方案文案。**不允许静默缺失**（PRD §11）。
 *
 * level 与 PRD 可行性列的映射：
 * - `full`         ← 可完整实现      → 原样渲染
 * - `partial`      ← 部分实现        → 渲染但带说明 Tooltip
 * - `alternative`  ← 需替代实现      → 渲染但带说明 Tooltip（通常是换了技术方案）
 * - `unavailable`  ← 不可实现        → disabled + 置灰 + Tooltip（原因 + 替代方案）
 *
 * ★ 降级说明写在 `note` 里（如「页面隐藏时不保证触发」），文案走 `copy/xinran.ts` 的 `alt.*`。
 */
export interface CapabilityMeta {
  /** 'PG-01' | 'FN-50' ... */
  id: FeatureId;
  level: CapabilityLevel;
  /** 不可实现 / 部分实现的原因（中文） */
  reason: CopyKey;
  /** 替代方案文案 key（走 copy/xinran.ts） */
  alternative?: CopyKey;
  /** 降级说明（如「页面隐藏时不保证触发」） */
  note?: CopyKey;
  /** 分组名（UI 分组展示用） */
  group: '页面' | '后台能力' | '设置项' | '平台能力' | '蒸馏' | '欣然人格';
}

export const CAPABILITIES: Record<FeatureId, CapabilityMeta> = {
  /* ===================== 6.1 页面 PG-01 ~ PG-27 ===================== */
  'PG-01': {
    id: 'PG-01',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-01',
    alternative: 'alt.notNeeded',
  },
  'PG-02': {
    id: 'PG-02',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-02',
    alternative: 'alt.notNeeded',
  },
  'PG-03': {
    id: 'PG-03',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-03',
    alternative: 'alt.notNeeded',
  },
  'PG-04': {
    id: 'PG-04',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-04',
    alternative: 'alt.ttsFallback',
    // ★ 三条必备信息：默认关闭 / 缺产物静默回退 / 等级=技术可达≠开箱即用
    note: 'cap.note.PG-04',
  },
  'PG-05': {
    id: 'PG-05',
    level: 'alternative',
    group: '页面',
    reason: 'cap.reason.PG-05',
    alternative: 'alt.realtimeThreeStage',
    note: 'cap.note.PG-05',
  },
  'PG-06': {
    id: 'PG-06',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-06',
    alternative: 'alt.notNeeded',
  },
  'PG-07': {
    id: 'PG-07',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-07',
    alternative: 'alt.notNeeded',
  },
  'PG-08': {
    id: 'PG-08',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-08',
    alternative: 'alt.notNeeded',
  },
  'PG-09': {
    id: 'PG-09',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-09',
    alternative: 'alt.notNeeded',
  },
  'PG-10': {
    id: 'PG-10',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-10',
    alternative: 'alt.notNeeded',
  },
  'PG-11': {
    id: 'PG-11',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-11',
    alternative: 'alt.notNeeded',
  },
  'PG-12': {
    id: 'PG-12',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-12',
    alternative: 'alt.notNeeded',
  },
  'PG-13': {
    id: 'PG-13',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-13',
    alternative: 'alt.notNeeded',
  },
  'PG-14': {
    id: 'PG-14',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-14',
    alternative: 'alt.notNeeded',
  },
  'PG-15': {
    id: 'PG-15',
    level: 'partial',
    group: '页面',
    reason: 'cap.reason.PG-15',
    alternative: 'alt.layoutToggle',
  },
  'PG-16': {
    id: 'PG-16',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-16',
    alternative: 'alt.notNeeded',
  },
  'PG-17': {
    id: 'PG-17',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-17',
    alternative: 'alt.notNeeded',
  },
  'PG-18': {
    id: 'PG-18',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-18',
    alternative: 'alt.notNeeded',
  },
  'PG-19': {
    id: 'PG-19',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-19',
    alternative: 'alt.notNeeded',
  },
  'PG-20': {
    id: 'PG-20',
    level: 'partial',
    group: '页面',
    reason: 'cap.reason.PG-20',
    alternative: 'alt.webProbe',
  },
  'PG-21': {
    id: 'PG-21',
    level: 'partial',
    group: '页面',
    reason: 'cap.reason.PG-21',
    alternative: 'alt.staticSponsor',
  },
  'PG-22': {
    id: 'PG-22',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-22',
    alternative: 'alt.notNeeded',
  },
  'PG-23': {
    id: 'PG-23',
    /*
     * ★ 2026-10-04 由 `unavailable` 上调为 `partial`。
     *
     * 原判「unavailable」依据的是「微信无开放的个人机器人接口」—— 该前提**已不成立**：
     * 微信团队上线了 ClawBot 官方通道（iLink Bot 平台，`ilinkai.weixin.qq.com`），
     * 本仓库已据此实现 `src/ilink/**` 并接入设置页。
     *
     * 判 `partial` 而非 `full` 的理由（三条限制都是真实的，不许写轻）：
     *   ① 只在**手机原生 App** 里可用；浏览器必带 4 个自定义请求头 ⇒ 触发 CORS 预检、大概率被拒；
     *   ② 只在**前台**收得到消息（长轮询在页面隐藏时停打服务端，息屏/被杀收不到）；
     *   ③ 只走**文字**（图片/语音需原生二进制上传 + silk 编解码，本版未实现）。
     * 另：iLink 给的是**独立的 ClawBot 机器人通道**（通讯录里多一个好友），
     * 不是个人微信号的接口 —— 所以 `cap.reason.SV-03` 里「个人号无官方接口」**仍然是事实**。
     *
     * ⚠️ 这次上调会改变「能力总览」的分档计数（partial +3 / unavailable −3），
     *    回归脚本 `scripts/qa/run-regression.mjs` 里写死的档位数字需同步更新。
     */
    level: 'partial',
    group: '页面',
    reason: 'cap.reason.PG-23',
    alternative: 'alt.manualImport',
    note: 'cap.note.PG-23',
  },
  'PG-24': {
    id: 'PG-24',
    level: 'partial',
    group: '页面',
    reason: 'cap.reason.PG-24',
    alternative: 'alt.iframeSandbox',
  },
  'PG-25': {
    id: 'PG-25',
    level: 'partial',
    group: '页面',
    reason: 'cap.reason.PG-25',
    alternative: 'alt.browserPermission',
  },
  'PG-26': {
    id: 'PG-26',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-26',
    alternative: 'alt.notNeeded',
  },
  'PG-27': {
    id: 'PG-27',
    level: 'full',
    group: '页面',
    reason: 'cap.reason.PG-27',
    alternative: 'alt.notNeeded',
  },

  /* ===================== 6.2 后台能力 SV-01 ~ SV-11 ===================== */
  'SV-01': {
    id: 'SV-01',
    level: 'partial',
    group: '后台能力',
    reason: 'cap.reason.SV-01',
    alternative: 'alt.floatingWindow',
    note: 'cap.note.SV-01',
  },
  'SV-02': {
    id: 'SV-02',
    // ★ 2026-10-04 由 `unavailable` 上调为 `partial`：同 PG-23。
    //   理由见 PG-23 处的长注释（原生可用 / 仅前台 / 仅文字）。
    level: 'partial',
    group: '后台能力',
    reason: 'cap.reason.SV-02',
    alternative: 'alt.manualImport',
  },
  'SV-03': {
    id: 'SV-03',
    // ★ 2026-10-04 由 `unavailable` 上调为 `partial`：同 PG-23。
    //   注意：`cap.reason.SV-03` 里「个人号无官方接口」**仍成立**（iLink 是独立的 bot 通道），
    //   所以该条 reason 只改前半句、保留这句 —— 见 clawbot-spec 的改动说明。
    level: 'partial',
    group: '后台能力',
    reason: 'cap.reason.SV-03',
    alternative: 'alt.manualImport',
  },
  'SV-04': {
    id: 'SV-04',
    level: 'partial',
    group: '后台能力',
    reason: 'cap.reason.SV-04',
    alternative: 'alt.floatingWindow',
    note: 'cap.note.SV-04',
  },
  'SV-05': {
    id: 'SV-05',
    level: 'unavailable',
    group: '后台能力',
    reason: 'cap.reason.SV-05',
    alternative: 'alt.manualImport',
    note: 'cap.note.SV-05',
  },
  'SV-06': {
    id: 'SV-06',
    level: 'partial',
    group: '后台能力',
    reason: 'cap.reason.SV-06',
    alternative: 'alt.heartbeat',
    note: 'cap.note.SV-06',
  },
  'SV-07': {
    id: 'SV-07',
    level: 'partial',
    group: '后台能力',
    reason: 'cap.reason.SV-07',
    alternative: 'alt.broadcastChannel',
  },
  'SV-08': {
    id: 'SV-08',
    level: 'full',
    group: '后台能力',
    reason: 'cap.reason.SV-08',
    alternative: 'alt.notNeeded',
  },
  'SV-09': {
    id: 'SV-09',
    level: 'unavailable',
    group: '后台能力',
    reason: 'cap.reason.SV-09',
    alternative: 'alt.manualImport',
  },
  'SV-10': {
    id: 'SV-10',
    level: 'unavailable',
    group: '后台能力',
    reason: 'cap.reason.SV-10',
    alternative: 'alt.pwaInstall',
  },
  'SV-11': {
    id: 'SV-11',
    level: 'unavailable',
    group: '后台能力',
    reason: 'cap.reason.SV-11',
    alternative: 'alt.restoreOnStart',
  },

  /* ===================== 6.3 设置项 FN-01 ~ FN-63 ===================== */
  'FN-01': { id: 'FN-01', level: 'full', group: '设置项', reason: 'cap.reason.FN-01', alternative: 'alt.notNeeded' },
  'FN-02': {
    id: 'FN-02',
    level: 'full',
    group: '设置项',
    reason: 'cap.reason.FN-02',
    alternative: 'alt.notNeeded',
    // ★ 已知限制（2026-10-04 补记，验收前不实现）：
    //   ① **PNG 载体角色卡暂不支持**——`chara_card_v2` 嵌在 PNG 的 tEXt 块里，
    //      解析要另起链路，收益/风险不划算。导入 PNG 不再硬失败，而是**显式报错 +
    //      计入 ImportReport`（文案 `err.importPngCard`），并引导改用 .json / .zip。
    //   ② 卡片字段键名**中英文都认**（别名表见 `src/persona/importer.ts` 的 CARD_KEY），
    //      早期只认英文键名会让中文键名的卡被静默丢弃（导入 10 本只进来 9 本）。
    note: 'cap.note.FN-02',
  },
  'FN-03': { id: 'FN-03', level: 'full', group: '设置项', reason: 'cap.reason.FN-03', alternative: 'alt.notNeeded' },
  'FN-04': { id: 'FN-04', level: 'full', group: '设置项', reason: 'cap.reason.FN-04', alternative: 'alt.notNeeded' },
  'FN-05': { id: 'FN-05', level: 'full', group: '设置项', reason: 'cap.reason.FN-05', alternative: 'alt.notNeeded' },
  'FN-06': {
    id: 'FN-06',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-06',
    alternative: 'alt.heartbeat',
    note: 'cap.note.FN-06',
  },
  'FN-07': { id: 'FN-07', level: 'full', group: '设置项', reason: 'cap.reason.FN-07', alternative: 'alt.notNeeded' },
  'FN-08': { id: 'FN-08', level: 'full', group: '设置项', reason: 'cap.reason.FN-08', alternative: 'alt.notNeeded' },
  'FN-09': { id: 'FN-09', level: 'full', group: '设置项', reason: 'cap.reason.FN-09', alternative: 'alt.notNeeded' },
  'FN-10': {
    id: 'FN-10',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-10',
    alternative: 'alt.proactiveNight',
  },
  'FN-11': { id: 'FN-11', level: 'full', group: '设置项', reason: 'cap.reason.FN-11', alternative: 'alt.notNeeded' },
  'FN-12': { id: 'FN-12', level: 'full', group: '设置项', reason: 'cap.reason.FN-12', alternative: 'alt.notNeeded' },
  'FN-13': { id: 'FN-13', level: 'full', group: '设置项', reason: 'cap.reason.FN-13', alternative: 'alt.notNeeded' },
  'FN-14': {
    id: 'FN-14',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-14',
    alternative: 'alt.dynamicProactive',
  },
  'FN-15': { id: 'FN-15', level: 'full', group: '设置项', reason: 'cap.reason.FN-15', alternative: 'alt.notNeeded' },
  'FN-16': {
    id: 'FN-16',
    level: 'unavailable',
    group: '设置项',
    reason: 'cap.reason.FN-16',
    alternative: 'alt.exitConfirm',
    note: 'cap.note.FN-16',
  },
  'FN-17': { id: 'FN-17', level: 'full', group: '设置项', reason: 'cap.reason.FN-17', alternative: 'alt.notNeeded' },
  'FN-18': {
    id: 'FN-18',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-18',
    alternative: 'alt.backgroundWorker',
  },
  'FN-19': {
    id: 'FN-19',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-19',
    alternative: 'alt.notificationToast',
  },
  'FN-20': {
    id: 'FN-20',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-20',
    alternative: 'alt.notificationToast',
  },
  'FN-21': { id: 'FN-21', level: 'full', group: '设置项', reason: 'cap.reason.FN-21', alternative: 'alt.notNeeded' },
  'FN-22': { id: 'FN-22', level: 'full', group: '设置项', reason: 'cap.reason.FN-22', alternative: 'alt.notNeeded' },
  'FN-23': { id: 'FN-23', level: 'full', group: '设置项', reason: 'cap.reason.FN-23', alternative: 'alt.notNeeded' },
  'FN-24': { id: 'FN-24', level: 'full', group: '设置项', reason: 'cap.reason.FN-24', alternative: 'alt.notNeeded' },
  'FN-25': { id: 'FN-25', level: 'full', group: '设置项', reason: 'cap.reason.FN-25', alternative: 'alt.notNeeded' },
  'FN-26': { id: 'FN-26', level: 'full', group: '设置项', reason: 'cap.reason.FN-26', alternative: 'alt.notNeeded' },
  'FN-27': { id: 'FN-27', level: 'full', group: '设置项', reason: 'cap.reason.FN-27', alternative: 'alt.notNeeded' },
  'FN-28': {
    id: 'FN-28',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-28',
    alternative: 'alt.truncateMemory',
  },
  'FN-29': { id: 'FN-29', level: 'full', group: '设置项', reason: 'cap.reason.FN-29', alternative: 'alt.notNeeded' },
  'FN-30': { id: 'FN-30', level: 'full', group: '设置项', reason: 'cap.reason.FN-30', alternative: 'alt.notNeeded' },
  'FN-31': { id: 'FN-31', level: 'full', group: '设置项', reason: 'cap.reason.FN-31', alternative: 'alt.notNeeded' },
  'FN-32': { id: 'FN-32', level: 'full', group: '设置项', reason: 'cap.reason.FN-32', alternative: 'alt.notNeeded' },
  'FN-33': {
    id: 'FN-33',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-33',
    alternative: 'alt.imageGenOptional',
  },
  'FN-34': { id: 'FN-34', level: 'full', group: '设置项', reason: 'cap.reason.FN-34', alternative: 'alt.notNeeded' },
  'FN-35': { id: 'FN-35', level: 'full', group: '设置项', reason: 'cap.reason.FN-35', alternative: 'alt.notNeeded' },
  'FN-36': { id: 'FN-36', level: 'full', group: '设置项', reason: 'cap.reason.FN-36', alternative: 'alt.notNeeded' },
  'FN-37': {
    id: 'FN-37',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-37',
    alternative: 'alt.floatingWindow',
  },
  'FN-38': { id: 'FN-38', level: 'full', group: '设置项', reason: 'cap.reason.FN-38', alternative: 'alt.notNeeded' },
  'FN-39': { id: 'FN-39', level: 'full', group: '设置项', reason: 'cap.reason.FN-39', alternative: 'alt.notNeeded' },
  'FN-40': { id: 'FN-40', level: 'full', group: '设置项', reason: 'cap.reason.FN-40', alternative: 'alt.notNeeded' },
  'FN-41': { id: 'FN-41', level: 'full', group: '设置项', reason: 'cap.reason.FN-41', alternative: 'alt.notNeeded' },
  'FN-42': {
    id: 'FN-42',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-42',
    alternative: 'alt.yandereSeasoning',
    note: 'cap.note.FN-42',
  },
  'FN-43': {
    id: 'FN-43',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-43',
    alternative: 'alt.layoutCollapse',
  },
  'FN-44': { id: 'FN-44', level: 'full', group: '设置项', reason: 'cap.reason.FN-44', alternative: 'alt.notNeeded' },
  'FN-45': {
    id: 'FN-45',
    level: 'alternative',
    group: '设置项',
    reason: 'cap.reason.FN-45',
    alternative: 'alt.corsProxy',
  },
  'FN-46': { id: 'FN-46', level: 'full', group: '设置项', reason: 'cap.reason.FN-46', alternative: 'alt.notNeeded' },
  'FN-47': { id: 'FN-47', level: 'full', group: '设置项', reason: 'cap.reason.FN-47', alternative: 'alt.notNeeded' },
  'FN-48': { id: 'FN-48', level: 'full', group: '设置项', reason: 'cap.reason.FN-48', alternative: 'alt.notNeeded' },
  'FN-49': { id: 'FN-49', level: 'full', group: '设置项', reason: 'cap.reason.FN-49', alternative: 'alt.notNeeded' },
  'FN-50': {
    id: 'FN-50',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-50',
    alternative: 'alt.imageGenPersonaHidden',
    note: 'cap.note.FN-50',
  },
  'FN-51': { id: 'FN-51', level: 'full', group: '设置项', reason: 'cap.reason.FN-51', alternative: 'alt.notNeeded' },
  'FN-52': { id: 'FN-52', level: 'full', group: '设置项', reason: 'cap.reason.FN-52', alternative: 'alt.notNeeded' },
  'FN-53': {
    id: 'FN-53',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-53',
    alternative: 'alt.gpuPerformance',
    note: 'cap.note.FN-53',
  },
  'FN-54': {
    id: 'FN-54',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-54',
    alternative: 'alt.floatingWindow',
  },
  'FN-55': {
    id: 'FN-55',
    level: 'full',
    group: '设置项',
    reason: 'cap.reason.FN-55',
    alternative: 'alt.webSpeech',
    note: 'cap.note.FN-55',
  },
  'FN-56': { id: 'FN-56', level: 'full', group: '设置项', reason: 'cap.reason.FN-56', alternative: 'alt.notNeeded' },
  'FN-57': {
    id: 'FN-57',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-57',
    alternative: 'alt.bm25Score',
  },
  'FN-58': {
    id: 'FN-58',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-58',
    alternative: 'alt.webProbe',
  },
  'FN-59': {
    id: 'FN-59',
    level: 'full',
    group: '设置项',
    reason: 'cap.reason.FN-59',
    alternative: 'alt.webSpeech',
    note: 'cap.note.FN-59',
  },
  'FN-60': { id: 'FN-60', level: 'full', group: '设置项', reason: 'cap.reason.FN-60', alternative: 'alt.notNeeded' },
  'FN-61': { id: 'FN-61', level: 'full', group: '设置项', reason: 'cap.reason.FN-61', alternative: 'alt.notNeeded' },
  'FN-62': {
    id: 'FN-62',
    level: 'partial',
    group: '设置项',
    reason: 'cap.reason.FN-62',
    alternative: 'alt.customHeaderOnly',
  },
  'FN-63': { id: 'FN-63', level: 'full', group: '设置项', reason: 'cap.reason.FN-63', alternative: 'alt.notNeeded' },

  /* ===================== 6.4 平台能力 PL-01 ~ PL-21 ===================== */
  'PL-01': { id: 'PL-01', level: 'full', group: '平台能力', reason: 'cap.reason.PL-01', alternative: 'alt.notNeeded' },
  'PL-02': { id: 'PL-02', level: 'full', group: '平台能力', reason: 'cap.reason.PL-02', alternative: 'alt.notNeeded' },
  'PL-03': { id: 'PL-03', level: 'full', group: '平台能力', reason: 'cap.reason.PL-03', alternative: 'alt.notNeeded' },
  'PL-04': {
    id: 'PL-04',
    level: 'unavailable',
    group: '平台能力',
    reason: 'cap.reason.PL-04',
    alternative: 'alt.noEquivalent',
  },
  'PL-05': {
    id: 'PL-05',
    level: 'unavailable',
    group: '平台能力',
    reason: 'cap.reason.PL-05',
    alternative: 'alt.floatingWindow',
  },
  'PL-06': {
    id: 'PL-06',
    level: 'unavailable',
    group: '平台能力',
    reason: 'cap.reason.PL-06',
    alternative: 'alt.manualImport',
  },
  'PL-07': { id: 'PL-07', level: 'unavailable', group: '平台能力', reason: 'cap.reason.PL-07', alternative: 'alt.noEquivalent' },
  'PL-08': {
    id: 'PL-08',
    level: 'unavailable',
    group: '平台能力',
    reason: 'cap.reason.PL-08',
    alternative: 'alt.pwaInstall',
  },
  'PL-09': {
    id: 'PL-09',
    level: 'partial',
    group: '平台能力',
    reason: 'cap.reason.PL-09',
    alternative: 'alt.heartbeat',
  },
  'PL-10': {
    id: 'PL-10',
    level: 'partial',
    group: '平台能力',
    reason: 'cap.reason.PL-10',
    alternative: 'alt.heartbeat',
  },
  'PL-11': {
    id: 'PL-11',
    level: 'partial',
    group: '平台能力',
    reason: 'cap.reason.PL-11',
    alternative: 'alt.singleFilePicker',
  },
  'PL-12': {
    id: 'PL-12',
    level: 'partial',
    group: '平台能力',
    reason: 'cap.reason.PL-12',
    alternative: 'alt.visualFeedback',
  },
  'PL-13': {
    id: 'PL-13',
    level: 'full',
    group: '平台能力',
    reason: 'cap.reason.PL-13',
    alternative: 'alt.notNeeded',
    note: 'cap.note.PL-13',
  },
  'PL-14': {
    id: 'PL-14',
    level: 'full',
    group: '平台能力',
    reason: 'cap.reason.PL-14',
    alternative: 'alt.notNeeded',
    note: 'cap.note.PL-14',
  },
  'PL-15': {
    id: 'PL-15',
    level: 'alternative',
    group: '平台能力',
    reason: 'cap.reason.PL-15',
    alternative: 'alt.onnxOptional',
  },
  'PL-16': {
    id: 'PL-16',
    level: 'partial',
    group: '平台能力',
    reason: 'cap.reason.PL-16',
    alternative: 'alt.workerSandbox',
  },
  'PL-17': { id: 'PL-17', level: 'full', group: '平台能力', reason: 'cap.reason.PL-17', alternative: 'alt.notNeeded' },
  'PL-18': {
    id: 'PL-18',
    level: 'partial',
    group: '平台能力',
    reason: 'cap.reason.PL-18',
    alternative: 'alt.tesseract',
  },
  'PL-19': {
    id: 'PL-19',
    level: 'unavailable',
    group: '平台能力',
    reason: 'cap.reason.PL-19',
    alternative: 'alt.noEquivalent',
  },
  'PL-20': {
    id: 'PL-20',
    level: 'alternative',
    group: '平台能力',
    reason: 'cap.reason.PL-20',
    alternative: 'alt.localLog',
  },
  'PL-21': {
    id: 'PL-21',
    level: 'unavailable',
    group: '平台能力',
    reason: 'cap.reason.PL-21',
    alternative: 'alt.notApplicable',
  },

  /* ===================== 6.5 ex-skill EX-01 ~ EX-10 ===================== */
  'EX-01': { id: 'EX-01', level: 'full', group: '蒸馏', reason: 'cap.reason.EX-01', alternative: 'alt.notNeeded' },
  'EX-02': {
    id: 'EX-02',
    level: 'alternative',
    group: '蒸馏',
    reason: 'cap.reason.EX-02',
    alternative: 'alt.tsRewrite',
  },
  'EX-03': {
    id: 'EX-03',
    level: 'alternative',
    group: '蒸馏',
    reason: 'cap.reason.EX-03',
    alternative: 'alt.exportOnly',
    note: 'cap.note.EX-03',
  },
  'EX-04': {
    id: 'EX-04',
    level: 'partial',
    group: '蒸馏',
    reason: 'cap.reason.EX-04',
    alternative: 'alt.manualPickFolder',
    note: 'cap.note.EX-04',
  },
  'EX-05': {
    id: 'EX-05',
    level: 'partial',
    group: '蒸馏',
    reason: 'cap.reason.EX-05',
    alternative: 'alt.genericTextFallback',
  },
  'EX-06': {
    id: 'EX-06',
    level: 'partial',
    group: '蒸馏',
    reason: 'cap.reason.EX-06',
    alternative: 'alt.ocrOrDescribe',
  },
  'EX-07': { id: 'EX-07', level: 'full', group: '蒸馏', reason: 'cap.reason.EX-07', alternative: 'alt.notNeeded' },
  'EX-08': {
    id: 'EX-08',
    level: 'alternative',
    group: '蒸馏',
    reason: 'cap.reason.EX-08',
    alternative: 'alt.tsRewrite',
    note: 'cap.note.EX-08',
  },
  // 注意：此处是 6 层（蒸馏产物 persona.md 的 6 个 ## 标题，第 6 层为 Correction 记录）。
  // 欣然的 5 层（XR-* / docs/persona/xinran-persona.md）是另一套，不要混用。
  'EX-09': { id: 'EX-09', level: 'full', group: '蒸馏', reason: 'cap.reason.EX-09', alternative: 'alt.notNeeded' },
  'EX-10': { id: 'EX-10', level: 'full', group: '蒸馏', reason: 'cap.reason.EX-10', alternative: 'alt.notNeeded' },

  /* ===================== 6.6 欣然人格 XR-01 ~ XR-09 ===================== */
  'XR-01': { id: 'XR-01', level: 'full', group: '欣然人格', reason: 'cap.reason.XR-01', alternative: 'alt.notNeeded' },
  'XR-02': { id: 'XR-02', level: 'full', group: '欣然人格', reason: 'cap.reason.XR-02', alternative: 'alt.notNeeded' },
  'XR-03': {
    id: 'XR-03',
    level: 'partial',
    group: '欣然人格',
    reason: 'cap.reason.XR-03',
    alternative: 'alt.proactiveHidden',
  },
  'XR-04': { id: 'XR-04', level: 'full', group: '欣然人格', reason: 'cap.reason.XR-04', alternative: 'alt.notNeeded' },
  'XR-05': {
    id: 'XR-05',
    level: 'full',
    group: '欣然人格',
    reason: 'cap.reason.XR-05',
    alternative: 'alt.notNeeded',
  },
  'XR-06': { id: 'XR-06', level: 'full', group: '欣然人格', reason: 'cap.reason.XR-06', alternative: 'alt.notNeeded' },
  'XR-07': { id: 'XR-07', level: 'full', group: '欣然人格', reason: 'cap.reason.XR-07', alternative: 'alt.notNeeded' },
  'XR-08': { id: 'XR-08', level: 'full', group: '欣然人格', reason: 'cap.reason.XR-08', alternative: 'alt.notNeeded' },
  'XR-09': {
    id: 'XR-09',
    level: 'partial',
    group: '欣然人格',
    reason: 'cap.reason.XR-09',
    alternative: 'alt.stickerAndCopy',
  },
};

/**
 * ★ 类型守卫：把 `string` 收窄成 `FeatureId`（用真实的 ID 清单做判断，不是断言）。
 *
 * 为什么必须有它：`CAPABILITIES[id as FeatureId]` 这种**断言**会绕过 `Record<FeatureId, _>` 的完备性检查——
 * 拼错的 id（比如 `'PG-1'`）编译期静默通过，运行时落进 `useCapability` 的「未收录」分支
 * （`level: 'full'` / `reason: 'cap.reason.full'`），**表现为「这项能力显示为完全可用」**。
 * 能力总览页是我们兑现「对暂无法实现的功能明确标注原因」的页面，它一旦谎报，等于废掉 PRD §11「禁止静默缺失」。
 * 换成守卫之后，未收录的 id 走的是明确的"未收录"分支，不再假装它已收录。
 *
 * ★ 语义保持不变：未收录的 id 仍然按既有行为视为 `full`（避免误置灰）。
 *   "未收录该显示成什么"是一个产品判断，**本改动只负责让断言消失，不负责改口径**。
 *   ★ 2026-10-04 归口时已顺手把 `reason: ''` 换成 `cap.reason.full`——
 *     空串在 `reason` 改成 `CopyKey` 后编译不过，而且它本来就是个显示 bug
 *     （`CapabilityGate` 渲染 `t('gate.reasonPrefix')` + 空串 ⇒ 界面上是「原因：」后面一片空白）。
 *     **换 key 是为了能编译 + 消掉空白，不是改"未收录视为 full"这个产品判断。**
 */
/**
 * ★ 模块级 Set，别在守卫里线性扫数组：`isFeatureId` 会被 `<CapabilityGate>` 在渲染路径上调用，
 *   一个页面几十个 gate × 每次 141 项线性扫描，白给。建表一次、查表 O(1)。
 *   （software-engineer-2 提的，收益不大但零风险，做了。）
 */
const FEATURE_ID_SET: ReadonlySet<string> = new Set<string>(ALL_FEATURE_IDS);

export function isFeatureId(id: string): id is FeatureId {
  return FEATURE_ID_SET.has(id);
}

/** 取能力元信息（未收录的 ID 视为 full，避免误置灰） */
export function useCapability(id: string): CapabilityMeta {
  // ★ 只有"未收录"这条分支还需要断言：它要造一个 `id` 并非真实 FeatureId 的 CapabilityMeta，
  //   `CapabilityMeta.id` 的类型是 `FeatureId`，没有断言过不了编译。这是**唯一**剩下的合法断言，
  //   且它是诚实的——它就在"未收录"分支上，一看就知道这个 id 不是真 id。
  return isFeatureId(id)
    ? CAPABILITIES[id]
    // ★ `reason` 现在是 `CopyKey`，不能再用空串（编译不过，且会让 UI 渲染出「原因：」+ 空白）。
    //   `cap.reason.full` 就是为这条分支建的（2026-10-04 归口时新增）。
    : { id: id as FeatureId, level: 'full', reason: 'cap.reason.full', group: '设置项' };
}

/** 取能力元信息（非 Hook 版本，便于在工具函数里调用） */
export function getCapability(id: string): CapabilityMeta | undefined {
  return isFeatureId(id) ? CAPABILITIES[id] : undefined;
}

/** 是否完全可用（level === 'full'） */
export function isFullyAvailable(id: string): boolean {
  return isFeatureId(id) ? CAPABILITIES[id].level === 'full' : true;
}

/** 是否不可实现（需要置灰） */
export function isUnavailable(id: string): boolean {
  return isFeatureId(id) ? CAPABILITIES[id].level === 'unavailable' : false;
}

/** 自检：能力表是否覆盖全部 141 项（开发者页可展示；缺失项会在控制台告警） */
export function auditCapabilities(): { total: number; missing: FeatureId[]; byLevel: Record<CapabilityLevel, number> } {
  const missing = ALL_FEATURE_IDS.filter((id) => !CAPABILITIES[id]);
  const byLevel: Record<CapabilityLevel, number> = { full: 0, partial: 0, alternative: 0, unavailable: 0 };
  for (const meta of Object.values(CAPABILITIES)) byLevel[meta.level] += 1;
  return { total: Object.keys(CAPABILITIES).length, missing: missing as FeatureId[], byLevel };
}

/** 期望总数（PRD §10.1 = 141），自检用 */
export const EXPECTED_FEATURE_COUNT = TOTAL_FEATURE_COUNT;
