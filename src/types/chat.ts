import type { ISODate, UUID } from './common';
import type { ChatSettings } from './settings';

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'sending' | 'streaming' | 'done' | 'failed' | 'merged';

export interface MessageAttachment {
  id: UUID;
  kind: 'image' | 'audio' | 'video' | 'file' | 'sticker';
  /** → blobs 表 */
  assetId: UUID;
  mime: string;
  name?: string;
  width?: number;
  height?: number;
  duration?: number;
  /** OCR 结果（多模态兼容模式降级用，FN-25） */
  ocrText?: string;
}

export interface Message {
  id: UUID;
  sessionId: UUID;
  role: MessageRole;
  /** Markdown 原文 */
  content: string;
  createdAt: ISODate;
  status: MessageStatus;
  tokenEstimate?: number;
  attachments?: MessageAttachment[];
  favorite?: boolean;
  forwardedFrom?: { sessionId: UUID; messageId: UUID };
  forwardedTo?: UUID[];
  mergedFrom?: UUID[];
  proactive?: boolean;
  summaryOf?: { from: ISODate; to: ISODate; count: number };
  errorInfo?: { code: string; message: string };
  /** ★ NicknameGuard 检测结果（只标注不改文本） */
  nicknameWarnings?: string[];
  /** 拍一拍后缀等 */
  props?: Record<string, unknown>;
}

export interface ProactiveState {
  enabled: boolean;
  inheritFromPrev?: boolean;
  intervalMin?: number;
  lastProactiveAt?: ISODate;
  topic?: string;
}

export interface ChatSession {
  id: UUID;
  title: string;
  personaId: UUID;
  createdAt: ISODate;
  updatedAt: ISODate;
  lastMessagePreview?: string;
  /** 会话级设置覆盖（与全局深合并，见 store/settingsStore.effectiveChat） */
  settingsOverride?: Partial<ChatSettings>;
  proactive?: ProactiveState;
  stats?: { messageCount: number; charCount: number; tokenEstimate: number };
  archived?: boolean;
}
