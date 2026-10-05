import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { NumberField } from '@/components/NumberField';
import { SettingsField } from '../SettingsField';
import { SettingsNotice } from '../SettingsNotice';
import { sl } from '../settingsCopy';
import { useAdvancedFlag, useAdvancedNumber, useAdvancedText } from '../useAdvancedFlags';
import { useLogStore } from '@/store/logStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSnack } from '@/hooks/useSnack';
import { downloadText } from '@/lib/download';
import { nowISO } from '@/lib/time';
import { to } from '@/router/paths';
import { t } from '@/copy';
import type { LLMProviderConfig } from '@/types/settings';

/**
 * 高级分组（FN-26 导出日志 / FN-58 诊断 / FN-62 高级配置，另含遥测总开关）。
 *
 * ★ FN-62 的浏览器限制必须写在页面上（验收要点⑤）：
 *   `Origin` / `Referer` / `Host` 这类**禁止覆盖的安全头**由浏览器强制丢弃，
 *   而且网页没有系统代理——代理只能让用户自己装浏览器扩展或配 CORS 代理。
 */

/** ★ 浏览器禁止覆盖的请求头（写了也会被丢掉，UI 上必须明示） */
const FORBIDDEN_HEADERS: readonly string[] = [
  'Origin',
  'Referer',
  'Host',
  'Content-Length',
  'Connection',
  'Cookie',
  'Sec-Fetch-Mode',
  'Sec-Fetch-Site',
  'Proxy-Authorization',
];

/** 请求头文本 → 对象（一行一个，形如 `Name: value`） */
function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const idx = raw.indexOf(':');
    if (idx <= 0) continue;
    const name = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (name !== '') out[name] = value;
  }
  return out;
}

