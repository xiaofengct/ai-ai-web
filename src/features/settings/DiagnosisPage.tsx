import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RefreshIcon from '@mui/icons-material/Refresh';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import { EmptyState } from '@/components/EmptyState';
import { sl, type SettingsTextKey } from './settingsCopy';
import { requestNotificationPermission, runCapabilityProbes, probeStorageQuota } from './capabilityProbe';
import type { ProbeResult } from './capabilityProbe';
import { logRepo } from '@/db/repo/logRepo';
import { formatBytes } from '@/lib/file';
import { formatClock } from '@/lib/time';
import { useSnack } from '@/hooks/useSnack';
import { t } from '@/copy';
import type { LogEntry } from '@/types/log';

/**
 * 诊断页（PG-20 / FN-58）。
 *
 * ★ 能力表里 PG-20 是 `partial`：原生的「无障碍 / 悬浮窗 / 后台保活」在网页上没有意义，
 *   替换成 **Web 能力探针 + 存储配额 + 最近错误**（替代方案文案见 `alt.webProbe`）。
 *   页面的 PG-20 闸门会把这条原因直接展示出来，不藏。
 */

/** 探针 key → 名称 / 说明 文案 key */
const PROBE_TEXT: Record<ProbeResult['key'], { label: SettingsTextKey; desc: SettingsTextKey }> = {
  fsAccess: { label: 'diag.fsAccess', desc: 'diag.fsAccessDesc' },
  notification: { label: 'diag.notification', desc: 'diag.notificationDesc' },
  speech: { label: 'diag.speech', desc: 'diag.speechDesc' },
  wasmSimd: { label: 'diag.wasmSimd', desc: 'diag.wasmSimdDesc' },
  microphone: { label: 'diag.microphone', desc: 'diag.speechDesc' },
  camera: { label: 'diag.camera', desc: 'diag.speechDesc' },
  vibrate: { label: 'diag.vibrate', desc: 'diag.speechDesc' },
  serviceWorker: { label: 'diag.serviceWorker', desc: 'diag.serviceWorkerDesc' },
};

/** 状态 → 展示文案 */
function statusLabel(status: ProbeResult['status']): string {
  if (status === 'ok') return sl('ui.supported');
  if (status === 'fail') return sl('ui.unsupported');
  return sl('ui.unknown');
}

function statusColor(status: ProbeResult['status']): 'success' | 'default' | 'warning' {
  if (status === 'ok') return 'success';
  if (status === 'fail') return 'default';
  return 'warning';
}

