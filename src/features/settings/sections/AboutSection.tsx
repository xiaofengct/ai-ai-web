import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { SettingsField } from '../SettingsField';
import { sl } from '../settingsCopy';
import { MarkdownView } from '@/components/MarkdownView';
import { useSettingsStore } from '@/store/settingsStore';
import { to } from '@/router/paths';
import { t, type CopyKey } from '@/copy';

/**
 * 关于分组（FN-35 更新说明 + 各子页入口：PG-18 / PG-19 / PG-20 / PG-21 / PG-23 / PG-26）。
 *
 * ★ FN-35 的实现口径：版本号比对 → 首次打开弹本地静态 changelog。
 *   changelog 放在 `public/CHANGELOG.md`（构建后可直接 fetch），
 *   取不到就如实提示「没读到」，不编造内容（XR-05：不编造她不知道的东西）。
 */

/** 当前应用版本（与 package.json 保持一致） */
const APP_VERSION = '0.1.0';

/** 关于页的跳转入口（功能项 ID 一并列出来，便于自检） */
interface AboutLink {
  path: string;
  labelKey: Parameters<typeof sl>[0];
  featureId: string;
  /** 说明走文案总表（优先，避免和 settingsCopy 形成两份文案） */
  hintCopyKey?: CopyKey;
}

const LINKS: readonly AboutLink[] = [
  { path: to.settingsConnection(), labelKey: 'label.connection', featureId: 'PG-18' },
  { path: to.settingsDeveloper(), labelKey: 'label.developer', featureId: 'PG-19' },
  { path: to.settingsDiagnosis(), labelKey: 'label.diagnosis', featureId: 'PG-20' },
  { path: to.settingsSponsor(), labelKey: 'label.sponsor', featureId: 'PG-21' },
  { path: to.settingsSdk(), labelKey: 'label.sdk', featureId: 'PG-26' },
  {
    path: to.settingsBridge(),
    labelKey: 'label.bridge',
    featureId: 'PG-23',
    // ★ 桥接说明用文案总表的 settings.hint.bridge，与侧边导航同一份文案
    hintCopyKey: 'settings.hint.bridge',
  },
];

export function AboutSection(): JSX.Element {
  /** FN-35 首次打开弹更新说明 */
  const [showNotes, setShowNotes] = useState<boolean>(false);
  const [changelog, setChangelog] = useState<string>('');
  const seenVersion = useSettingsStore((s) => s.settings.updateNotesSeenVersion);
  const patch = useSettingsStore((s) => s.patch);

  /** 载入本地静态 changelog */
  const openNotes = useCallback((): void => {
    setShowNotes(true);
    void fetch('/CHANGELOG.md')
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('missing'))))
      .then((text) => setChangelog(text))
      .catch(() => setChangelog(''));
    // 标记已读，避免下次启动重复弹
    patch({ updateNotesSeenVersion: APP_VERSION });
  }, [patch]);

  /** 首次进入时若版本没看过，自动弹一次（FN-35 的原行为） */
  useEffect(() => {
    if (seenVersion === APP_VERSION) return;
    if (showNotes) return;
    setShowNotes(true);
    void fetch('/CHANGELOG.md')
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('missing'))))
      .then((text) => setChangelog(text))
      .catch(() => setChangelog(''));
    patch({ updateNotesSeenVersion: APP_VERSION });
  }, [seenVersion, showNotes, patch]);

  return (
    <Box>
      {/* —— 版本 —— */}
      <SettingsField labelKey="label.version">
        <Typography variant="body2" sx={{ fontFamily: 'monospace', opacity: 0.8 }}>
          {APP_VERSION}
        </Typography>
      </SettingsField>

      {/* —— FN-35 更新说明 —— */}
      <SettingsField labelKey="label.updateNotes" hintKey="hint.updateNotes" featureId="FN-35">
        <Stack direction="row" spacing={1} alignItems="center">
          {/* ★ 空串而不是 undefined：`deepMerge` 把 undefined 当「没写」，会让关不掉 */}
          <Switch
            checked={seenVersion === APP_VERSION}
            onChange={(e) => patch({ updateNotesSeenVersion: e.target.checked ? APP_VERSION : '' })}
          />
          <Button variant="outlined" onClick={openNotes} sx={{ minHeight: 44 }}>
            {sl('ui.goPage')}
          </Button>
        </Stack>
      </SettingsField>

      <Divider sx={{ my: 1 }} />

      {/* —— 子页入口 —— */}
      <Stack spacing={0.75} sx={{ py: 1 }}>
        {LINKS.map((item) => (
          <Box key={item.path}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                fullWidth
                variant="text"
                component={Link}
                to={item.path}
                sx={{ minHeight: 44, justifyContent: 'flex-start' }}
              >
                {sl(item.labelKey)}
              </Button>
            </Stack>
            {item.hintCopyKey ? (
              <Typography variant="caption" sx={{ display: 'block', opacity: 0.6, pl: 1.5, pb: 0.5 }}>
                {t(item.hintCopyKey)}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Stack>

      <Dialog open={showNotes} onClose={() => setShowNotes(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{sl('label.changelog')}</DialogTitle>
        <DialogContent>
          {/*
            ★★ 用 `MarkdownView` 渲染，**不要**再用 `<Typography component="pre">`（2026-10-05 修）。

            ── 原来的写法坏在哪 ──────────────────────────────────────────
            `public/CHANGELOG.md` 是一份 **Markdown 文件**，而原实现把它当成
            纯文本塞进 `pre`：于是 `**基础设施**` 的星号、`- 列表项` 的短横
            全部**原样显示给用户**。实测证据：`/settings` 页面上字面 `**` 出现
            18 次（探针 `scripts/tmp-probe-star.mjs` 的输出，见交付说明）。
            对用户来说这就是"排版坏了"，而且是**更新说明**这一屏 ——
            用户第一次打开应用就会看到它（FN-35 自动弹）。

            ── 为什么改渲染、而不是把 CHANGELOG.md 里的 markdown 去掉 ────
            CHANGELOG.md 同时服务两个读者：
              · 界面里看的用户（要排版）；
              · 源码包里翻文件的人（要 markdown 的可读性与 diff 友好）。
            去掉 markdown 会把后者的可读性一起牺牲掉，而且它是**发布物的一部分**。
            ⇒ 该修的是"渲染器没用对"，不是"源码文件写得不对"。
              （项目里 `MarkdownView` 早就有，只是这里没用上 —— 属于典型的
               "能力已存在但没接上"，不是缺功能。）
          */}
          {changelog !== '' ? (
            <MarkdownView content={changelog} dense={false} />
          ) : (
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {sl('sdk.fileMissing')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowNotes(false)} sx={{ minHeight: 44 }}>
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default AboutSection;
