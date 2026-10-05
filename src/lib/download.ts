/**
 * 浏览器下载封装（Blob → a[download]）。
 * 用于一键导出（FN-03）、导出日志（FN-26）、备份下载。
 */

/** 触发下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 立即 revoke 在部分浏览器会中断下载，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 下载文本（默认 UTF-8，加 BOM 以便 Windows 记事本正确识别中文） */
export function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([`\uFEFF${text}`], { type: mime });
  downloadBlob(blob, filename);
}

/** 下载 JSON */
export function downloadJSON(data: unknown, filename: string): void {
  const text = JSON.stringify(data, null, 2);
  downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), filename);
}

/** 下载二进制 */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  // 复制一份，避免把调用方的底层 buffer 一起转移
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  downloadBlob(new Blob([copy], { type: mime }), filename);
}

/** 复制到剪贴板（失败时降级为 textarea + execCommand） */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续走降级 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const okDone = document.execCommand('copy');
    document.body.removeChild(ta);
    return okDone;
  } catch {
    return false;
  }
}

/** Blob → dataURL（图片预览、多模态上传用） */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('readAsDataURL failed'));
    reader.readAsDataURL(blob);
  });
}

/** Blob → ObjectURL（记得配合 revokeObjectURL 释放） */
export function blobToObjectURL(blob: Blob): string {
  return URL.createObjectURL(blob);
}