export function DiagnosisPage(): JSX.Element {
  const snack = useSnack();
  const [probes, setProbes] = useState<ProbeResult[]>([]);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [errors, setErrors] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    const [probeResults, storage, errRes] = await Promise.all([
      runCapabilityProbes(),
      probeStorageQuota(),
      logRepo.listByLevel('error', 20),
    ]);
    setProbes(probeResults);
    setQuota(storage);
    setErrors(errRes.ok ? errRes.value : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 使用率（配额拿不到时按 0 处理） */
  const usageRatio = useMemo(() => {
    if (!quota || quota.quota <= 0) return 0;
    return Math.min(1, quota.usage / quota.quota);
  }, [quota]);

  const handleGrantNotification = useCallback(async (): Promise<void> => {
    const result = await requestNotificationPermission();
    if (result === 'granted') snack.success('ok.saved');
    else if (result === 'denied') snack.error('err.notificationDenied');
    else snack.error('err.unknown');
    await refresh();
  }, [refresh, snack]);

  return (
    <Box sx={{ width: '100%', maxWidth: 860, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Stack spacing={0.25} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {sl('label.diagnosis')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {sl('page.diagnosis.desc')}
        </Typography>
      </Stack>

      {/* ——— 能力探针 ——— */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
            {sl('diag.probe')}
          </Typography>
          <Button
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => void refresh()}
            disabled={loading}
            sx={{ minHeight: 44 }}
          >
            {sl('diag.refresh')}
          </Button>
        </Stack>

        <Stack spacing={1}>
          {probes.map((p) => {
            const text = PROBE_TEXT[p.key];
            return (
              <Stack key={`${p.featureId}-${p.key}`} direction="row" spacing={1} alignItems="center" sx={{ minHeight: 44 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {sl(text.label)}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                    {sl(text.desc)}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  color={statusColor(p.status)}
                  variant={p.status === 'ok' ? 'filled' : 'outlined'}
                  label={statusLabel(p.status)}
                  sx={{ flexShrink: 0 }}
                />
                <Typography variant="caption" sx={{ opacity: 0.5, fontFamily: 'monospace', minWidth: 78, textAlign: 'right' }}>
                  {p.detail}
                </Typography>
              </Stack>
            );
          })}
          {probes.length === 0 && !loading ? (
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {sl('ui.checking')}
            </Typography>
          ) : null}
        </Stack>

        {/* 通知权限一键申请 */}
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<NotificationsActiveIcon />}
            onClick={() => void handleGrantNotification()}
            sx={{ minHeight: 44 }}
          >
            {sl('diag.grantNotification')}
          </Button>
          <Chip
            size="small"
            variant="outlined"
            color={typeof navigator !== 'undefined' && navigator.onLine ? 'success' : 'warning'}
            label={typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline'}
            sx={{ fontFamily: 'monospace' }}
          />
        </Stack>
      </Paper>

      {/* ——— 存储配额 ——— */}
      <Paper variant="outlined" sx={{ p: 2, mt: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          {sl('diag.storage')}
        </Typography>
        {quota ? (
          <>
            <LinearProgress variant="determinate" value={usageRatio * 100} sx={{ height: 8, borderRadius: '999px' }} />
            <Typography variant="caption" sx={{ display: 'block', mt: 0.75, opacity: 0.75 }}>
              {`${sl('ui.used')} ${formatBytes(quota.usage)} / ${sl('ui.quota')} ${formatBytes(quota.quota)}（${(usageRatio * 100).toFixed(1)}%）`}
            </Typography>
            {usageRatio > 0.85 ? (
              <Chip size="small" color="warning" variant="outlined" label={t('tip.storageWarning')} sx={{ mt: 0.75 }} />
            ) : null}
          </>
        ) : (
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {sl('ui.unknown')}
          </Typography>
        )}
      </Paper>

      {/* ——— 最近错误 ——— */}
      <Paper variant="outlined" sx={{ p: 2, mt: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          {sl('diag.recentErrors')}
        </Typography>
        {errors.length === 0 ? (
          <EmptyState descKey="empty.logs" dense />
        ) : (
          <Stack spacing={0.5} sx={{ maxHeight: 320, overflow: 'auto' }}>
            {errors.map((e) => (
              <Box key={e.id}>
                <Stack direction="row" spacing={1} alignItems="baseline">
                  <Typography variant="caption" sx={{ opacity: 0.5, fontFamily: 'monospace', flexShrink: 0 }}>
                    {formatClock(e.at)}
                  </Typography>
                  <Chip size="small" color="error" variant="outlined" label={e.level} />
                  <Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-word' }}>
                    {e.message}
                  </Typography>
                </Stack>
                {e.detail !== undefined ? (
                  <Typography
                    component="pre"
                    variant="caption"
                    sx={{
                      mt: 0.25,
                      p: 0.75,
                      m: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      bgcolor: 'action.hover',
                      borderRadius: '12px',
                      fontFamily: 'monospace',
                    }}
                  >
                    {JSON.stringify(e.detail, null, 2)}
                  </Typography>
                ) : null}
                <Divider sx={{ mt: 0.5 }} />
              </Box>
            ))}
          </Stack>
        )}
      </Paper>
    </Box>
  );
}

export default DiagnosisPage;
