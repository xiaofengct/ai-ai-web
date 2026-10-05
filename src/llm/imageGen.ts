import { AppError, redact, toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { useSettingsStore } from '@/store/settingsStore';
import { XINRAN_PERSONA_ID } from '@/constants/defaults';
import { joinUrl, buildHeaders, normalizeHttpError } from './adapter/compat';
import type { PersonaCard } from '@/types/persona';
import type { LLMProviderConfig } from '@/types/settings';
import type { UUID } from '@/types/common';
import type { ImageGenResult } from './types';

/**
 * 文生图适配（FN-33 角色文生图 / FN-50 角色立绘）。
 *
 * ★★ 隐私红线（XR-06）：`persona.privacy.noImage = true` 时**直接抛 `PRIVACY_BLOCK`**，
 *   绝不发起任何请求。欣然的内置卡恒为 `noImage = true`，
 *   且这里额外做了三重保险（`isBuiltin` / `origin === 'xinran'` / 内置 ID），
 *   防止有人改了 `privacy` 字段就绕过。
 *
 * 其余说明：浏览器直连文生图端点基本都会撞 CORS，失败时抛 `LLM_CORS`，
 * 由 UI 用「替代方案」文案引导（alt.imageGenOptional / alt.corsProxy）。
 */

export interface ImageGenInput {
  persona: PersonaCard;
  /** 画面描述（不传则用角色卡 description） */
  description?: string;
  /** 画风 */
  style?: string;
  size?: string;
  providerId?: UUID;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** ★ 隐私红线校验：noImage=true 时抛 AppError('PRIVACY_BLOCK') */
export function assertImageAllowed(persona: PersonaCard): void {
  const blocked =
    persona.privacy?.noImage === true ||
    persona.origin === 'xinran' ||
    persona.isBuiltin === true ||
    persona.id === XINRAN_PERSONA_ID;
  if (blocked) {
    throw new AppError(
      'PRIVACY_BLOCK',
      '这个角色不允许生成图像（隐私红线）',
      redact({ personaId: persona.id, origin: persona.origin }),
    );
  }
}

/** 是否允许为该角色生图（不抛错版，UI 置灰用） */
export function canGenerateImage(persona: PersonaCard): boolean {
  try {
    assertImageAllowed(persona);
    return true;
  } catch {
    return false;
  }
}

/** 用角色卡的模板拼出图像提示词 */
export function buildImagePrompt(
  persona: PersonaCard,
  description?: string,
  style?: string,
): string {
  const template = persona.imageGen?.promptTemplate || '{description}，{style}';
  const desc = (description ?? persona.data.description ?? persona.data.name ?? '').trim();
  const styleText = (style ?? persona.data.tags?.join('、') ?? '').trim();
  return template
    .replace(/\{description\}/g, desc)
    .replace(/\{style\}/g, styleText)
    .replace(/\{name\}/g, persona.data.name ?? '')
    .trim();
}

/** 解析文生图端点地址 */
export function resolveImageUrl(provider: LLMProviderConfig): string {
  const override = provider.pathOverrides?.image;
  return joinUrl(provider.baseUrl, override || '/v1/images/generations');
}

/** 执行一次文生图；返回可直接放进 `<img src>` 的 URL */
export async function generateImage(input: ImageGenInput): Promise<ImageGenResult> {
  // ★ 红线第一道：任何生图入口都必须先过这个
  assertImageAllowed(input.persona);

  const store = useSettingsStore.getState();
  const provider = input.providerId
    ? store.settings.providers.find((p) => p.id === input.providerId) ?? store.activeProvider()
    : store.activeProvider();
  if (!provider || !provider.baseUrl.trim()) {
    throw new AppError('LLM_NO_PROVIDER', '还没有配置可用的模型服务', undefined);
  }

  const prompt = buildImagePrompt(input.persona, input.description, input.style);
  const size = input.size ?? input.persona.imageGen?.size ?? '1024x1024';
  const url = resolveImageUrl(provider);
  const timeoutMs = input.timeoutMs ?? provider.timeoutMs ?? 60_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(provider.apiKey, provider.headers),
      body: JSON.stringify({
        model: input.persona.imageGen?.model || provider.model,
        prompt,
        // ★ 反向提示词同样来自角色卡（不写死任何外貌描述）
        negative_prompt: input.persona.imageGen?.negativePrompt ?? '',
        size,
        n: 1,
      }),
      signal: input.signal ?? controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = normalizeHttpError(res.status, text);
      throw new AppError(err.code, err.message, redact({ status: res.status }));
    }
    const json = (await res.json()) as unknown;
    const urlResult = pickImageUrl(json);
    if (!urlResult) {
      throw new AppError('LLM_BAD_RESPONSE', '图像服务没有返回可用的图片地址', redact({ keys: Object.keys(json as object) }));
    }
    log.info('llm', '文生图完成', redact({ provider: provider.name, size }), 'FN-33');
    return { url: urlResult, raw: undefined };
  } catch (e) {
    const err = toAppError(e);
    log.warn('llm', '文生图失败', redact({ code: err.code, message: err.message }), 'FN-33');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 从各家文生图响应里抠出图片地址（url / b64_json / data[0].url） */
export function pickImageUrl(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const obj = json as Record<string, unknown>;

  const data = obj.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (typeof first === 'string' && first.trim()) return first.trim();
    if (typeof first === 'object' && first !== null) {
      const rec = first as Record<string, unknown>;
      if (typeof rec.url === 'string' && rec.url.trim()) return rec.url.trim();
      if (typeof rec.b64_json === 'string' && rec.b64_json.trim()) {
        return `data:image/png;base64,${rec.b64_json.trim()}`;
      }
      if (typeof rec.image === 'string' && rec.image.trim()) return rec.image.trim();
    }
  }

  for (const key of ['url', 'image', 'output']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const b64 = obj.b64_json;
  if (typeof b64 === 'string' && b64.trim()) return `data:image/png;base64,${b64.trim()}`;
  return undefined;
}
