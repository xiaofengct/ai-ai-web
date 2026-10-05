#!/usr/bin/env node
/**
 * 验证「接口地址 → 实际请求 URL」的拼接规则（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个测试是为了钉住一次真实事故
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户在真机上看到 `LLM_BAD_RESPONSE` / 「请求被拒绝（HTTP 404）」。
 * 根因是**地址被拼了两遍**：
 *   「接口地址」字段期望的是**基础地址**，用户填了完整端点
 *   `https://api.deepseek.com/chat/completions`，
 *   而兼容模式关着 ⇒ 应用不探测、直接追加 `/v1/chat/completions`
 *   ⇒ `…/chat/completions/v1/chat/completions` ⇒ 404。
 *
 * 顺带发现预设自身也有隐患：`https://api.deepseek.com/v1` + `/v1/chat/completions`
 * ⇒ `/v1/v1/chat/completions`。硅基流动预设同理。
 *
 * ★ 这里断言的是"**最终 URL 逐字符相等**"，不是"看起来合理"。
 *   拼接逻辑最容易出的错就是"多一段/少一段"，只有逐字符比对才拦得住。
 *
 * ★ 同时也断言**不应发生的事**（防过度修正）：
 *   `normalizeBaseUrl` 不该把不确定的路径也擅自改写 ——
 *   它只剥"已知的端点后缀"，其余原样保留。宁可让用户看到 404 指向真实地址，
 *   也不要我们悄悄改掉用户填的东西。
 *
 * 用法：npx tsx scripts/qa/check-url-join.mjs
 */
import { normalizeBaseUrl, chatPathCandidates, previewChatUrl, previewModelsUrl, hasVersionSegment } from '@/llm/adapter/compat';

let failed = 0;

/** 断言最终 URL 逐字符相等 */
function expectUrl(name, baseUrl, expected) {
  const actual = previewChatUrl(baseUrl);
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  console.log(`      输入    ${baseUrl}`);
  console.log(`      实际    ${actual}`);
  if (!ok) console.log(`      \x1b[31m期望    ${expected}\x1b[0m`);
}

/** 断言"归一化后就是这个基础地址" */
function expectBase(name, input, expected) {
  const actual = normalizeBaseUrl(input);
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  if (!ok) {
    console.log(`      输入 ${input}`);
    console.log(`      \x1b[31m实际 ${actual}  期望 ${expected}\x1b[0m`);
  }
}

/** 断言"两个输入得到同一个结果"（等价性，比逐条写期望值更能表达意图） */
function expectSame(name, a, b) {
  const ua = previewChatUrl(a);
  const ub = previewChatUrl(b);
  const ok = ua === ub;
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  console.log(`      ${a}  ⇔  ${b}`);
  if (!ok) console.log(`      \x1b[31m${ua} ≠ ${ub}\x1b[0m`);
  else console.log(`      → ${ua}`);
}

console.log('\n═══ 接口地址拼接规则 ═══\n');
console.log(`（预设用的是 ${'`https://api.deepseek.com/v1`'} 这种"基础地址"，字段说明也是这个意思）\n`);

/* ─────────── ① 事故现场：用户填完整端点 ─────────── */
console.log('① 复现并修掉事故现场（把完整端点填进"接口地址"）');
expectUrl(
  '★ 用户当时的输入（兼容模式关闭）',
  'https://api.deepseek.com/chat/completions',
  'https://api.deepseek.com/v1/chat/completions',
);
expectUrl(
  '误填带 /v1 的完整端点',
  'https://api.deepseek.com/v1/chat/completions',
  'https://api.deepseek.com/v1/chat/completions',
);

/* ─────────── ② 预设地址（原来会拼成 /v1/v1） ─────────── */
console.log('\n② 两个内置预设（原来会拼成 `/v1/v1/…`）');
expectUrl('DeepSeek 预设', 'https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/chat/completions');
expectUrl(
  '硅基流动预设',
  'https://api.siliconflow.cn/v1',
  'https://api.siliconflow.cn/v1/chat/completions',
);

/* ─────────── ③ 各种"看起来不同、其实等价"的写法 ─────────── */
console.log('\n③ 写法不同但语义相同的输入，必须得到同一个 URL');
expectSame('带/不带尾部斜杠', 'https://api.deepseek.com/v1/', 'https://api.deepseek.com/v1');
expectSame('带/不带 /v1', 'https://api.deepseek.com/v1', 'https://api.deepseek.com');
expectSame('带/不带完整端点', 'https://api.deepseek.com/chat/completions', 'https://api.deepseek.com');
expectSame('前后有空白', '  https://api.deepseek.com/v1  ', 'https://api.deepseek.com/v1');

/* ─────────── ④ 防过度修正：不该乱改用户输入 ─────────── */
console.log('\n④ 防过度修正（只剥已知端点后缀，其余原样保留）');
expectBase('自定义路径原样保留', 'https://my-proxy.local/llm', 'https://my-proxy.local/llm');
expectBase('未知后缀不剥', 'https://my-proxy.local/api/v3', 'https://my-proxy.local/api/v3');
expectBase('裸主机名保留', 'http://192.168.1.50:11434', 'http://192.168.1.50:11434');
expectBase('本地服务路径保留', 'http://127.0.0.1:1234/v1', 'http://127.0.0.1:1234/v1');

/* ─────────── ⑤ 版本段识别与模型列表地址 ─────────── */
console.log('\n⑤ 版本段识别 + 模型列表地址');
for (const [base, want] of [
  ['https://api.deepseek.com/v1', true],
  ['https://api.deepseek.com/v2', true],
  ['https://api.deepseek.com', false],
  ['https://api.deepseek.com/v1x', false],
]) {
  const actual = hasVersionSegment(base);
  const ok = actual === want;
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} hasVersionSegment(${base}) = ${actual}`);
}
{
  const cases = [
    ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/models'],
    ['https://api.deepseek.com', 'https://api.deepseek.com/v1/models'],
    ['https://api.deepseek.com/models', 'https://api.deepseek.com/v1/models'],
  ];
  for (const [input, want] of cases) {
    const actual = previewModelsUrl(input);
    const ok = actual === want;
    if (!ok) failed += 1;
    console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${input} → ${actual}`);
    if (!ok) console.log(`      \x1b[31m期望 ${want}\x1b[0m`);
  }
}

/* ─────────── ⑥ 候选顺序（兼容模式探测用） ─────────── */
console.log('\n⑥ 兼容模式候选路径（base 已含 /v1 时不再重复 /v1）');
for (const [base, want] of [
  ['https://api.deepseek.com/v1', ['/chat/completions']],
  ['https://api.deepseek.com', ['/v1/chat/completions', '/chat/completions']],
]) {
  const actual = chatPathCandidates(base);
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${base} → ${JSON.stringify(actual)}`);
  if (!ok) console.log(`      \x1b[31m期望 ${JSON.stringify(want)}\x1b[0m`);
}

const verdict = failed === 0 ? '全部通过 ✓' : `${failed} 项失败`;
console.log(`\n═══ ${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${verdict}\x1b[0m ═══\n`);
process.exit(failed === 0 ? 0 : 1);
