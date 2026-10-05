import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { MarkdownView } from '@/components/MarkdownView';
import { sl, slv } from './settingsCopy';

/**
 * 第三方许可页（PG-26）。
 *
 * ★ 数据来源：仓库根目录的 `THIRD_PARTY.md`（手工维护），
 *   构建时把它放到 `public/THIRD_PARTY.md` 即可被本页 fetch 到。
 *   取不到就如实提示，**不编造内容**（XR-05）。
 */

const SOURCE = '/THIRD_PARTY.md';

/** 从 markdown 里抽出「## 」小节标题，作为条目索引 */
function parseSections(md: string): string[] {
  return md
    .split('\n')
    .filter((line) => line.trimStart().startsWith('## '))
    .map((line) => line.replace(/^#+\s*/, '').trim());
}

export function SdkPage(): JSX.Element {
  const [text, setText] = useState<string>('');

  useEffect(() => {
    void fetch(SOURCE)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('missing'))))
      .then((md) => setText(md))
      .catch(() => setText(''));
  }, []);

  const sections = useMemo(() => parseSections(text), [text]);

  return (
    <Box sx={{ width: '100%', maxWidth: 860, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Stack spacing={0.25} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {sl('label.thirdParty')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {sl('page.sdk.desc')}
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body2" sx={{ opacity: 0.8 }}>
          {sl('sdk.intro')}
        </Typography>

        {sections.length > 0 ? (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" variant="outlined" label={slv('sdk.count', { n: sections.length })} />
              {sections.map((s) => (
                <Chip key={s} size="small" variant="outlined" label={s} />
              ))}
            </Stack>
          </>
        ) : null}

        <Divider sx={{ my: 1.5 }} />

        {/*
          ★★ 用 `MarkdownView` 渲染，**不要**再用 `<Typography component="pre">`（2026-10-05 修）。

          这一处和 `sections/AboutSection.tsx` 的 CHANGELOG 弹窗是**同一个模式**：
          `fetch` 一个 `.md` 文件 → 塞进 `pre` 当纯文本 → **markdown 语法原样露给用户**。
          实测证据（`scripts/qa/check-md-leak.mjs` 的输出）：
            本页面上出现 `本应用**没有任何遥测 / 崩溃上报 SDK**（对应 PL-20：…）`
            —— 星号连字符一起显示。

          ★ 为什么两处一起修、还专门写了全站扫描脚本：
            这类"能力已存在但没接上"的缺陷，**修一个实例不等于修掉模式**。
            本项目在 `desc.group.*` 那批文案上已经栽过一次
            （见 `copy/registry.ts` 里"修的是实例、不是模式"那段注释）。
            ⇒ 所以这次的做法是：**先写扫描器找出全部同类，再逐个修**，
              而不是"看到一处改一处"。扫描结果是本项目**只有这两处**
              会 fetch `.md`（其余 `component="pre"` 都是渲染代码 / JSON，
              那些**本来就该是 pre**，不动）。

          ★ 另外：上面的 `sections` 索引用的是自己写的 `parseSections`（抽 `## ` 标题），
            它**不认识 markdown 的其它语法**，但只用来做 Chips 索引，不受本次改动影响。
        */}
        {text !== '' ? (
          <Box sx={{ maxHeight: '60dvh', overflow: 'auto' }}>
            <MarkdownView content={text} dense={false} />
          </Box>
        ) : (
          <Typography variant="caption" sx={{ opacity: 0.7 }}>
            {sl('sdk.fileMissing')}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}

export default SdkPage;
