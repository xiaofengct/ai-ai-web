/**
 * 深度克隆。
 *
 * ★★★ 这个文件为什么存在（2026-10-04，真机白屏 P0 的根因修复）
 *
 * ── 事故 ──────────────────────────────────────────────────────
 * 用户真机打开应用是**纯 #111111 空白屏**，完全无法使用。
 * 取证结论：该颜色是 Android 框架色 `@android:color/background_dark`，
 * 即「WebView 里什么都没渲染，透出了系统深色窗口背景」。
 *
 * 复现出来的根因只有一行：
 *     ReferenceError: structuredClone is not defined
 *
 * 因为 `constants/defaults.ts` 里有
 *     export const DEFAULT_APP_SETTINGS: AppSettings = buildDefaultAppSettings();
 * 这样一条**模块级常量**，而它内部调用 `structuredClone()`。
 * 模块级常量在 `import` 的那一刻就求值 ⇒ 老 WebView 上直接抛错 ⇒
 * 整个入口模块求值失败 ⇒ React 从未挂载 ⇒ 白屏。
 *
 * ── 为什么不只是"加个 polyfill 就完了" ──────────────────────────
 * `index.html` 里确实加了 `structuredClone` 的 polyfill（那是为了兜住**第三方库**的调用），
 * 但**我们自己的代码不该把"能不能启动"押在一个较新的全局 API 上**。
 * 把依赖收进项目自己的模块有两个好处：
 *   ① 不再有版本门槛 —— 这个实现只用 ES5 时代的语言特性；
 *   ② 可测试 —— 它是纯函数，Node 侧能直接断言，不依赖浏览器环境。
 *
 * ── 与 `structuredClone` 的差异（如实记录，不假装等价）──────────
 * | 输入                        | 原生 structuredClone | 本实现 |
 * |-----------------------------|----------------------|--------|
 * | 函数 / Symbol               | **抛 DataCloneError** | 原样返回引用 |
 * | DOM 节点                    | 抛 DataCloneError    | 按普通对象浅层遍历（不推荐依赖） |
 * | 原型链（class 实例）        | 保留原型             | **丢失原型，退回普通对象** |
 * | Error 对象                  | 保留                 | 丢失专有字段（message 等自有属性仍在） |
 * | 可转移对象（transfer）      | 支持                 | 不支持（本项目不用） |
 *
 * 结论：**只用于"纯数据"**（设置对象、消息、记忆这类 POJO / 数组 / Date / Map / Set / 二进制）。
 * 千万不要拿它克隆 class 实例 —— 会静默丢掉原型方法。
 */
export function deepClone<T>(value: T): T {
  return clone(value, []) as T;
}

/**
 * 递归实现。
 *
 * @param seen 已克隆过的「源对象 → 克隆体」配对表。
 *   用数组而非 Map：这段代码要在**最老的引擎**上也能跑，Map 是 ES6。
 *   配对表还用成员顺序做线性查找，规模是"对象图的嵌套深度级"，不会成为瓶颈。
 */
function clone(value: unknown, seen: Array<[unknown, unknown]>): unknown {
  // 原始值（含 null 与 undefined）直接返回
  if (value === null || typeof value !== 'object') return value;

  // 循环引用：命中记忆就返回对应克隆体，避免无限递归
  for (let i = 0; i < seen.length; i += 1) {
    if (seen[i][0] === value) return seen[i][1];
  }

  const tag = Object.prototype.toString.call(value);

  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);

  if (tag === '[object ArrayBuffer]') return (value as ArrayBuffer).slice(0);
  // TypedArray / DataView：用同一构造器复制，保留具体类型
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const ctor = view.constructor as new (buf: ArrayBufferLike) => ArrayBufferView;
    try {
      // ★ `buffer` 的类型是 `ArrayBufferLike`（可能是 SharedArrayBuffer），
      //   所以构造器参数也按 `ArrayBufferLike` 声明 —— 否则 TS 会因
      //   "SharedArrayBuffer 不能赋给 ArrayBuffer" 报错。
      return new ctor(view.buffer.slice(0));
    } catch {
      // 理论上到不了：同一构造器一定接受同源的 buffer。真到了就退回原引用，
      // 宁可共享引用，也不要在克隆里抛错把调用方带崩。
      return value;
    }
  }

  if (value instanceof Map) {
    const out = new Map();
    seen.push([value, out]);
    value.forEach((v, k) => {
      out.set(clone(k, seen), clone(v, seen));
    });
    return out;
  }

  if (value instanceof Set) {
    const out = new Set();
    seen.push([value, out]);
    value.forEach((v) => {
      out.add(clone(v, seen));
    });
    return out;
  }

  if (Array.isArray(value)) {
    const out = new Array(value.length);
    seen.push([value, out]);
    for (let i = 0; i < value.length; i += 1) out[i] = clone(value[i], seen);
    return out;
  }

  // 兜底：按普通对象处理（**会丢失原型**，见文件头的差异表）
  const out: Record<string, unknown> = {};
  seen.push([value, out]);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = clone((value as Record<string, unknown>)[key], seen);
  }
  return out;
}
