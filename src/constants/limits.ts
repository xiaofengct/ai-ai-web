/**
 * 上限常量（架构文档：MAX_VERSIONS=10、上下文预算、分批字符数 8000、备份保留份数）。
 * 魔法数字一律进这里，禁止散落在业务代码里（§6.1）。
 */

/** 蒸馏产物版本快照上限（EX-09，超出自动清理最旧的） */
export const MAX_VERSIONS = 10;

/** 上下文预算预留：contextWindow - maxTokens - RESERVE */
export const CONTEXT_RESERVE = 512;

/** 蒸馏/总结分批字符数（EX-08、C6） */
export const BATCH_CHARS = 8000;

/** 日志滚动保留条数（§6.3） */
export const LOG_KEEP = 2000;

/** 自动备份默认保留份数（FN-47 / SV-08） */
export const DEFAULT_BACKUP_KEEP = 5;

/** 会话消息总数上限（FN-36，超出归档到归档区，不删除） */
export const MAX_MESSAGES_PER_SESSION = 20000;

/** 单次导入文件数上限 */
export const MAX_IMPORT_FILES = 200;

/** 单文件大小上限（100MB，防止误选超大文件打爆 IndexedDB） */
export const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** 表情包单包条目上限 */
export const MAX_STICKERS_PER_PACK = 500;

/** 记忆条目软上限（超过提示用户清理） */
export const MAX_MEMORY_ENTRIES = 5000;

/** 单条消息最大字符数（超出提示拆分） */
export const MAX_MESSAGE_CHARS = 20000;

/** 昵称频率守卫：近 N 条消息内统计 */
export const NICKNAME_WINDOW = 10;
/** 近 N 条里最多允许 M 条以昵称开场（XR-05 / PRD §8.4） */
export const NICKNAME_MAX_OPENING = 3;

/** 心跳间隔：页面可见时 scheduler tick（ms） */
export const TICK_VISIBLE_MS = 30_000;
/** 心跳间隔：页面隐藏时 Worker 心跳（ms） */
export const TICK_HIDDEN_MS = 300_000;

/** 空闲判定默认阈值（分钟，FN-09 停用超时） */
export const DEFAULT_IDLE_TIMEOUT_MIN = 30;

/** 防抖默认间隔（ms） */
export const DEFAULT_DEBOUNCE_MS = 300;

/** 浏览器端 token 估算：ASCII 4 字符 ≈ 1 token */
export const CHARS_PER_ASCII_TOKEN = 4;

/** 导出 zip 的目录前缀 */
export const EXPORT_ROOT = 'ai-ai-backup';

/* ------------------------------------------------------------
   提示词装配预算（T06 · PersonaCompiler）
   魔法数字一律在这里，段实现里不写死（§6.1）
   ------------------------------------------------------------ */

/** 未拿到 Provider contextWindow 时的兜底上下文窗口 */
export const DEFAULT_CONTEXT_WINDOW = 32768;

/** 世界书（character_book）总预算上限（token） */
export const WORLD_BOOK_TOKEN_BUDGET = 2000;

/** 记忆注入段的默认预算上限（token） */
export const MEMORY_TOKEN_BUDGET = 1200;

/** scenario 段截断长度（字符） */
export const MAX_SCENARIO_CHARS = 800;

/** personality 段截断长度（字符） */
export const MAX_PERSONALITY_CHARS = 1500;

/** mes_example 段截断长度（字符） */
export const MAX_EXAMPLES_CHARS = 1200;

/** 世界书关键词命中时回溯的历史消息条数 */
export const WORLD_BOOK_LOOKBACK = 10;
