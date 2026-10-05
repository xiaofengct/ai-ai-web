/**
 * ★ 微信 ClawBot —— iLink Bot 平台协议常量与请求头构造。
 *
 * 这一层只做**纯计算**：常量、端点路径、请求头、base_info。
 * 不发任何网络请求（那在 `client.ts`），不持有任何状态（那在 store）。
 *
 * ────────────────────────────────────────────────────────────────
 * ★ 来源与许可证边界（必读，别删这段）
 *
 * 本协议的知识来源是对一个**外部只读源码**（`xinran-app/src/app.html`，
 * LICENSE = `UNLICENSED` / 保留所有权利）里 iLink 实现的**逆向规格提取**，
 * 其注释自称「协议逐条对齐官方插件 `@tencent-weixin/openclaw-weixin v2.4.3`」。
 *
 * ⇒ **只借鉴协议事实，代码全部按本仓库架构与类型重写**，未复制其任何代码块。
 *   后续维护请继续遵守这条约束。
 *
 * ⇒ 因此下列常量**不是**从官方 SDK 读出来的，而是从对方代码里读到的**取值**。
 *   凡是对方没给出确证的地方，本文件一律标 `不确定` / `未验证`，不编。
 * ────────────────────────────────────────────────────────────────
 */

/** iLink Bot 平台默认基址。运行期基址以设置为准，空则回落这里 */
export const ILINK_BASE_DEFAULT = 'https://ilinkai.weixin.qq.com';

/**
 * 通道版本号，进请求体 `base_info.channel_version`。
 * 对方源码里是 `'2.4.3'`（与其对齐的官方插件版本号同值）。
 */
export const ILINK_VERSION = '2.4.3';

/**
 * 客户端版本号。★ **刻意写成算式，不要替换成字面量 `132099`。**
 *
 * 语义是「主版本 2 / 次版本 4 / 补丁 3」按字节打包成 0x00MMNNPP：
 *   `(2 << 16) | (4 << 8) | 3` === `0x00020403` === `132099`
 *
 * 为什么必须留算式：字面量 `132099` 与 `2.4.3` 之间的对应关系一旦断掉，
 * 下次有人升级 `ILINK_VERSION` 就会漏改这个头，且**不会有任何测试报错**
 * ——它只会表现为「服务端行为悄悄变了」。算式本身就是那份映射。
 *
 * ⚠️ `ILINK_VERSION` 与这里的三个数字是**同源**的：改一个必须同时改另一个。
 */
export const ILINK_CLIENT_VERSION_NUM = (2 << 16) | (4 << 8) | 3;

/** 头的实际取值（十进制字符串） */
export const ILINK_CLIENT_VERSION = String(ILINK_CLIENT_VERSION_NUM);

/**
 * 进请求体 `base_info.bot_agent` 的应用标识。
 *
 * ★ 取值依据（这是「对方怎么写」的观测，不是官方规范）：
 *   对方填的是它自己的 `XinranApp/1.0`——一个**自定义字符串**。
 *   既然自定义串就能跑通，说明服务端**不校验**固定值（如官方插件名）。
 *   故这里填本仓库自己的标识。
 *
 * ⚠️ 未验证：服务端有没有长度 / 字符集限制，本仓库**没测过**。
 */
export const ILINK_BOT_AGENT = 'AiAiWeb/1.0';

/** 取二维码时的 `bot_type` 查询参数（对方写死 3） */
export const ILINK_QR_BOT_TYPE = 3;

/**
 * 客户端读超时。
 *
 * 对方把 `getupdates` 与 `get_qrcode_status` 的读超时设成 40000ms，
 * 而注释与 UI 都称这是「35s 长轮询」。本仓库沿用同一个值：
 * 读超时留一点余量给服务端 35s 的挂起窗口，超时过早会把正常长轮询当成失败。
 */
export const ILINK_READ_TIMEOUT_MS = 40_000;

/** 普通请求（发消息 / 输入中 / 起停通知）的读超时 */
export const ILINK_SHORT_TIMEOUT_MS = 15_000;

