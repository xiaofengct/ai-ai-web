/**
 * ★ 微信 ClawBot（iLink Bot 平台）协议类型。
 *
 * 命名约定：`Ilink*`（与目录 `src/ilink/` 同源），不叫 `Wechat*`
 * ——通道是「微信官方 iLink Bot 平台」，不是微信个人号 hook。
 *
 * ★ 诚实标注：下列「响应字段」全部是**对方源码里实际读取过的字段**，
 *   不代表接口的完整 schema。凡是对方没读的字段，本文件也不编造。
 *   所有结构都用 `readonly` + 可选字段，因为服务端可能不给。
 */

import { ILINK_ITEM_TYPE } from './protocol';

/* ============================================================
   通用响应外壳
   ============================================================ */

/**
 * 服务端错误字段。对方在 `sendmessage` 上用「有没有 `errcode`」判成败，
 * 在 `getupdates` 上用 `-14` 判会话过期。
 *
 * ⚠️ 完整错误码表**未验证**，本仓库只对 `-14` 做特殊处理，其余一律当失败上报。
 */
export interface IlinkErrorFields {
  readonly errcode?: number;
  readonly ret?: number;
}

/* ============================================================
   扫码：状态机取值
   ============================================================ */

/**
 * `get_qrcode_status` 的 `status` 取值。
 *
 * ★ 取值来源：对方源码的注释（列出 8 个）**加上**代码里实际分支的 8 个分支，
 *   两者一致。`wait` 在注释里有、代码里没有显式分支（靠 default 兜住），
 *   本仓库把它显式化，避免后人以为「没处理 wait」是个 bug。
 *
 * ⚠️ 是否还存在其它取值**未验证**；本仓库对未知值走「继续轮询」的容错分支
 *   （与对方行为一致），而不是报错终止——协议演进时表现为「卡住」，比「直接失败」好排查。
 */
export const ILINK_QR_STATUS = {
  /** 已出码，等扫码 */
  WAIT: 'wait',
  /** 已扫码，等确认 / 验证 */
  SCANED: 'scaned',
  /** 需要配对码（微信侧弹了数字） */
  NEED_VERIFYCODE: 'need_verifycode',
  /** 配对码连错，被挡下 */
  VERIFY_CODE_BLOCKED: 'verify_code_blocked',
  /** 二维码过期 */
  EXPIRED: 'expired',
  /** 已扫码，但要把请求转到另一个 IDC 机房（带 redirect_host） */
  SCANED_BUT_REDIRECT: 'scaned_but_redirect',
  /** 这个 bot 已经绑过了 */
  BINDED_REDIRECT: 'binded_redirect',
  /** 绑定确认成功 */
  CONFIRMED: 'confirmed',
} as const;

export type IlinkQrStatus = (typeof ILINK_QR_STATUS)[keyof typeof ILINK_QR_STATUS];

/** `get_bot_qrcode` 响应 */
export interface IlinkQrcodeResponse extends IlinkErrorFields {
  /** 二维码 id（必需；后续 `get_qrcode_status` 用它轮询） */
  readonly qrcode?: string;
  /**
   * 二维码**图片地址**。对方源码里试了三个候选字段名
   * （`qrcode_img_content` / `qrcode_img_url` / `qrcode_img`），
   * 并注释自陈「官方返回里有二维码图片地址」——但**没有给出确证**。
   *
   * ⚠️ 三个名字里到底哪个是真的、还有没有别的，**未验证**。
   *   本仓库三个都读，读不到就只展示二维码 id（不做假二维码）。
   */
  readonly qrcode_img_content?: string;
  readonly qrcode_img_url?: string;
  readonly qrcode_img?: string;
}

/** `get_qrcode_status` 响应 */
export interface IlinkQrcodeStatusResponse extends IlinkErrorFields {
  readonly status?: string;
  /** 绑定成功后的 bot 标识 */
  readonly ilink_bot_id?: string;
  /** 绑定成功后的令牌（凭据） */
  readonly bot_token?: string;
  /** 绑定的微信用户 id */
  readonly ilink_user_id?: string;
  /** 服务端指定的运行期基址（绑定成功后生效） */
  readonly baseurl?: string;
  /** `scaned_but_redirect` 时下发的 IDC host（裸 host，不带 scheme） */
  readonly redirect_host?: string;
}

