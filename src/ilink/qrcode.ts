import QRCode from 'qrcode';

/**
 * 把「二维码内容」渲染成 dataURL 图片。
 *
 * ★★ 为什么单独抽成一个模块（而不是在组件里直接调库）：
 *
 *   1. **可验证**。本项目没有单测框架，但 `scripts/qa/` 那套装置能在 Node 里直接调
 *      这个函数（见 `scripts/qa/check-qrcode.mjs`），断言它对一个**真实**的
 *      `qrcode_img_content` 产出**合法 PNG**。若把逻辑埋在组件里，
 *      就只能"用眼睛看截图"，而这次要修的恰恰是"看起来是图片、其实是 HTML"的坑。
 *   2. **换库只改一处**。二维码库的选择不该泄漏到 UI。
 *
 * ★ 为什么需要「内容 → 二维码」这一步（本文件存在的根本原因，别删注释）：
 *
 *   服务端 `get_bot_qrcode` 返回的字段叫 `qrcode_img_content`，**名字极具误导性**。
 *   实测（2026-10-04）它返回的是一个 **H5 页面链接**：
 *     `https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=<id>&bot_type=3`
 *   抓取该链接得到 `Content-Type: text/html`（页面显示"正在加载"），
 *   且响应头带 `X-Frame-Options: SAMEORIGIN`。
 *
 *   ⇒ 两条**都走不通**：当 `<img src>` 会破图；用 iframe 嵌会被同源策略拒绝。
 *   ⇒ 字段名的真实含义是「二维码图片的**内容**」—— 应当被**编码进**二维码的载荷。
 *      也就是说：**要自己生成二维码**。
 *
 * ★ 参数取值的理由：
 *   - `errorCorrectionLevel: 'M'`（约 15% 纠错）：扫码场景的常规选择；
 *     提高等级会让模块更密、反而更难扫（内容是一个较长的 URL）。
 *   - `margin: 1`：外层容器已有内边距，留 1 个模块的静默区即可（规范要求 ≥4 模块时
 *     靠容器 padding 补足，这里 1 + 容器 padding 足够）。
 *   - `width: 400`：UI 显示 200px，出 400 保证 2x 屏不糊。
 */
export interface QrRenderOptions {
  /** 输出像素宽度（默认 400） */
  width?: number;
  margin?: number;
}

/**
 * 生成二维码 dataURL。
 *
 * @param content 要编码的内容（来自服务端的 `qrcode_img_content`）
 * @returns `data:image/png;base64,...`；**失败时抛异常**，由调用方决定怎么如实告知用户
 */
export async function renderQrDataUrl(
  content: string,
  options: QrRenderOptions = {},
): Promise<string> {
  const trimmed = content.trim();
  if (trimmed === '') {
    throw new Error('二维码内容为空');
  }
  return QRCode.toDataURL(trimmed, {
    margin: options.margin ?? 1,
    width: options.width ?? 400,
    errorCorrectionLevel: 'M',
  });
}

export default renderQrDataUrl;