/** 端点路径。全部相对运行期基址 */
export const ILINK_PATHS = {
  /** POST，查询参数 `bot_type`。取扫码绑定用的二维码 */
  getBotQrcode: '/ilink/bot/get_bot_qrcode',
  /** GET，查询参数 `qrcode`（+ 可选 `verify_code`）。长轮询扫码状态 */
  getQrcodeStatus: '/ilink/bot/get_qrcode_status',
  /** POST。长轮询收消息 */
  getUpdates: '/ilink/bot/getupdates',
  /** POST。发消息 */
  sendMessage: '/ilink/bot/sendmessage',
  /** POST。取「输入中」票据（typing_ticket） */
  getConfig: '/ilink/bot/getconfig',
  /** POST。输入中开 / 关 */
  sendTyping: '/ilink/bot/sendtyping',
  /** POST。上线通知（起停通知的「start」） */
  notifyStart: '/ilink/bot/msg/notifystart',
  /**
   * ★ 路径来自对方源码的**注释**，对方**没有实现**它，本仓库也没有调用。
   *   语义按对称性推断为「下线通知」，请求体/触发时机**均未验证**。
   *   这里只登记路径以免后人重复考古；**不要**在没有验证前直接调用。
   */
  notifyStop: '/ilink/bot/msg/notifystop',
} as const;

/** 媒体 CDN 的下载 / 上传路径（相对基址；查询参数由服务端下发） */
export const ILINK_MEDIA_PATHS = {
  download: '/download',
  upload: '/upload',
  /** POST，换媒体上传地址 */
  getUploadUrl: '/ilink/bot/getuploadurl',
} as const;

/* ============================================================
   枚举取值
   ============================================================ */

/**
 * `item_list[].type` —— 消息内容类型，收发两侧同值。
 * 取值来自对方代码里实际分支的三个值（文本 / 图片 / 语音）。
 * ⚠️ 是不是还有别的取值（视频、文件…）**未验证**。
 */
export const ILINK_ITEM_TYPE = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
} as const;

/**
 * `msg.message_type`。
 * 对方只用过 `2`，且注释写 `2(BOT)`。本仓库发消息固定用它。
 * ⚠️ 完整枚举**未验证**（`1` 是什么？收消息时对方用 `message_type === 2`
 * 判定「这是我自己发的回显」并跳过）。
 */
export const ILINK_MESSAGE_TYPE = {
  BOT: 2,
} as const;

/**
 * `msg.message_state`。
 * 对方只用过 `2`，注释写 `2(FINISH)`。
 * ⚠️ 完整枚举**未验证**（是否有「流式中间态」之类，不知道）。
 */
export const ILINK_MESSAGE_STATE = {
  FINISH: 2,
} as const;

/** `sendtyping` 的 `status`：1 = 开始输入，2 = 结束输入 */
export const ILINK_TYPING_STATUS = {
  START: 1,
  STOP: 2,
} as const;

/**
 * 服务端表示「会话过期」的错误码。
 * 对方在 `getupdates` 响应上判 `errcode === -14 || ret === -14`，
 * 处理方式是**清空同步缓冲后继续**——不重绑、不清 token。
 * ⚠️ 其余错误码的含义**未验证**，本仓库不猜。
 */
export const ILINK_SESSION_TIMEOUT_CODE = -14;

/* ============================================================
   请求头
   ============================================================ */

/** 固定头（与鉴权无关，每个请求都带） */
export const ILINK_FIXED_HEADERS = {
  AuthorizationType: 'ilink_bot_token',
  'iLink-App-Id': 'bot',
  'iLink-App-ClientVersion': ILINK_CLIENT_VERSION,
} as const;

/**
 * 会话级 `X-WECHAT-UIN` 缓存。
 *
 * ★★ 为什么必须缓存、**不能每个请求重新随机**（这是最容易被"顺手优化掉"的一处）：
 *
 *   `X-WECHAT-UIN` 是服务端用来区分「是哪一个客户端」的标识。
 *   如果每个请求都换一个新值，服务端会把同一个客户端当成**很多个不同用户**，
 *   而 `get_updates_buf`（长轮询的增量游标）是**按客户端绑定**的——
 *   绑定一错，表现就是**偶发收不到消息**：不报错、不可复现、看日志还全是 200。
 *
 *   ⇒ 本文件把它做成**进程级缓存**：整个会话只生成一次，之后每个请求复用。
 *     改动这段之前请先想清楚上面这条故障是怎么发生的。
 */
let cachedUin: string | null = null;

