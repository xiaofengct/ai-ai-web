/**
 * 轻量事件总线（架构文档 §2 `lib/emitter.ts`）：
 * - 同标签页：内存事件总线；
 * - 跨标签页：`BroadcastChannel`（SV-07 主动消息接收器的降级实现）。
 */

export type Handler<T> = (payload: T) => void;

/** 同标签页事件总线 */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  once<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    const wrapped: Handler<Events[K]> = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // 复制一份，避免回调里 off 导致的遍历问题
    for (const handler of [...set]) {
      try {
        (handler as Handler<Events[K]>)(payload);
      } catch (e) {
        // 单个订阅者出错不应影响其它订阅者
        // eslint-disable-next-line no-console
        console.error('[emitter] handler error', event, e);
      }
    }
  }

  clear(event?: keyof Events): void {
    if (event) this.handlers.delete(event);
    else this.handlers.clear();
  }
}

/** 应用内事件定义（随业务扩展） */
export interface AppEvents extends Record<string, unknown> {
  /** 主动消息到达（SV-06 / SV-07） */
  'proactive:message': { sessionId: string; messageId: string };
  /** 设置变更 */
  'settings:changed': { keys: string[] };
  /** 会话更新 */
  'session:updated': { sessionId: string };
  /** 记忆写入 */
  'memory:upserted': { id: string };
  /** 蒸馏状态推进 */
  'distill:status': { jobId: string; status: string };
  /** 主题切换 */
  'theme:changed': { mode: 'light' | 'dark'; grayscale: boolean };
  /** 请求用户确认退出（FN-16 降级） */
  'app:exit-request': { reason?: string };
  /** 页面从后台恢复，需要补发提示（D6） */
  'app:resume': { missedTicks: number };
}

/** 全局事件总线实例 */
export const appEmitter = new Emitter<AppEvents>();

/** 跨标签页广播（BroadcastChannel 不可用时静默降级为「仅本标签页」） */
export interface Broadcast<T> {
  post(payload: T): void;
  close(): void;
}

export function createBroadcast<T>(name: string, onMessage?: (payload: T) => void): Broadcast<T> {
  if (typeof BroadcastChannel === 'undefined') {
    return { post: () => undefined, close: () => undefined };
  }
  const channel = new BroadcastChannel(name);
  if (onMessage) {
    channel.onmessage = (event: MessageEvent<T>) => {
      try {
        onMessage(event.data);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[broadcast] handler error', name, e);
      }
    };
  }
  return {
    post: (payload: T) => {
      try {
        channel.postMessage(payload);
      } catch {
        /* 结构化克隆失败时忽略 */
      }
    },
    close: () => channel.close(),
  };
}

export default appEmitter;
