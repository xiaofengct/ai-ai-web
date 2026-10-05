import { blobRepo } from '@/db/repo/blobRepo';
import { PROVIDER_PRESETS } from '@/constants/providers';
import type { Message, MessageAttachment } from '@/types/chat';
import type { LLMProviderConfig } from '@/types/settings';
import type { LLMMessage } from '../types';

/**
 * 多模态兼容模式（FN-25）。
 *
 * 浏览器直连的很多端点**不支持视觉输入**。策略：
 * - 支持视觉 → 发送 `image_url` 内容块；
 * - 不支持 / 开了 `multimodalCompatMode` → **降级为文字**：`[图片：xxx]` + OCR 文本（若有），
 *   保证「用户发了图」这件事不会静默丢失；
 * - 拿不到 blob（已删除 / IndexedDB 异常）→ 同样降级为文字，不抛错。
 *
 * ★ 为什么拆成 sync / async 两套：
 *   `PersonaCompiler.build()` 是**同步**的（提示词装配不能 await），
 *   所以编译器只走 `toLLMMessages()`（文字降级）；
 *   真正要发图时由 chatStore 调 `toLLMMessagesAsync()` 生成带 image_url 的消息体。
 */

export interface MultimodalOptions {
  /** 端点是否支持视觉（不传则按 Provider 预设推断） */
  supportsVision?: boolean;
  /** FN-25 多模态兼容模式：强制走文字降级 */
  compatMode: boolean;
}

/** 按 Provider 预设判断是否支持视觉（自定义端点保守判定为不支持） */
export function supportsVision(provider: LLMProviderConfig): boolean {
  const base = provider.baseUrl.replace(/\/+$/, '').toLowerCase();
  if (!base) return false;
  for (const preset of PROVIDER_PRESETS) {
    const presetBase = preset.baseUrl.replace(/\/+$/, '').toLowerCase();
    if (presetBase && base === presetBase) return preset.supportsVision;
  }
  return false;
}

/** 附件 → 文字降级描述（★ 保证「发过图」这件事在上下文里留痕） */
export function attachmentToText(attachment: MessageAttachment): string {
  const name = attachment.name?.trim() || '未命名';
  switch (attachment.kind) {
    case 'image': {
      const ocr = attachment.ocrText?.trim();
      return ocr ? `[图片：${name}]（图片里的字：${ocr}）` : `[图片：${name}]`;
    }
    case 'audio':
      return `[语音：${name}]`;
    case 'video':
      return `[视频：${name}]`;
    case 'file':
      return `[文件：${name}]`;
    case 'sticker':
      return `[表情：${name}]`;
    default:
      return `[附件：${name}]`;
  }
}

/** 附件是否可作为图片发送 */
function isImageAttachment(attachment: MessageAttachment): boolean {
  if (attachment.kind !== 'image') return false;
  return attachment.mime.startsWith('image/');
}

/**
 * 同步构造用户消息内容（编译器用）。
 * 视觉可用时**仍只放文字**——因为拿 blob URL 需要 await；真正的图片由 async 版本补。
 */
export function buildUserContentSync(
  text: string,
  attachments: readonly MessageAttachment[] = [],
): LLMMessage['content'] {
  if (attachments.length === 0) return text;
  const parts = attachments.map(attachmentToText);
  const head = text.trim();
  return head ? `${parts.join('\n')}\n${head}` : parts.join('\n');
}

/**
 * 异步构造用户消息内容（真正发起请求时用）。
 * 视觉可用 + 未开兼容模式 → 发 `image_url`；否则降级为文字。
 */
export async function buildUserContent(
  text: string,
  attachments: readonly MessageAttachment[] = [],
  opts: MultimodalOptions,
): Promise<LLMMessage['content']> {
  if (attachments.length === 0) return text;

  const visionOk = opts.compatMode ? false : (opts.supportsVision ?? false);
  if (!visionOk) return buildUserContentSync(text, attachments);

  const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
  const head = text.trim();
  if (head) parts.push({ type: 'text', text: head });

  for (const attachment of attachments) {
    if (!isImageAttachment(attachment)) {
      parts.push({ type: 'text', text: attachmentToText(attachment) });
      continue;
    }
    const res = await blobRepo.getObjectURL(attachment.assetId);
    if (res.ok && res.value) {
      parts.push({ type: 'image_url', image_url: { url: res.value } });
    } else {
      // 拿不到图 → 文字兜底，绝不因为一张图让整条消息发不出去
      parts.push({ type: 'text', text: attachmentToText(attachment) });
    }
  }
  return parts;
}

/**
 * 把历史消息转成 LLMMessage（同步，编译器 / 提示词预览用）。
 * 附件一律走文字降级（拿图片 URL 需要 await，见 `toLLMMessagesAsync`）。
 */
export function toLLMMessages(messages: readonly Message[]): LLMMessage[] {
  return messages.map((m) => ({
    // 我们内部的 role 只有 user / assistant / system；LLM 侧 system 只允许一条（提示词段里已放）
    role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    content: m.role === 'user' ? buildUserContentSync(m.content, m.attachments ?? []) : m.content,
  }));
}

/** 把历史消息转成 LLMMessage（异步，发请求前用；会解析图片 URL） */
export async function toLLMMessagesAsync(
  messages: readonly Message[],
  opts: MultimodalOptions,
): Promise<LLMMessage[]> {
  const out: LLMMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: await buildUserContent(m.content, m.attachments ?? [], opts) });
    } else {
      out.push({ role: m.role === 'assistant' ? 'assistant' : 'system', content: m.content });
    }
  }
  return out;
}

/** 由 Provider 配置推导多模态选项 */
export function multimodalOptionsOf(provider: LLMProviderConfig): MultimodalOptions {
  return {
    supportsVision: supportsVision(provider),
    compatMode: provider.multimodalCompatMode,
  };
}
