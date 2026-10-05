/**
 * ★ 存储键名常量（架构文档 §6.5）。
 *
 * 约定：
 * - `SK.*` 全部走 localStorage（小数据、需要同步读取的项）；
 * - 只有 `ai-ai.theme.v1` 允许在 `index.html` 的内联防闪烁脚本里被**提前同步读取**，
 *   因此它的结构必须保持 `{ darkMode, grayscale }` 两个字段，且不要塞大对象；
 * - 大对象（会话/消息/记忆/二进制）一律进 Dexie（`DB_NAME`），不要放这里。
 */
export const SK = {
  /** AppSettings（含 Provider 列表，apiKey 可选加密） */
  settings: 'ai-ai.settings.v1',
  /** 抽屉开合、homeLayout、最近会话 */
  ui: 'ai-ai.ui.v1',
  /** Provider 凭据（可选 AES-GCM） */
  llm: 'ai-ai.llm.v1',
  /** lastProactiveAt / missedTicks */
  proactive: 'ai-ai.proactive.v1',
  /** 引导已读标记 */
  guide: 'ai-ai.guide.v1',
  /**
   * ★ 微信 ClawBot 长轮询的**同步游标**（服务端下发的 `get_updates_buf`）。
   *
   * 为什么不并进 `SK.settings`：它是**每次成功轮询都要写一次**的高频小值。
   * 塞进 settings 会让每一次回存都触发整个 `AppSettings` 的序列化 + persist
   * （几十 KB 的 JSON 反复写），既浪费又抬高配额事故面。
   * 这里单独一个小 key，只存一个字符串。
   */
  ilinkBuf: 'ai-ai.ilink.buf.v1',
  /** ★ 首屏防闪烁只读这一项（dark/grayscale） */
  theme: 'ai-ai.theme.v1',
} as const;

export type StorageKey = (typeof SK)[keyof typeof SK];

/** Dexie 数据库名 */
export const DB_NAME = 'ai-ai-web';

/** idb-keyval 的 store 名（与主库区分，便于单独清空） */
export const KV_STORE_NAME = 'ai-ai-kv';

/** Dexie 表名常量（与 db/db.ts 建表语句一一对应，禁止硬编码字符串） */
export const TABLE = {
  sessions: 'sessions',
  messages: 'messages',
  personas: 'personas',
  memories: 'memories',
  stickers: 'stickers',
  timbres: 'timbres',
  live2d: 'live2d',
  distillJobs: 'distillJobs',
  distillArtifacts: 'distillArtifacts',
  distillRaw: 'distillRaw',
  blobs: 'blobs',
  logs: 'logs',
  backups: 'backups',
  /** settings 镜像（用于备份还原与多标签页协同） */
  settings: 'settings',
  /**
   * 朋友圈动态（2026-10-04 加）。
   * ★ 单开一张表而不是复用 `messages`：动态是**广播**，不属于任何会话 ——
   *   理由见 `types/moment.ts` 文件头（读成对话会造成人格错误）。
   */
  moments: 'moments',
  /**
   * 用户反馈（2026-10-04 加）。
   * ★ 单开一张表而不是复用 `logs`：日志是**应用自己写**的诊断数据，
   *   反馈是**用户写给开发者**的内容，两者的写入方、读取方、生命周期都不同。
   *   混在一起会导致「清空日志」顺手把用户的反馈也删了。理由详见 `types/feedback.ts`。
   */
  feedback: 'feedback',
} as const;

export type TableName = (typeof TABLE)[keyof typeof TABLE];
