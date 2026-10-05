import { useCallback, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import { EmptyState } from '@/components/EmptyState';
import { sl } from './settingsCopy';
import { testConnection } from '@/llm/connectTest';
import { chatPathCandidates, joinUrl, normalizeBaseUrl, previewChatUrl } from '@/llm/adapter/compat';
import { copyText } from '@/lib/download';
import { redact } from '@/lib/errors';
import { formatClock } from '@/lib/time';
import { useSettingsStore } from '@/store/settingsStore';
import { useSnack } from '@/hooks/useSnack';
import { t, type CopyKey } from '@/copy';
import type { ConnectTestResult } from '@/llm/types';
import type { LLMProviderConfig } from '@/types/settings';

/**
 * 连接测试页（PG-18）。
 *
 * 流程：`/models` 探测 → 最小 chat（max_tokens=8）→ 展示**延迟 / 状态码 / 错误码 / 原始响应**。
 * 判定口径（见 `llm/connectTest.ts`）：**chat 通了就算通**——很多自建端点没有 `/models`。
 *
 * ★ 所有展示的原始内容都过 `redact()`，Key 一律是 `***`（架构文档 §6.3）。
 */

/** 错误码 → 欣然口吻的文案 key（不把英文 message 直接甩给用户，§6.2） */
function errorCopyKey(code: string | undefined): CopyKey {
  switch (code) {
    case 'LLM_AUTH':
      return 'err.llmAuth';
    case 'LLM_TIMEOUT':
      return 'err.llmTimeout';
    case 'LLM_NO_PROVIDER':
      return 'err.llmNoProvider';
    case 'LLM_NO_MODEL':
      return 'err.llmNoModel';
    case 'ABORTED':
    case 'LLM_ABORT':
      return 'err.llmAbort';
    case 'NETWORK_OFFLINE':
      return 'err.networkOffline';
    default:
      return 'err.llmFailed';
  }
}

export function ConnectionTestPage(): JSX.Element {
  const snack = useSnack();
  const providers = useSettingsStore((s) => s.settings.providers);
  const activeProviderId = useSettingsStore((s) => s.settings.activeProviderId);

  const [targetId, setTargetId] = useState<string>(activeProviderId);
  const [running, setRunning] = useState<boolean>(false);
  const [result, setResult] = useState<ConnectTestResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const provider = useMemo<LLMProviderConfig | undefined>(
    () => providers.find((p) => p.id === targetId) ?? providers[0],
    [providers, targetId],
  );

  /**
   * 展示用的请求预览（Key 已脱敏）。
   *
   * ★★ 2026-10-04 修正：原来这里写的是 `${provider.baseUrl}/chat/completions` ——
   *   **与实际请求的地址不是同一个**。真实调用走的是
   *   `resolveChatUrl()`（会先 `normalizeBaseUrl` 再按 base 决定路径，
   *   兼容模式下还要探测），例如：
   *     预览说  https://api.deepseek.com/v1/chat/completions   ← 恰好对了
   *     实际走  https://api.deepseek.com/v1/v1/chat/completions ← 原来是这样
   *   于是"预览"把一个错的地址显示得像对的，**把排查带偏**。
   *
   *   现在改成调用与真实请求**同一套**解析逻辑的 `previewChatUrl()`，
   *   并额外列出会尝试的候选路径（兼容模式下才有多个候选）。
   */
  const requestPreview = useMemo(() => {
    if (!provider) return '';
    const base = normalizeBaseUrl(provider.baseUrl);
    const candidates = provider.pathOverrides?.chat
      ? [provider.pathOverrides.chat]
      : chatPathCandidates(base);
    return JSON.stringify(
      redact({
        url: previewChatUrl(provider.baseUrl),
        ...(candidates.length > 1 ? { 候选路径: candidates.map((p) => joinUrl(base, p)) } : {}),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ***',
          ...(provider.headers ?? {}),
        },
        body: { model: provider.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 },
      }),
      null,
      2,
    );
  }, [provider]);

  const run = useCallback(async (): Promise<void> => {
    if (!provider) {
      snack.error('err.llmNoProvider');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResult(null);
    try {
      const res = await testConnection({
        provider,
        signal: controller.signal,
        // 改完 baseUrl 立刻重测时才需要清缓存；这里每次都清，避免拿到旧路径
        forceReprobe: true,
      });
      setResult(res);
      if (res.ok) snack.success('ok.connectionOk');
      else snack.error(errorCopyKey(res.errorCode));
    } catch {
      snack.error('err.unknown');
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [provider, snack]);

  const stop = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    // ★ 主动中止是一次失败结果，按 err.* 走 error 档（原 snack.raw() 会恒译成「好了」，B-03）
    snack.error('err.llmAbort');
  }, [snack]);

  const handleCopy = useCallback(async (): Promise<void> => {
    if (!result) return;
    const text = JSON.stringify(redact(result), null, 2);
    const done = await copyText(text);
    // ★ 同 CrashPage：成功/失败分开走，别再恒译「好了」（B-03）
    if (done) snack.success('common.copied');
    else snack.error('err.unknown');
  }, [result, snack]);

  return (
    <Box sx={{ width: '100%', maxWidth: 860, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Stack spacing={0.25} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {sl('label.connection')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {sl('page.connection.desc')}
        </Typography>
      </Stack>

      {/* ——— 操作区 ——— */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'center' }}>
          <TextField
            select
            size="small"
            label={sl('label.provider')}
            value={provider?.id ?? ''}
            onChange={(e) => setTargetId(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            {providers.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            startIcon={<PlayArrowIcon />}
            onClick={() => void run()}
            disabled={running}
            sx={{ minHeight: 44 }}
          >
            {running ? sl('ui.running') : sl('ui.runTest')}
          </Button>
          {running ? (
            <Button variant="outlined" color="inherit" startIcon={<StopIcon />} onClick={stop} sx={{ minHeight: 44 }}>
              {sl('ui.stop')}
            </Button>
          ) : null}
        </Stack>

        {running ? <LinearProgress sx={{ mt: 1.5 }} /> : null}

        {provider ? (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', mt: 1.5 }}>
            <Chip size="small" variant="outlined" label={provider.baseUrl || sl('ui.notSet')} />
            <Chip size="small" variant="outlined" label={provider.model || sl('ui.notSet')} />
            <Chip
              size="small"
              variant="outlined"
              color={provider.apiKey ? 'primary' : 'default'}
              label={`${sl('label.apiKey')}：${provider.apiKey ? sl('ui.filled') : sl('ui.notSet')}`}
            />
          </Stack>
        ) : (
          <Box sx={{ mt: 1.5 }}>
            <EmptyState descKey="empty.personas" dense />
          </Box>
        )}
      </Paper>

      {/* ——— 结果区 ——— */}
      {result ? (
        <Paper variant="outlined" sx={{ p: 2, mt: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Chip
              size="small"
              color={result.ok ? 'success' : 'error'}
              variant="filled"
              label={result.ok ? sl('conn.okTitle') : sl('conn.failTitle')}
            />
            <Typography variant="body2" sx={{ opacity: 0.8, flex: 1 }}>
              {result.ok ? sl('conn.okDesc') : sl('conn.failDesc')}
            </Typography>
            <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => void handleCopy()} sx={{ minHeight: 44 }}>
              {t('common.copy')}
            </Button>
          </Stack>

          <Divider sx={{ my: 1 }} />

          <Stack spacing={0.75}>
            <Row label={sl('conn.latency')} value={result.latencyMs === undefined ? '—' : `${result.latencyMs} ms`} />
            <Row label={sl('conn.statusCode')} value={result.statusCode === undefined ? '—' : String(result.statusCode)} />
            <Row label={sl('conn.errorCode')} value={result.errorCode ?? '—'} mono />
            <Row label={sl('conn.at')} value={formatClock(result.at)} />
            {result.errorCode ? (
              <Row label={sl('ui.note')} value={t(errorCopyKey(result.errorCode))} />
            ) : null}
          </Stack>

          {result.models && result.models.length > 0 ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {sl('conn.models')}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', mt: 0.5 }}>
                {result.models.slice(0, 20).map((m) => (
                  <Chip key={m} size="small" variant="outlined" label={m} sx={{ fontFamily: 'monospace' }} />
                ))}
              </Stack>
            </Box>
          ) : null}

          {/*
            ★★★ 实际请求的地址（2026-10-04 加）。
            ------------------------------------------------
            放在「原始响应」**之前**，因为排查顺序就是这样：
            先看"打到哪去了"，再看"对方回了什么"。
            这一条在之前是完全缺失的 —— 用户那次的错误信息里只有
            「请求被拒绝（HTTP 404）」，无从判断是不是地址被拼错了。
          */}
          {result.url ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {sl('conn.actualUrl')}
              </Typography>
              <Typography
                variant="caption"
                sx={{ display: 'block', mt: 0.5, fontFamily: 'monospace', wordBreak: 'break-all', opacity: 0.9 }}
              >
                {result.url}
              </Typography>
            </Box>
          ) : null}

          {/* 服务端原话：与 `raw`（应用自己的描述）分工不同 —— 前者好读，后者好查 */}
          {result.serverBody ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {sl('conn.serverBody')}
              </Typography>
              <Typography
                component="pre"
                variant="caption"
                sx={{
                  mt: 0.5,
                  p: 1,
                  m: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  bgcolor: 'action.hover',
                  borderRadius: '12px',
                  fontFamily: 'monospace',
                  maxHeight: 160,
                  overflow: 'auto',
                }}
              >
                {String(redact(result.serverBody))}
              </Typography>
            </Box>
          ) : null}

          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {sl('conn.raw')}
            </Typography>
            <Typography
              component="pre"
              variant="caption"
              sx={{
                mt: 0.5,
                p: 1,
                m: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                bgcolor: 'action.hover',
                borderRadius: '12px',
                fontFamily: 'monospace',
                maxHeight: 240,
                overflow: 'auto',
              }}
            >
              {String(redact(result.raw ?? '—'))}
            </Typography>
          </Box>
        </Paper>
      ) : null}

      {/* ——— 请求预览（脱敏） ——— */}
      <Paper variant="outlined" sx={{ p: 2, mt: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>
            {sl('conn.request')}
          </Typography>
          <Chip size="small" variant="outlined" color="warning" label={sl('dev.redacted')} />
        </Stack>
        <Typography
          component="pre"
          variant="caption"
          sx={{
            mt: 1,
            p: 1,
            m: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            bgcolor: 'action.hover',
            borderRadius: '12px',
            fontFamily: 'monospace',
            maxHeight: 280,
            overflow: 'auto',
          }}
        >
          {requestPreview || sl('conn.noProvider')}
        </Typography>
      </Paper>
    </Box>
  );
}

/** 一行「标签 + 值」 */
function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      <Typography variant="caption" sx={{ opacity: 0.6, minWidth: 84, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ wordBreak: 'break-word', ...(mono ? { fontFamily: 'monospace' } : null) }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

export default ConnectionTestPage;
