import type { ISODate, UUID } from '@/types/common';
import type { MessageStatus } from '@/types/chat';
import type { LogLevel, LogScope } from '@/types/log';
import type { DistillStatus } from '@/types/distill';

/**
 * Dexie 表记录类型（架构文档 §2 `db/schema.ts`）。
 *
 * 索引设计理由（**每一条都写了为什么**）：
 * - `messages[sessionId+createdAt]`：会话内按时间正序/倒序取分页，是最热的查询路径；
 * - `messages[sessionId+favorite]`：收藏页（PG-08）按会话分组；
 * - `messages[createdAt]`：全局时间线（统计 PG-01、归档裁剪）；
 * - `memories[sessionId]`、`memories[score]`、`memories[*tags]`：范围记忆 + 得分排序 + 标签过滤；
 * - `blobs[path]`：逻辑路径唯一（stickers/xxx.png、distill/{slug}/...），导入去重靠它；
 * - `logs[at]`：滚动保留时按时间删最旧的；
 * - `sessions[updatedAt]`：会话列表按最近活跃排序。
 * 注：Dexie 的 `&` 表示唯一索引，`*` 表示多值索引（数组字段）。
 */

/** sessions */
export interface DBSessionRow {
  id: UUID;
  title: string;
  personaId: UUID;
  createdAt: ISODate;
  updatedAt: ISODate;
  lastMessagePreview?: string;
  settingsOverride?: Record<string, unknown>;
  proactive?: Record<string, unknown>;
  stats?: { messageCount: number; charCount: number; tokenEstimate: number };
  archived?: 0 | 1; // IndexedDB 无法索引 undefined/boolean 混合，用 0/1
}

/** messages */
export interface DBMessageRow {
  id: UUID;
  sessionId: UUID;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: ISODate;
  status: MessageStatus;
  tokenEstimate?: number;
  attachments?: unknown[];
  favorite?: 0 | 1;
  forwardedFrom?: { sessionId: UUID; messageId: UUID };
  forwardedTo?: UUID[];
  mergedFrom?: UUID[];
  proactive?: 0 | 1;
  summaryOf?: { from: ISODate; to: ISODate; count: number };
  errorInfo?: { code: string; message: string };
  /** ★ NicknameGuard 检测结果（只标注不改文本） */
  nicknameWarnings?: string[];
  props?: Record<string, unknown>;
}

