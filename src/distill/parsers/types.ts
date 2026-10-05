import type { RawChunk, RawSourceKind } from '@/types/distill';
import type { DistillFeatureId } from '@/constants/featureIds';

/**
 * 原材料解析器契约（架构文档 §3.10 `src/distill/parsers/types.ts`）。
 *
 * 对应 ex-skill 的 `tools/*.py`（Python 脚本无法在浏览器执行，C1 → 全部 TS 重写）：
 *   wechat.ts   ← tools/wechat_parser.py
 *   imessage.ts ← tools/imessage_parser.py
 *   sms.ts      ← tools/sms_parser.py
 *   photo.ts    ← tools/photo_analyzer.py（基于 exifr，目录遍历降级为手动多选）
 *   social.ts   ← tools/social_media_parser.py
 *   file.ts     ← Read 工具（PDF / 图片 / md / txt）
 *   paste.ts    ← 无工具，直接入库
 */
export interface RawParser {
  /** 原材料种类 */
  kind: RawSourceKind;
  /** UI 展示名（走文案 key 由页面层决定，这里只给技术标签） */
  label: string;
  /** 接受的扩展名（不含点，小写） */
  accept: readonly string[];
  /** 是否支持一次解析多个文件（照片 / 上传文件） */
  multi?: boolean;
  /** 是否支持纯文本输入（粘贴） */
  acceptsText?: boolean;
  /** 解析为归一化 RawChunk[]；失败抛 AppError('PARSE_FAIL' | 'PARSE_UNSUPPORTED') */
  parse(input: ParseInput, opts?: ParseOptions): Promise<RawChunk[]>;
  /** 是否可用（依赖懒加载库是否存在 / 浏览器能力） */
  available(): boolean;
  /** 不可用时给出的降级说明（走欣然文案 key） */
  fallbackHint?: string;
  /** 关联的能力项 ID（用于 <CapabilityGate>） */
  featureId: DistillFeatureId;
  /**
   * ★ 不可实现的模式清单（EX-03 的 `chat.db --direct`）。
   * UI 必须逐条渲染并置灰 + 原因，禁止静默缺失（PRD §11）。
   */
  unavailableModes?: readonly UnavailableMode[];
}

/** 一种「原实现支持、Web 版做不到」的模式 */
export interface UnavailableMode {
  /** 稳定 ID，如 'chat-db-direct' */
  id: string;
  /** 展示名（技术标签，页面层再套文案） */
  label: string;
  /** 不可实现的原因（给用户看，中文） */
  reason: string;
  /** 替代方案文案 key */
  altKey:
    | 'alt.exportOnly'
    | 'alt.manualExportSms'
    | 'alt.manualPickFolder'
    | 'alt.ocrOrDescribe'
    | 'alt.noEquivalent';
  /** 关联能力项 ID */
  featureId: DistillFeatureId;
}

export interface ParseInput {
  file?: File;
  text?: string;
  files?: File[];
  /** 平台（social.ts 用：weibo / douban / xiaohongshu / instagram / text / auto） */
  platform?: SocialPlatform;
}

export interface ParseOptions {
  /** 目标人物（昵称 / 手机号），用于过滤「她发出的消息」；留空则保留全部发言人 */
  target?: string;
  signal?: AbortSignal;
  onProgress?(p: number): void;
  /**
   * 图片类原材料的兜底描述（file.ts / photo.ts 用）。
   * 网页版没有「看懂图片」的原生能力（EX-06），OCR 不可用时由用户手填一句话描述。
   */
  describe?: (file: File) => Promise<string> | string;
}

export type SocialPlatform = 'weibo' | 'douban' | 'xiaohongshu' | 'instagram' | 'text' | 'auto';

/** 解析产物的额外信息（page 层展示用） */
export interface ParseReport {
  kind: RawSourceKind;
  fileName?: string;
  chunks: RawChunk[];
  /** 原始消息条数（过滤前） */
  rawCount: number;
  /** 跳过的条数（系统消息 / 媒体占位） */
  skippedCount: number;
  /** 降级说明（如 EXIF 不可用 → 用 lastModified） */
  degraded?: string;
}
