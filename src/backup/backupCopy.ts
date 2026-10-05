/**
 * ★ 备份域文案补充表（沿用 `settingsCopy.ts` 的域内表模式）。
 *
 * ============ 为什么有这张表 ============
 * 架构文档 §6.8 要求「面向用户的文案唯一出口 = `src/copy/xinran.ts`」，
 * 而 `src/copy/` 现已归口 software-engineer-4，**本域不直接改动它**。
 * 已收录的通用错误（`err.importInvalid` / `err.parseFail` …）走 `t()`；
 * 本域专有的**失败原因**与**版本提示**集中在这里，由 `bl()` / `blv()` 取值。
 *
 * ============ ★ 为什么要单独收「失败原因」============
 * 2026-10 的英文泄漏事故：备份导入的失败原因原本直接把 `AppError.message`（英文）
 * 塞进 `ImportReport.items[].reason`，而 UI 上是 `原因：{reason}` 原样渲染——
 * 用户看到一句没头没尾的英文。而所有检查脚本的判据都是「连续 N 个中文字符」，
 * 对英文 100% 静默，一个都报不出来。
 *
 * 所以本域的规矩改成：
 * - **面向用户的 reason 必须是文案**（`t(copyKeyForError(code))` 或本表的 `bl()`）；
 * - **英文 message 只进日志与开发者页**（`log.warn('backup', …)`），这是设计允许的通道。
 * 以后谁再往 `reason` 里塞 `.message` / 英文字面量，都是越界。
 *
 * ============ 语气 ============
 * 导入失败是用户会慌的场景：先说清「跳过了哪一块」，别甩锅，别装没事。
 */

/** 备份域文案表（`as const` 让 key 有字面量类型，写错直接编译报错） */
export const BACKUP_TEXT = {
  /* ——————————————— 导入失败原因（渲染在「原因：」后面）——————————————— */
  'import.reason.stickerEmpty': '这组表情包里没有一张能用的图，我先跳过了。',
  'import.reason.noDistillJob': '没找到对应的蒸馏作业，这块我先放着没动。',
  // ★ 这条是被升级后的 check-copy.ts（新判据「A 档出口非 t() 字面量」）抓出来的：
  //   原文是 `${failed} blob(s) failed`——旧判据（数连续中文）对它 100% 静默。
  'import.reason.blobFailed': '有 {n} 个附件没取回来，其余的都收好了。',

  /* ——————————————— 备份包版本提示 ——————————————— */
  'bundle.hint.noVersion': '没读到版本号，我按 {v} 处理，只能恢复一部分。',
  'bundle.hint.newer': '这个备份比我这边的版本新（{v}），导入可能会丢一点东西。',
  'bundle.hint.older': '这个备份比较旧（{v}），我只能恢复认得的部分。',
  'bundle.hint.match': '版本对得上（{v}），照原样恢复。',
} as const;

/** 备份域文案 key 联合类型（由表推导，写错编译报错） */
export type BackupTextKey = keyof typeof BACKUP_TEXT;

/** 取备份域文案（缺失时返回 key 本身，便于定位） */
export function bl(key: BackupTextKey): string {
  return BACKUP_TEXT[key] ?? key;
}

/**
 * 取备份域文案并替换变量（`{v}` → vars.v）。
 * 与 `copy/index.ts` 的 `t()` 行为保持一致。
 */
export function blv(key: BackupTextKey, vars: Record<string, string | number>): string {
  return bl(key).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}