/** 把 ASCII 字符串编成 base64（浏览器用 btoa，测试 / Node 环境退化到 Buffer） */
function base64OfAscii(text: string): string {
  if (typeof btoa === 'function') {
    try {
      return btoa(text);
    } catch {
      /* 落到下面的兜底 */
    }
  }
  const bufferCtor = (globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } })
    .Buffer;
  if (bufferCtor) return bufferCtor.from(text, 'binary').toString('base64');
  // 两条路都没有（极窄的场景）：不抛错，退回原文——服务端会拒，但至少不会让整个登录流程崩在取值上
  return text;
}

/** 生成一个 `X-WECHAT-UIN` 取值：base64(随机 uint32 的十进制字符串) */
function makeWechatUin(): string {
  const n = Math.floor(Math.random() * 4_294_967_295);
  return base64OfAscii(String(n));
}

/** 取（首次生成后缓存）本次会话的 `X-WECHAT-UIN` */
export function getWechatUin(): string {
  if (cachedUin === null) cachedUin = makeWechatUin();
  return cachedUin;
}

/**
 * ★ 仅供测试：清掉 UIN 缓存。
 *
 * 生产代码**没有任何理由**调用它——它会重新走一次「每请求换 UIN」的故障路径。
 * 存在的唯一目的是让「会话级复用」这条不变量可以被断言。
 */
export function resetWechatUinForTest(): void {
  cachedUin = null;
}

/**
 * 纯核：用**显式传入**的 uin 构造请求头。便于单测断言（不依赖模块级缓存）。
 *
 * @param uin      `X-WECHAT-UIN` 取值
 * @param token    绑定令牌（无鉴权请求传 undefined）
 * @param withAuth 是否附加 `Authorization`；为 true 但 `token` 为空时**不附加**
 *                 （行为与规格一致：扫码阶段的请求本来就没有 token）
 */
export function ilinkHeadersWithUin(
  uin: string,
  token: string | undefined,
  withAuth: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...ILINK_FIXED_HEADERS,
    'X-WECHAT-UIN': uin,
  };
  if (withAuth && token) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

/**
 * 构造请求头（对外主入口）。
 *
 * ★ 鉴权口径（照规格，别改）：
 *   - `get_bot_qrcode` 与 `get_qrcode_status` **不带** `Authorization`（`withAuth = false`）；
 *   - 其余端点都带。
 *   理由：扫码发生在「还没有 token」之前，服务端也不认未绑定凭据。
 */
export function buildHeaders(token?: string, withAuth = true): Record<string, string> {
  return ilinkHeadersWithUin(getWechatUin(), token, withAuth);
}

/* ============================================================
   base_info
   ============================================================ */

/** 请求体里的 `base_info`（除个别端点外，每个请求体都带） */
export interface IlinkBaseInfo {
  channel_version: string;
  bot_agent: string;
}

/** 构造 `base_info`（每次返回新对象，避免调用方改到共享引用） */
export function buildBaseInfo(): IlinkBaseInfo {
  return { channel_version: ILINK_VERSION, bot_agent: ILINK_BOT_AGENT };
}

/* ============================================================
   基址
   ============================================================ */

/**
 * 归一化运行期基址：去掉尾部斜杠；空值回落默认基址。
 *
 * 注意：**不要**在这里做「必须 https」之类的校验——服务端在扫码途中会下发
 * IDC 重定向（`scaned_but_redirect`），目标 host 由服务端给。
 * 我们只保证拼出来的 URL 是 `https://<host>` 形式（由调用方拼）。
 */
export function resolveBaseUrl(configured?: string): string {
  const trimmed = (configured ?? '').trim().replace(/\/+$/, '');
  return trimmed || ILINK_BASE_DEFAULT;
}

/** 拼一个完整 URL（base 与 path 之间保证恰好一个 `/`） */
export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

/**
 * 从 `get_qrcode_status` 的 `redirect_host` 拼出新的基址。
 *
 * ★ 规格里对方写的是 `'https://' + redirect_host`——即服务端给的是**裸 host**
 *   （可能带端口），不带 scheme。这里沿用「协议固定 https」的假设。
 *   ⚠️ 未验证：服务端会不会给出带 scheme 的完整地址（若会，这里会拼出
 *   `https://https://…`）。这属于**防御性校验**，本仓库选择照规格实现，
 *   不擅自加「看起来像 scheme 就用原值」的猜测逻辑——猜测会让真正的协议问题被掩盖。
 */
export function baseUrlFromRedirectHost(redirectHost: string): string {
  return `https://${redirectHost.trim().replace(/^\/+/, '')}`;
}