/* ============================================================
   收消息
   ============================================================ */

/** 文本消息项 */
export interface IlinkTextItem {
  readonly type: typeof ILINK_ITEM_TYPE.TEXT;
  readonly text_item: { readonly text: string };
}

/** 媒体引用（图片 / 语音共用） */
export interface IlinkCdnMedia {
  /** 加密后的查询参数（下载时拼进 URL） */
  readonly encrypt_query_param?: string;
  /** AES 密钥（两种在野格式，见 `docs` / 外部分析报告 §1.8） */
  readonly aes_key?: string;
  readonly encrypt_type?: number;
  /** 服务端直接给的完整地址（有就优先用它下载） */
  readonly full_url?: string;
}

/**
 * 图片消息项。
 * ★ 本仓库**未实现**媒体链路（需原生插件 + AES），这里只登记结构，
 * 收到图片时按「不支持的入站类型」处理，不静默丢弃。
 */
export interface IlinkImageItem {
  readonly type: typeof ILINK_ITEM_TYPE.IMAGE;
  readonly image_item?: {
    readonly media?: IlinkCdnMedia;
    readonly aeskey?: string;
    readonly mid_size?: number;
  };
}

/** 语音消息项。`text` 是服务端给的转写文本（有的话） */
export interface IlinkVoiceItem {
  readonly type: typeof ILINK_ITEM_TYPE.VOICE;
  readonly voice_item?: {
    readonly media?: IlinkCdnMedia;
    readonly encode_type?: number;
    readonly sample_rate?: number;
    readonly playtime?: number;
    /** ASR 转写文本 */
    readonly text?: string;
  };
}

export type IlinkItem = IlinkTextItem | IlinkImageItem | IlinkVoiceItem | { readonly type: number };

/**
 * 入站消息。
 * 对方只读 `message_type` / `from_user_id` / `context_token` / `item_list`。
 */
export interface IlinkInboundMessage extends IlinkErrorFields {
  readonly message_type?: number;
  readonly from_user_id?: string;
  /**
   * 会话上下文令牌。★ **每条带它的消息都会覆盖缓存值**——它不是永久值。
   *   来源只有这里；用途见 `IlinkContextTokenStore`。
   */
  readonly context_token?: string;
  readonly item_list?: readonly IlinkItem[];
  readonly msg_id?: string;
  readonly seq?: number;
  /** 服务端可能还会给别的字段，这里不做穷举 */
  readonly [key: string]: unknown;
}

/** `getupdates` 响应 */
export interface IlinkUpdatesResponse extends IlinkErrorFields {
  /**
   * 增量同步游标。★ **拿到就要立刻回存**（在解析 `msgs` 之前），
   *   否则「同一条消息被重复投递一半、后一半丢失」这类问题会很难查。
   *   见 `receiver.ts` 的回存注释。
   */
  readonly get_updates_buf?: string;
  readonly msgs?: readonly IlinkInboundMessage[];
}

/* ============================================================
   发消息
   ============================================================ */

/** 文本内容项（发消息用） */
export interface IlinkOutboundTextItem {
  readonly type: typeof ILINK_ITEM_TYPE.TEXT;
  readonly text_item: { readonly text: string };
}

/** 图片内容项（★ 未实现发送，结构登记用） */
export interface IlinkOutboundImageItem {
  readonly type: typeof ILINK_ITEM_TYPE.IMAGE;
  readonly image_item: {
    readonly media: {
      readonly encrypt_query_param: string;
      readonly aes_key: string;
      readonly encrypt_type: number;
    };
    readonly mid_size: number;
  };
}

/** 语音内容项（★ 未实现发送，结构登记用） */
export interface IlinkOutboundVoiceItem {
  readonly type: typeof ILINK_ITEM_TYPE.VOICE;
  readonly voice_item: {
    readonly media: {
      readonly encrypt_query_param: string;
      readonly aes_key: string;
      readonly encrypt_type: number;
    };
    readonly encode_type: number;
    readonly sample_rate: number;
    readonly playtime: number;
  };
}

