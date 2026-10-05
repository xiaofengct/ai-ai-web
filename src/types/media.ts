import type { ISODate, UUID } from './common';

/**
 * 表情包条目。
 *
 * ★ `description` 是**语义标签**，不是图片说明 —— 用于「角色说了什么 → 自动配图」
 *   （见 `docs/00-逆向取证.md` §5.3）。表情包的核心玩法是**语义触发**，
 *   不是静态贴图面板：她说「嘤嘤嘤」时自动贴上那张"嘤嘤嘤"，
 *   比让用户自己在面板里翻要像人得多。
 *
 * ★★ 图片来源有**两条**，互斥但都可选（2026-10-04 加）：
 *   · `assetId`  —— 本地图片，存进 `blobs` 表（导入的、占位包补的图）
 *   · `remoteUrl` —— 远程直链，**不下载字节**，渲染时直接 `<img src>`
 *
 *   为什么远程图不下载进 blob（这是本模块最需要想清楚的一点）：
 *   从任意域名 `fetch` 一张图会撞 **CORS** —— 绝大多数图床不发 `Access-Control-Allow-Origin`，
 *   `fetch` 直接抛 TypeError。而 `<img src="https://...">` **不受**同源策略限制（只受 CSP），
 *   能正常显示。
 *   ⇒ 硬要下载 = 「联网搜索表情包」这个功能对多数图源**根本用不了**；
 *     存链接 = 能用，代价是**图源挂了就显示不出来**（用占位符兜住，见 StickerImage）。
 *   ⇒ 两条路都留着，用 `source` 标明来源，让用户知道哪张是"存在本地的"、
 *     哪张是"引用外部的"。
 *
 * ★ 内容安全的边界（**必须如实说明，不能美化**）：
 *   远程图**无法做像素级内容审核** —— 跨域图读进 canvas 会污染画布，
 *   拿不到像素数据。所以远程那条路只能做：
 *   ① 要求 https（挡掉明文传输）；
 *   ② 校验域名不在黑名单里；
 *   ③ **由用户逐张点选确认**（不做"搜到什么就自动入库"）。
 *   真正的"这图内容合不合适"判断，最终仍在用户手上 —— 它是一条
 *   "用户主动挑选自己要用的表情"的路径，不是自动采集。
 */
export interface StickerItem {
  description: string;
  fileName: string;
  /** 本地图片资源（`blobs` 表 id） */
  assetId?: UUID;
  /** 远程图片直链（仅 `source === 'remote'` 时有） */
  remoteUrl?: string;
  /** 来源：内置占位 / 用户导入 / 联网搜索 */
  source?: 'builtin' | 'local' | 'remote';
  /**
   * 添加时间（联网搜索的条目用它做排序与清理；本地导入的可缺省）。
   * 用 ISO 字符串而不是 `Date`：进 IndexedDB 前不必转换。
   */
  addedAt?: ISODate;
}

export interface StickerPack {
  id: UUID;
  name: string;
  items: StickerItem[];
  createdAt: ISODate;
  enabled: boolean;
}

export interface VoiceTimbre {
  id: UUID;
  name: string;
  provider: 'web-speech' | 'siliconflow' | 'custom';
  refAssetId?: UUID;
  externalVoiceId?: string;
  sampleText?: string;
  speed?: number;
  pitch?: number;
  createdAt: ISODate;
}

export interface Live2DModel {
  id: UUID;
  name: string;
  zipAssetId: UUID;
  modelJsonPath: string;
  motions?: string[];
  scale?: number;
  offset?: { x: number; y: number };
  createdAt: ISODate;
}

export interface BlobRecord {
  /** 主键 */
  id: UUID;
  /** 逻辑路径：stickers/xxx.png、live2d/xxx.zip、distill/{slug}/... */
  path: string;
  mime: string;
  size: number;
  data: Blob | Uint8Array;
  createdAt: ISODate;
}
