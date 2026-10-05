import { useUiStore } from '@/store/uiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useIlinkStore } from '@/store/ilinkStore';
import { log } from '@/store/logStore';
import { XINRAN_NAME } from '@/copy';

/**
 * 主动消息的通知补偿（FN-19 / SV-06 / alt.notificationToast）。
 *
 * ★ 降级链路（架构文档 D6）：
 *   - 页面可见   → 应用内 Snackbar（`uiStore.snacks`）；
 *   - 页面隐藏   → 系统 Notification（需授权）；
 *   - 没授权/不支持 → 记一条「待补发」，页面恢复时补一条应用内提示（`tip.backgroundResume`）。
 *
 * 三者都不静默失败：至少落一条日志，保证「为什么没收到」可被追问。
 */

/** 待补发标记（sessionStorage：只在当前标签页有效，避免跨标签页重复补发） */
export const PENDING_RESUME_KEY = 'ai-ai.proactive.pending-resume.v1';

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

/** 当前通知权限（不支持时返回 'unsupported'） */
export function notifyPermission(): NotifyPermission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** 申请通知权限；不支持/已拒绝时如实返回，不反复弹 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  const current = notifyPermission();
  if (current !== 'default') return current;
  try {
    const result = await Notification.requestPermission();
    return result as NotifyPermission;
  } catch (e) {
    log.warn('proactive', '申请通知权限失败', { error: String(e) }, 'FN-19');
    return 'denied';
  }
}

/** 发系统通知（失败返回 false，调用方负责降级） */
// ★ 通知标题用 `XINRAN_NAME` 常量，不要写死「欣然」：
//   角色名只有一份真源（`copy/xinran.ts`），写死就会和别处改名/换名对不上。
export function notifyProactive(text: string, title = XINRAN_NAME): boolean {
  const permission = notifyPermission();
  if (permission !== 'granted') return false;
  try {
    const notification = new Notification(title, {
      body: text,
      // 同一条主动消息只保留一条通知，避免刷屏
      tag: 'ai-ai-proactive',
      silent: false,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch (e) {
    log.warn('proactive', '系统通知发送失败', { error: String(e) }, 'FN-19');
    return false;
  }
}

/** 应用内提示（页面可见时走这里） */
export function notifyInApp(key: 'tip.backgroundResume' | 'err.notificationDenied' | 'tip.petPaused'): void {
  useUiStore.getState().pushSnack({ key, severity: 'info', durationMs: 4000 });
}

/** 标记「有待补发的主动消息」 */
export function markPendingResume(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(PENDING_RESUME_KEY, new Date().toISOString());
  } catch {
    /* 忽略 */
  }
}

/** 取出并清除「待补发」标记（返回等待的分钟数；没有则返回 undefined） */
export function consumePendingResume(): number | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem(PENDING_RESUME_KEY);
    if (!raw) return undefined;
    sessionStorage.removeItem(PENDING_RESUME_KEY);
    const at = new Date(raw).getTime();
    return Number.isFinite(at) ? Math.max(0, Math.round((Date.now() - at) / 60_000)) : 0;
  } catch {
    return undefined;
  }
}

/**
 * ★ 把主动消息**也发一份到微信**（iLink `inheritProactive`）。
 *
 * 为什么接在这里、而不是 `chatStore.appendProactive()`（这段推翻了最初的方案）：
 *   `appendProactive` 的**唯一调用方**是 `hooks/useLiveSession.ts`（聊天页的 hook），
 *   它依赖 `get().sessionId`（当前打开的会话）。若把镜像接在那里，
 *   **用户不在那个聊天页时主动消息就永远不同步到微信** ——
 *   而"她趁你不在时开口"恰恰是最需要镜像的场景。
 *   `deliverProactiveMessage` 才是**每一条主动消息的唯一出口**，与当前打开哪个页面无关。
 *
 * ★ 为什么放在可见性分支**之前**：镜像不该受本机投递结果影响。
 *   尤其 `pending` 分支（页面隐藏且无通知权限）意味着这条消息**本机根本没送达**，
 *   此时发微信反而是唯一的送达路径 —— 更应该发。
 *
 * ★ 开关判断放在这里而不是 `sendText` 内部：`sendText` 是通用发送（测试消息也用它，
 *   那条**不**该受 `inheritProactive` 约束）；"主动消息是否也发微信"是这条通路的选择，
 *   与调用点绑定才语义正确。`sendText` 自身已检查总开关与是否已绑定，无需重复。
 *
 * ★ 依赖方向已核实**无环**：`src/ilink/**` 与 `store/ilinkStore` 均不引用 `proactive`。
 */
function mirrorProactiveToWechat(text: string): void {
  try {
    if (!useSettingsStore.getState().settings.ilink.inheritProactive) return;
    // 不 await：镜像是附带动作，失败也不能拖慢/影响本机投递
    void useIlinkStore.getState().sendText(text);
  } catch (e) {
    log.warn('proactive', '主动消息镜像到微信时出错', { error: String(e) }, 'FN-19');
  }
}

/**
 * ★ 统一出口：把一条主动消息「送到用户眼前」。
 * 页面隐藏 → 系统通知；没通知权限 → 记待补发；可见 → 应用内提示。
 * @returns 实际采用的投递方式，便于日志与开发者页排查
 */
export function deliverProactiveMessage(
  text: string,
  options: { visible?: boolean; title?: string } = {},
): 'in-app' | 'notification' | 'pending' {
  const visible = options.visible ?? (typeof document === 'undefined' ? true : !document.hidden);

  // 微信镜像：与本地投递方式无关（理由见 mirrorProactiveToWechat 注释）
  mirrorProactiveToWechat(text);

  if (!visible) {
    const sent = notifyProactive(text, options.title);
    if (sent) return 'notification';
    // 没权限 / 不支持：标记为待补发，等页面回来时提示
    markPendingResume();
    log.info('proactive', '页面隐藏且无通知权限，主动消息标记为待补发', undefined, 'FN-19');
    return 'pending';
  }

  notifyInApp('tip.backgroundResume');
  return 'in-app';
}

/** 页面恢复时补发提示（由调度器在 resume 时调用一次） */
export function flushPendingResume(): void {
  const waited = consumePendingResume();
  if (waited === undefined) return;
  notifyInApp('tip.backgroundResume');
  log.info('proactive', '补发隐藏期间的主动消息提示', { waitedMinutes: waited }, 'FN-19');
}

export default deliverProactiveMessage;