export type IlinkOutboundItem =
  | IlinkOutboundTextItem
  | IlinkOutboundImageItem
  | IlinkOutboundVoiceItem;

/**
 * `sendmessage` 的 `msg` 字段。
 *
 * ★ 每个字段的取值与理由（照规格，改动前先读）：
 *   - `from_user_id`：固定空串。空串表示「由 bot 身份发出」。对方三处都写 `''`。
 *   - `to_user_id`  ：目标用户。缺省用设置里的 `userId`。
 *   - `client_id`   ：客户端幂等 id。对方格式为 `xinran-<ts>-<rand>[-img|-voice]`。
 *                     本仓库用 `ai-ai-<ts>-<rand>`，格式自定（服务端是否校验**未验证**）。
 *   - `message_type`：`2`（BOT）。
 *   - `message_state`：`2`（FINISH）。对方只发「已完成」的消息，没有中间态。
 *   - `item_list`   ：内容项数组。
 *   - `context_token`：会话上下文令牌（见 `IlinkContextTokenStore`）。
 *                     **无 token 也能发**（对方实现如此），此时省略该字段。
 */
export interface IlinkOutboundMessage {
  readonly from_user_id: string;
  readonly to_user_id: string;
  readonly client_id: string;
  readonly message_type: number;
  readonly message_state: number;
  readonly item_list: readonly IlinkOutboundItem[];
  readonly context_token?: string;
}

/** `sendmessage` 响应（对方只看有没有 `errcode`） */
export type IlinkSendMessageResponse = IlinkErrorFields & Record<string, unknown>;

/* ============================================================
   输入中 / 起停通知
   ============================================================ */

/** `getconfig` 响应 */
export interface IlinkConfigResponse extends IlinkErrorFields {
  /**
   * 「输入中」票据。拿到它才能调 `sendtyping`。
   * ⚠️ 有效期未知（未验证）；本仓库只在内存里缓存，不持久化。
   */
  readonly typing_ticket?: string;
}

/** `sendtyping` / `notifystart` 响应（无已知字段，只看是否报错） */
export type IlinkSimpleResponse = IlinkErrorFields & Record<string, unknown>;

/* ============================================================
   客户端上下文 / 错误码
   ============================================================ */

/**
 * 发请求所需的最小上下文。**显式传入**而不是从 store 里读，
 * 目的是让 client 保持无状态、可测。
 */
export interface IlinkRequestContext {
  /** 运行期基址（空 / undefined 回落到默认基址） */
  readonly baseUrl?: string;
  /** 绑定令牌；无鉴权端点可不传 */
  readonly token?: string;
}

/**
 * 本域自定义错误码。
 *
 * ★ 为什么不复用 `AppErrorCode` 里的 `LLM_*`：那些码的语义是「调大模型的失败」，
 *   而这里是「调微信 iLink 的失败」。混用会让 UI 的文案映射做错判断
 *   （例如把 CORS 失败引导到「配置自建代理」——对 iLink 是无效建议）。
 *   `AppError` 的 `code` 字段类型是 `AppErrorCode | string`，允许这样扩展。
 */
export const ILINK_ERROR_CODES = {
  /** 非原生环境（纯 Web）：这条通道跑不起来 */
  NOT_NATIVE: 'ILINK_NOT_NATIVE',
  /** 网络层失败（CORS / 断网 / DNS） */
  NETWORK: 'ILINK_NETWORK',
  /** HTTP 状态异常 */
  HTTP: 'ILINK_HTTP',
  /** 响应结构不符合预期（缺必需字段 / 无法解析） */
  PROTOCOL: 'ILINK_PROTOCOL',
  /** 鉴权失败（401 / 403） */
  AUTH: 'ILINK_AUTH',
  /** 调用方用法错误（缺参数等） */
  ARGS: 'ILINK_ARGS',
} as const;

export type IlinkErrorCode = (typeof ILINK_ERROR_CODES)[keyof typeof ILINK_ERROR_CODES];
