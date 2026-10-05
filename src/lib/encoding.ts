/**
 * 文本编码探测与解码。
 *
 * ★★ 为什么需要它（这是一处**真 bug**，2026-10-04 由外部源码对照发现并实测确认）：
 *
 *   微信聊天记录导出**不保证是 UTF-8**。老版本微信 / 部分第三方导出工具（如某些
 *   WechatExporter 配置）产出的是 **GBK**。而我们的 `readText()` 原先走
 *   `Blob.text()` —— 规范规定它按 **UTF-8** 解码，遇到 GBK 字节会产出**一片替换字符
 *   `\uFFFD`**，下游解析器认不出任何一条消息 ⇒ 用户看到的是「导入成功但 0 条」或满屏乱码，
 *   且完全无从判断原因。
 *
 *   实测（Node 侧，同一段「你好」的 GBK 字节 `C4 E3 BA C3`）：
 *     - `TextDecoder('utf-8')` → `"\uFFFD\uFFFD\uFFFD"`（全乱）
 *     - `TextDecoder('gbk')`   → `"你好"`（正确）
 *
 * ★ 判据为什么用「替换字符更少」而不是「猜编码」：
 *   这是**无 BOM 文本**唯一可靠的启发式：UTF-8 若解出大量 `\uFFFD`，
 *   几乎必然说明原文不是 UTF-8；此时试 GBK，取**乱码更少**的那个。
 *   反过来，若 UTF-8 解出来干净（0 个替换字符），就**不换** —— 避免把本来正确的 UTF-8 误判成 GBK。
 *   （GBK 是双字节编码，把合法 UTF-8 中文字节当 GBK 解通常会立刻出乱码，故这个比较是安全的。）
 *
 * ★ 为什么是"更少"而不是"为 0"：
 *   真实文件里可能**本就含少量非法字节**（截断、混入的二进片段）。
 *   若要求"必须为 0 才采纳"，这种文件会退化成"两种都不可用"。
 *   用比较取更优者，最坏情况也只是维持现状（等于没换），不会比原来更差。
 */

/** 是否支持某个编码（老 WebView 可能没有 GBK 的 decoder，需 try 兜） */
function canDecode(label: string): boolean {
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}

/**
 * 统计解码结果里的替换字符（U+FFFD）个数 —— 乱码程度的度量。
 *
 * ★ 用 `split` 而不是正则 `g` 计数：`\uFFFD` 在正则里也是一个普通字符，
 *   但 `/gu` 的 sticky/lastIndex 状态容易写出"只数到第一个"的错；split 无状态、更稳。
 */
function replacementCount(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 0xfffd) n += 1;
  }
  return n;
}

export interface DecodeResult {
  /** 解码后的文本（已去 BOM） */
  text: string;
  /** 实际使用的编码标签（`utf-8` / `gbk` / `utf-8(lossy)`） */
  encoding: string;
  /** 最终文本里的替换字符个数（>0 说明仍有无法解码的字节，调用方可据此告警） */
  replacements: number;
  /** 是否从 UTF-8 切换到了 GBK（用于日志/排查） */
  switched: boolean;
}

/**
 * 把字节解成文本：UTF-8 优先，乱码多则试 GBK，取更干净的那个。
 *
 * 抽成纯函数（而非塞在 `readText` 里）是为了能被 Node 侧脚本直接断言 ——
 * 见 `scripts/qa/check-encoding.mjs`。本项目没有单测框架，
 * "可验证"的实际含义就是"能被那个装置调到"。
 */
export function decodeTextBytes(bytes: Uint8Array): DecodeResult {
  // ★ 传 `slice()` 出来的独立 buffer：`TextDecoder.decode` 对 SharedArrayBuffer
  //   与带 offset 的视图处理方式不同，复制一份最不容易出意外（文件大小有上限，代价可接受）
  const buf = bytes.slice();

  const utf8 = new TextDecoder('utf-8').decode(buf);
  const replaced = replacementCount(utf8);

  // 干净 ⇒ 不猜，直接用
  if (replaced === 0 || !canDecode('gbk')) {
    return {
      text: stripBom(utf8),
      encoding: replaced === 0 ? 'utf-8' : 'utf-8(lossy)',
      replacements: replaced,
      switched: false,
    };
  }

  // 有乱码 ⇒ 试试 GBK，谁更干净用谁
  let gbkText = '';
  try {
    gbkText = new TextDecoder('gbk').decode(buf);
  } catch {
    // GBK decoder 存在但解码抛错（罕见）：保持 UTF-8 结果
    return { text: stripBom(utf8), encoding: 'utf-8(lossy)', replacements: replaced, switched: false };
  }
  const gbkReplaced = replacementCount(gbkText);

  if (gbkReplaced < replaced) {
    return { text: stripBom(gbkText), encoding: 'gbk', replacements: gbkReplaced, switched: true };
  }
  return { text: stripBom(utf8), encoding: 'utf-8(lossy)', replacements: replaced, switched: false };
}

/** 去掉 BOM（U+FEFF）。★ 位置必须在解码之后：BOM 是"字符"，不是字节前缀 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
