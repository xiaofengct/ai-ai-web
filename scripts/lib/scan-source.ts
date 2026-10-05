/**
 * 公共源码扫描工具：**去掉注释，只留代码**。
 *
 * ★ 为什么单独抽这个文件（software-product-manager 提需求，2026-10-04，software-engineer-4 落地）：
 *   「注释导致的误报」在本项目已经是**第三次**出现，每次都换一个工具、每次各修一次：
 *     ① 队规 A 表：`grep -c "level: '"` → 143，多出来的 `:733` 是**注释**；
 *     ② 队规 A 那个最有教育意义的样本：`grep "reason: ''"` → `:739` 是 **JSDoc**，代码里早已绝迹；
 *     ③ `--consumers`：`registry.ts` 归因注释里提到的 key 名被当成"消费点"。
 *   **同一个错误形状换了三个宿主** ⇒ 抽成公共函数，别再各修一次。
 *
 * ★ 给所有自写扫描器用（`check-copy-tables.ts` / `check-copy.ts` / 将来的）。
 *   判据要一致：否则同一个"注释"在一个脚本里算、在另一个里不算，
 *   两份扫描结果对不上时又要花一轮去问"到底哪个是真的"。
 *
 * ★ 不做的事：**不猜语义层级**。
 *   PM 差点立的一条规则（写之前 grep 救回来了）：「`hintKey` = 字段级、`descKey` = 分区级」。
 *   实测不成立——`descKey` 至少服务两种主体：`SettingsPage.tsx:84` 的**分区描述**，
 *   以及全仓 20+ 处 `<EmptyState descKey=...>` 的**空状态描述**。
 *   ⇒ **props 名不是层级的可靠信号**。要判层级必须带**组件名 + props 名**
 *     （`<SettingsField hintKey>` 字段级 / `<EmptyState descKey>` 空状态级 / 分区配置里的 `descKey` 分区级），
 *     **判不了就输出"未知"，不要猜**：猜错的告警比不告警更贵——它会带人去查一个不存在的耦合。
 *
 * ────────────────────────────────────────────────
 *
 * ★★ **当前状态：抽象尚未兑现（software-product-manager 指出，2026-10-04）**
 *
 * 本函数目前**只有 `--consumers` 一处调用**，`check-copy.ts`（software-engineer-3 的）还没接。
 * 上面写着"判据要一致，否则两份扫描结果对不上时要花一轮问哪个是真的"——
 * **只要第二处没接入，这个风险就完整存在**：只有一处调用时，它只是"把第一次的修法换了个位置"。
 *
 * ⇒ **公共函数的落地判据是「第二处接入」，不是「文件已创建」。**
 * ⇒ 若验收前仍未接入第二处，**交付说明里必须写一句"两扫描器判据尚未统一"**——
 *   **已知而未记 = 未知**，将来两份结果对不上时没人知道这是已知状态还是新 bug。
 *
 * ────────────────────────────────────────────────
 *
 * ★★ **能力边界（都是"漏报"方向，按队规 A：多计和漏计都会发生，不是宁可多计就安全）**
 *
 * 1. **不识别正则字面量**：`/` 后紧跟 `/` 一律判为行注释，所以形如 `/https:\/\//` 的正则
 *    会让该行**剩余部分被丢弃** ⇒ **漏报（假阴性）**。
 *    ⚠ 不是现存 bug：已 grep 全仓 `= /…//…/` 形态，**零命中**。
 *    之所以写出来：**漏报比假阳性更该写清楚**——假阳性有人会去查，漏报没人知道。
 *    不修的理由：要区分"除号"和"正则起始"，成本远大于收益。
 * 2. 字符串内的转义已处理（`\'` / `\"` / `` \` ``），但**字符串内的 `${}` 嵌套不做解析**——
 *    模板串里写注释的写法不存在，可接受。
 */
export interface CodeLine {
  /** 1 起的行号（与源文件行号一致，便于直接跳转） */
  line: number;
  /** 去掉行尾注释后的代码内容（块注释整段留空；行号不变） */
  text: string;
}

/**
 * 把源码按行拆开，**行号与源文件严格对齐**，并去掉：
 *   - `//` 行注释（**不**在字符串里的才算，所以 `https://…` 不会被误切）
 *   - `/* *\/` 块注释 / JSDoc（跨行也处理，块内整段留空）
 *   - JSX 的 `{/* *\/}`（本质也是块注释，走同一条路径）
 *
 * ★ 保留行结构（注释行变成空串而不是被删掉），这样调用方拿到的行号**永远等于源文件行号**——
 *   报错要指到具体行，行号一错，工具的可信度就没了。
 */
export function codeLines(source: string): CodeLine[] {
  const out: CodeLine[] = [];
  let buf = '';
  let lineNo = 1;
  let state: 'code' | 'single' | 'double' | 'template' | 'lineComment' | 'blockComment' = 'code';
  let blockStartLine = 0;

  const pushLine = (text: string): void => {
    out.push({ line: lineNo, text });
    lineNo += 1;
    buf = '';
  };

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '\n') {
      const keep = state === 'code' || state === 'single' || state === 'double' || state === 'template';
      pushLine(keep ? buf : '');
      if (state === 'lineComment') state = 'code';
      continue;
    }

    switch (state) {
      case 'code':
        if (c === '/' && next === '/') {
          state = 'lineComment';
          i += 1;
          continue;
        }
        if (c === '/' && next === '*') {
          state = 'blockComment';
          blockStartLine = lineNo;
          i += 1;
          continue;
        }
        if (c === "'") state = 'single';
        else if (c === '"') state = 'double';
        else if (c === '`') state = 'template';
        buf += c;
        continue;

      case 'single':
        if (c === '\\') {
          buf += c + (next ?? '');
          i += 1;
          continue;
        }
        if (c === "'") state = 'code';
        buf += c;
        continue;

      case 'double':
        if (c === '\\') {
          buf += c + (next ?? '');
          i += 1;
          continue;
        }
        if (c === '"') state = 'code';
        buf += c;
        continue;

      case 'template':
        if (c === '\\') {
          buf += c + (next ?? '');
          i += 1;
          continue;
        }
        if (c === '`') state = 'code';
        buf += c;
        continue;

      case 'lineComment':
        continue;

      case 'blockComment':
        if (c === '*' && next === '/') {
          state = 'code';
          // 块注释结束的这一行：注释后面的代码仍然要留住
          i += 1;
          continue;
        }
        continue;

      default:
        continue;
    }
  }
  // ★ 只要源文件不是以换行结尾，就还有一行没 push（哪怕它是空的或整行是注释）。
  //   原写法是 `buf !== '' || source.endsWith('\n')`，会漏掉"末行是注释且无换行"的那一行——
  //   虽然它对扫描结果无影响（注释行本来就没内容），但会让**输出行数比源文件少一行**，
  //   行号对齐是本工具的可信度来源，宁可多 push 一个空行也别少。
  if (!source.endsWith('\n')) {
    const keep = state === 'code' || state === 'single' || state === 'double' || state === 'template';
    pushLine(keep ? buf : '');
  }
  // 块注释未闭合时（`blockStartLine` 有值且 state 仍是 blockComment）说明源码本身不完整，
  // 这种情况调用方会看到"后面的行全空"——**宁可少报，不要错报**。
  void blockStartLine;
  return out;
}
