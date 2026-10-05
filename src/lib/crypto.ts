import { AppError } from './errors';

/**
 * AES-GCM 加解密（架构文档 §2 `lib/crypto.ts`）。
 * 用途：LLM 凭据（apiKey）可选加密后再落 localStorage。
 *
 * ★ 安全边界说明（写清楚，避免误以为这是强保护）：
 * 浏览器端无论如何都拿不到「只有用户知道、代码也不知道」的密钥，
 * 口令派生的加密只能防止「直接打开 DevTools 一眼看到明文」，
 * 无法防住同源脚本。真正的保护依赖用户不自填口令时保持明文存储 + 不共享设备。
 */

const PBKDF2_ITERATIONS = 150_000;
const KEY_BITS = 256;

export interface EncryptedPayload {
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64（含 GCM tag） */
  data: string;
  v: 1;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new AppError('CAPABILITY_UNAVAILABLE', '当前环境不支持 Web Crypto（需要 HTTPS 或 localhost）');
  }
  return c.subtle;
}

/** Web Crypto 是否可用 */
export function isCryptoAvailable(): boolean {
  return Boolean(globalThis.crypto?.subtle);
}

/**
 * 注意：TS 5.7+ 的 `Uint8Array` 带 `ArrayBufferLike` 泛型参数，
 * 而 Web Crypto 的 `BufferSource` 要求 `ArrayBufferView<ArrayBuffer>`。
 * 这里统一显式声明为 `Uint8Array<ArrayBuffer>`，避免 SharedArrayBuffer 的类型冲突。
 */
function randomBytes(len: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(new ArrayBuffer(len));
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** PBKDF2 派生 AES-GCM 密钥 */
export async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const baseKey = await subtle().importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 加密字符串 */
export async function encryptString(plain: string, passphrase: string): Promise<EncryptedPayload> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const cipher = await subtle().encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  );
  return {
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(cipher)),
    v: 1,
  };
}

/** 解密字符串（口令错误会抛错） */
export async function decryptString(payload: EncryptedPayload, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromBase64(payload.salt));
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.data),
  );
  return new TextDecoder().decode(plain);
}

/** 判断是否为加密负载 */
export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<EncryptedPayload>;
  return typeof p.salt === 'string' && typeof p.iv === 'string' && typeof p.data === 'string';
}

/** SHA-256 摘要（去重 / 内容寻址文件名用） */
export async function sha256(text: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