/** personas */
export interface DBPersonaRow {
  id: UUID;
  spec: 'chara_card_v2';
  specVersion: '2.0';
  data: Record<string, unknown>;
  origin: 'xinran' | 'external';
  modelId?: UUID;
  timbreId?: UUID;
  portrait?: unknown[];
  imageGen?: Record<string, unknown>;
  privacy?: { noImage: boolean };
  isBuiltin?: 0 | 1;
  distillJobId?: UUID;
  /** 欣然的排序位（置顶用） */
  pinned?: 0 | 1;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** memories */
export interface DBMemoryRow {
  id: UUID;
  sessionId?: UUID;
  personaId?: UUID;
  content: string;
  /** 多值索引（memories[*tags]） */
  tags: string[];
  score: number;
  weight?: number;
  sourceMessageIds?: UUID[];
  timeRef?: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
  correction?: string[];
}

/** stickers（表情包「包」，条目内嵌在 items 里） */
export interface DBStickerPackRow {
  id: UUID;
  name: string;
  items: { description: string; fileName: string; assetId?: UUID }[];
  createdAt: ISODate;
  enabled: 0 | 1;
  builtin?: 0 | 1;
}

/** timbres */
export interface DBTimbreRow {
  id: UUID;
  name: string;
  provider: 'web-speech' | 'siliconflow' | 'custom';
  refAssetId?: UUID;
  externalVoiceId?: string;
  sampleText?: string;
  speed?: number;
  pitch?: number;
  createdAt: ISODate;
}

/** live2d（模型元数据，zip 本体在 blobs） */
export interface DBLive2DRow {
  id: UUID;
  name: string;
  zipAssetId: UUID;
  modelJsonPath: string;
  motions?: string[];
  scale?: number;
  offset?: { x: number; y: number };
  createdAt: ISODate;
}

/** blobs：统一二进制大对象（图片/音频/zip/参考音） */
export interface DBBlobRow {
  id: UUID;
  /** 逻辑路径，唯一索引 */
  path: string;
  mime: string;
  size: number;
  data: Blob | Uint8Array;
  createdAt: ISODate;
}

/** distillJobs */
export interface DBDistillJobRow {
  id: UUID;
  slug: string;
  name: string;
  profile: Record<string, string | undefined>;
  tags: { personality: string[]; attachment?: string };
  impression?: string;
  status: DistillStatus;
  sources: unknown[];
  createdAt: ISODate;
  updatedAt: ISODate;
  version: string;
  correctionsCount: number;
  errorInfo?: { code: string; message: string };
}

/** distillArtifacts */
export interface DBDistillArtifactRow {
  jobId: UUID;
  slug: string;
  memoriesMd: string;
  personaMd: string;
  metaJson: string;
  skillMd: string;
  versions: unknown[];
  personaCardId?: UUID;
  updatedAt: ISODate;
}

/** distillRaw：原材料原文归档（大文本放这里，避免 job 行膨胀） */
export interface DBDistillRawRow {
  id: UUID;
  jobId: UUID;
  slug: string;
  kind: string;
  fileName?: string;
  chunks: unknown[];
  createdAt: ISODate;
}

/** logs */
export interface DBLogRow {
  id: UUID;
  at: ISODate;
  level: LogLevel;
  scope: LogScope;
  featureId?: string;
  message: string;
  detail?: unknown;
}

/** backups（备份快照；bundle 本体可放 blobs，这里存元信息 + 内联文件） */
export interface DBBackupRow {
  id: UUID;
  createdAt: ISODate;
  appVersion: string;
  kind: 'manual' | 'auto';
  counts: { sessions: number; messages: number; personas: number; memories: number };
  sizeBytes: number;
  /** 序列化的 bundle（zip 字节；大备份放 blobs，这里只存引用路径） */
  blobPath?: string;
  inline?: Record<string, string>;
}

/** settings 镜像（多标签页协同 + 备份还原） */
export interface DBSettingsRow {
  /** 固定主键 'app' */
  key: string;
  value: Record<string, unknown>;
  updatedAt: ISODate;
}

/**
 * moments（朋友圈动态，2026-10-04 加）。
 *
 * ★ 字段与 `types/moment.ts` 的 `Moment` **同构**（不像 personas 那样做 row/domain 转换），
 *   因为它没有需要转换的嵌套结构 —— 全部是标量、字符串数组。
 *   多一层 `toDomain` / `toRow` 只会新增两处「改一处忘一处」的面，不换来任何好处。
 */
export interface DBMomentRow {
  id: UUID;
  authorId: string;
  authorKind: 'user' | 'persona';
  authorName: string;
  content: string;
  /** blob 逻辑路径（不是 blob id） */
  images: string[];
  mood?: string;
  /** 点赞者标识数组（幂等；理由见 types/moment.ts） */
  likedBy: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

/**
 * feedback（用户反馈，2026-10-04 加）。
 *
 * ★ 与 `types/feedback.ts` 的 `FeedbackItem` **同构**（理由同 `DBMomentRow`）：
 *   字段全是标量、字符串数组之外没有嵌套需要转换的结构，
 *   多一层 `toDomain` / `toRow` 只会新增"改一处忘一处"的面。
 *   `env` 是**一层**嵌套对象（不是数组），Dexie 原样存取，不需要拆列。
 */
export interface DBFeedbackRow {
  id: UUID;
  kind: string;
  content: string;
  contact?: string;
  env: Record<string, string>;
  status: string;
  adminNote?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** 全量表结构（供 Dexie 泛型使用） */
export interface AiAiDBSchema {
  sessions: DBSessionRow;
  messages: DBMessageRow;
  personas: DBPersonaRow;
  memories: DBMemoryRow;
  stickers: DBStickerPackRow;
  timbres: DBTimbreRow;
  live2d: DBLive2DRow;
  blobs: DBBlobRow;
  distillJobs: DBDistillJobRow;
  distillArtifacts: DBDistillArtifactRow;
  distillRaw: DBDistillRawRow;
  logs: DBLogRow;
  backups: DBBackupRow;
  settings: DBSettingsRow;
  moments: DBMomentRow;
  feedback: DBFeedbackRow;
}