/** 对象 → 请求头文本 */
function headersToText(headers: Record<string, string> | undefined): string {
  if (!headers) return '';
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

export function AdvancedSection(): JSX.Element {
  const snack = useSnack();
  const providers = useSettingsStore((s) => s.settings.providers);
  const activeProviderId = useSettingsStore((s) => s.settings.activeProviderId);
  const upsertProvider = useSettingsStore((s) => s.upsertProvider);
  const dev = useSettingsStore((s) => s.settings.dev);
  const patch = useSettingsStore((s) => s.patch);
  const exportJSONL = useLogStore((s) => s.exportJSONL);

  const current = useMemo<LLMProviderConfig | undefined>(
    () => providers.find((p) => p.id === activeProviderId) ?? providers[0],
    [providers, activeProviderId],
  );

  /** 请求头草稿（直接编辑字典会丢焦点，先用文本缓冲） */
  const [headerDraft, setHeaderDraft] = useState<string>(headersToText(current?.headers));
  /** 用户试图覆盖但被浏览器禁止的头（实时提示） */
  const blocked = useMemo(
    () =>
      Object.keys(parseHeaders(headerDraft)).filter((k) =>
        FORBIDDEN_HEADERS.some((f) => f.toLowerCase() === k.toLowerCase()),
      ),
    [headerDraft],
  );

  /** FN-62 重试次数 / 代理地址 */
  const [retries, setRetries] = useAdvancedNumber('FN-62.retries', 2);
  const [proxyUrl, setProxyUrl] = useAdvancedText('FN-62.proxy', '');

  /**
   * ★★ 遥测总开关（决策 A7）：**全项目唯一**一个遥测开关，默认 false。
   * 默认路径下不发起任何外部请求（除用户自己配的 LLM API）；
   * 即使打开，本版也只写本地日志，不做任何上报。
   */
  const [telemetryEnabled, setTelemetryEnabled] = useAdvancedFlag('telemetry.enabled', false);

  const patchProvider = useCallback(
    (partial: Partial<LLMProviderConfig>) => {
      if (!current) return;
      upsertProvider({ ...current, ...partial });
    },
    [current, upsertProvider],
  );

  /**
   * 写单个路径覆盖。
   * ★ 用显式分支而不是计算属性名：计算属性名在 TS 里会退化成索引签名，
   *   过不了 `Partial<LLMProviderConfig>` 的类型检查。
   */
  const setPathOverride = useCallback(
    (key: 'chat' | 'models' | 'image' | 'tts', value: string): void => {
      const next: NonNullable<LLMProviderConfig['pathOverrides']> = { ...(current?.pathOverrides ?? {}) };
      if (key === 'chat') next.chat = value;
      else if (key === 'models') next.models = value;
      else if (key === 'image') next.image = value;
      else next.tts = value;
      patchProvider({ pathOverrides: next });
    },
    [current?.pathOverrides, patchProvider],
  );

  /** FN-26 导出日志（.jsonl，已脱敏） */
  const handleExportLogs = useCallback((): void => {
    downloadText(exportJSONL(), `ai-ai-logs-${nowISO().slice(0, 10)}.jsonl`, 'application/jsonl');
    snack.success('ok.logsExported');
  }, [exportJSONL, snack]);

  if (!current) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {t('err.llmNoProvider')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* ★ 分组说明直接取文案总表的 settings.hint.advanced，不在本地表另起副本 */}
      <Typography variant="caption" sx={{ display: 'block', opacity: 0.65, pb: 1 }}>
        {t('settings.hint.advanced')}
      </Typography>

      {/* ★ FN-62 的浏览器限制横幅：验收要点⑤ */}
      <SettingsNotice
        extra={
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            {FORBIDDEN_HEADERS.map((h) => (
              <Chip key={h} size="small" variant="outlined" color="warning" label={h} sx={{ fontFamily: 'monospace' }} />
            ))}
          </Stack>
        }
      >
        {sl('hint.customHeadersBlocked')}
      </SettingsNotice>

      {/* —— FN-62 自定义请求头 —— */}
      <SettingsField labelKey="label.customHeaders" hintKey="hint.customHeaders" featureId="FN-62">
        <TextField
          size="small"
          multiline
          minRows={2}
          maxRows={6}
          value={headerDraft}
          onChange={(e) => setHeaderDraft(e.target.value)}
          onBlur={() => patchProvider({ headers: parseHeaders(headerDraft) })}
          sx={{ width: 260 }}
        />
      </SettingsField>
      {blocked.length > 0 ? (
        <SettingsField labelKey="ui.tip" nested featureId="FN-62">
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {blocked.map((h) => (
              <Chip key={h} size="small" color="error" variant="outlined" label={h} sx={{ fontFamily: 'monospace' }} />
            ))}
          </Stack>
        </SettingsField>
      ) : null}

      {/* —— FN-62 路径覆盖 —— */}
      <SettingsField labelKey="label.pathOverrides" hintKey="hint.pathOverrides" featureId="FN-62">
        <Stack spacing={0.75} sx={{ width: 240 }}>
          {(['chat', 'models', 'image', 'tts'] as const).map((key) => (
            <TextField
              key={key}
              size="small"
              label={sl(key === 'chat' ? 'path.chat' : key === 'models' ? 'path.models' : key === 'image' ? 'path.image' : 'path.tts')}
              value={current.pathOverrides?.[key] ?? ''}
              onChange={(e) => setPathOverride(key, e.target.value)}
            />
          ))}
        </Stack>
      </SettingsField>

      {/* —— FN-62 超时 —— */}
      <SettingsField labelKey="label.timeout" hintCopyKey="settings.hint.timeout" featureId="FN-62">
        <NumberField
          value={current.timeoutMs}
          onChange={(v) => patchProvider({ timeoutMs: v })}
          min={1000}
          max={600_000}
          step={1000}
          presets={[15_000, 30_000, 60_000, 120_000]}
          width={130}
        />
      </SettingsField>

      {/* —— FN-62 重试 —— */}
      <SettingsField labelKey="label.retry" hintKey="hint.retry" featureId="FN-62">
        <NumberField
          value={retries}
          onChange={setRetries}
          min={0}
          max={10}
          step={1}
          presets={[0, 1, 2, 3]}
          width={100}
        />
      </SettingsField>

      {/* —— FN-62 代理（只能用户自己配） —— */}
      <SettingsField labelKey="label.proxy" hintKey="hint.proxy" featureId="FN-62">
        <TextField
          size="small"
          value={proxyUrl}
          onChange={(e) => setProxyUrl(e.target.value)}
          placeholder={sl('ui.optional')}
          sx={{ width: 240 }}
        />
      </SettingsField>

      {/* —— FN-26 导出日志 —— */}
      <SettingsField labelKey="label.exportLogs" hintKey="hint.exportLogs" featureId="FN-26">
        <Stack direction="row" spacing={1} alignItems="center">
          <Switch
            checked={dev.exportLogs}
            onChange={(e) => patch({ dev: { exportLogs: e.target.checked } })}
          />
          <Button variant="outlined" onClick={handleExportLogs} sx={{ minHeight: 44 }}>
            {t('common.export')}
          </Button>
        </Stack>
      </SettingsField>

      {/* —— FN-58 诊断入口 · 等级见能力表 capabilities.ts，此处不复制 —— */}
      <SettingsField labelKey="label.diagnosis" hintKey="hint.diagnosis" featureId="FN-58">
        <Button
          variant="outlined"
          component={Link}
          to={to.settingsDiagnosis()}
          sx={{ minHeight: 44 }}
        >
          {sl('ui.goPage')}
        </Button>
      </SettingsField>

      {/* —— 遥测总开关（决策 A7，默认关闭） —— */}
      <SettingsField labelKey="label.telemetry" hintKey="hint.telemetry">
        <Switch checked={telemetryEnabled} onChange={(e) => setTelemetryEnabled(e.target.checked)} />
      </SettingsField>
    </Box>
  );
}

export default AdvancedSection;
