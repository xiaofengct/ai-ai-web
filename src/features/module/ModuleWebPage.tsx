import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { CapabilityGate } from '@/components/CapabilityGate';
import { useSnack } from '@/hooks/useSnack';
import { t } from '@/copy';
import { log } from '@/store/logStore';
import {
  MODULE_CAPABILITIES,
  readModuleEntry,
  writeModuleEntry,
  type ModuleRegistryEntry,
} from './ModulePermissionPage';

/**
 * 沙箱模块页（PG-24 的降级实现）。
 *
 * ★★ 与原生 WebView 的差距（必须明示，见能力表 PG-24 = partial）：
 *   原生能加载任意 WebView 并注入 JS；网页只能用**受限 iframe + postMessage**，
 *   `sandbox` 里**不给 `allow-same-origin`**（否则子页面能拿到我们的 origin 并操作父文档），
 *   能力大幅收窄。UI 上用 `alt.iframeSandbox` 说明，不假装等价。
 *
 * ★ 安全约束（本文件的红线）：
 *   1. `sandbox` 只给 `allow-scripts allow-forms allow-popups`；
 *   2. 收到 message 时**必须校验 `event.source === iframe.contentWindow`**；
 *   3. 子页面只能拿到下面 `BRIDGE_METHODS` 列出的有限能力，一律不回传 Key / 消息内容 / 存储句柄。
 */

/** 允许子页面调用的桥接方法（白名单，越少越好） */
const BRIDGE_METHODS: readonly string[] = [
  'ping',
  'getCapabilities',
  'toast',
  'log',
] as const;

/**
 * 模块注册表（读写）放在 `ModulePermissionPage.tsx`，
 * 这里只 import 使用——避免两个页面互相引用形成环。
 */
export default function ModuleWebPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const snack = useSnack();

  const urlParam = searchParams.get('url') ?? undefined;
  const entry = useMemo(() => readModuleEntry(id, urlParam), [id, urlParam]);

  const [url, setUrl] = useState<string>(entry.url);
  const [loaded, setLoaded] = useState<string>('');
  const [bridgeLog, setBridgeLog] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setUrl(entry.url);
  }, [entry.url]);

  /** ★ 只回应来自自己 iframe 的消息，且只做白名单内的动作 */
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return; // ★ 来源校验
      const data = event.data as { type?: string; method?: string; payload?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      const method = data.method ?? data.type ?? '';
      if (!BRIDGE_METHODS.includes(method)) {
        // 不在白名单：只记一笔，绝不做任何事
        setBridgeLog((prev) => [...prev.slice(-19), `blocked: ${method}`]);
        return;
      }

      const target = iframe.contentWindow;
      if (!target) return;

      switch (method) {
        case 'ping':
          target.postMessage({ type: 'ai-ai:result', method, ok: true }, '*');
          break;
        case 'getCapabilities':
          // 只回能力元信息（id + level），不回任何实现细节或凭据
          target.postMessage(
            {
              type: 'ai-ai:result',
              method,
              ok: true,
              capabilities: MODULE_CAPABILITIES.map((c) => ({ id: c.id, level: c.level })),
            },
            '*',
          );
          break;
        case 'toast':
          // 只给一句中性提示，不把子页面的原文直接当文案展示
          snack.show('tip.guideDone');
          target.postMessage({ type: 'ai-ai:result', method, ok: true }, '*');
          break;
        case 'log':
          log.debug('module', 'module log', { from: id, payload: data.payload }, 'PG-24');
          setBridgeLog((prev) => [...prev.slice(-19), `log: ${String(data.payload).slice(0, 120)}`]);
          target.postMessage({ type: 'ai-ai:result', method, ok: true }, '*');
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id, snack]);

  const handleLoad = useCallback(() => {
    if (url.trim() === '') return;
    // 只接受 http(s)，挡掉 javascript: / data: 这类伪协议
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      snack.error('err.importInvalid');
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      snack.error('err.capabilityUnavailable');
      return;
    }
    const next: ModuleRegistryEntry = { ...entry, url: parsed.toString() };
    writeModuleEntry(next);
    setLoaded(parsed.toString());
    setBridgeLog([]);
    log.info('module', 'load sandboxed module', { id, url: parsed.origin }, 'PG-24');
  }, [url, entry, snack, id]);

  return (
    <Box sx={{ width: '100%', maxWidth: 960, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {`module · ${id || '-'}`}
      </Typography>

      {/* ★ PG-24 = partial：只能做到受限 iframe */}
      <CapabilityGate featureId="PG-24">
        <Typography variant="caption" sx={{ display: 'block', mb: 2, opacity: 0.75 }}>
          {t('alt.iframeSandbox')}
        </Typography>
      </CapabilityGate>

      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <TextField
          size="small"
          label={t('ui.moduleUrl')}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://"
          fullWidth
        />
        <Button
          variant="contained"
          startIcon={<OpenInNewIcon />}
          onClick={handleLoad}
          sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
        >
          {t('common.open')}
        </Button>
      </Stack>

      {loaded ? (
        <Paper variant="outlined" sx={{ p: 0.5, mb: 2 }}>
          <iframe
            ref={iframeRef}
            // ★ 原来是 `module-${id}`：读屏会念出一串技术 id。改为文案（无障碍标签也算面向用户）。
            title={t('ui.moduleFrame')}
            src={loaded}
            /**
             * ★★ sandbox 不给 allow-same-origin：
             * 给了就等于让第三方页面拿到我们的 origin，能直接操作父文档与 storage。
             * 代价是子页面无法读自己的 localStorage / cookie —— 这正是我们要的收窄。
             */
            sandbox="allow-scripts allow-forms allow-popups"
            style={{ width: '100%', height: 460, border: 0, borderRadius: 8 }}
          />
        </Paper>
      ) : (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('ui.dropHere')}
        </Alert>
      )}

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {`bridge: ${BRIDGE_METHODS.join(' / ')}`}
      </Typography>
      {bridgeLog.length === 0 ? (
        <Typography variant="caption" sx={{ opacity: 0.6 }}>
          {t('empty.logs')}
        </Typography>
      ) : (
        <Stack spacing={0.25}>
          {bridgeLog.map((line, index) => (
            <Typography key={`${index}-${line}`} variant="caption" sx={{ fontFamily: 'monospace' }}>
              {line}
            </Typography>
          ))}
        </Stack>
      )}
    </Box>
  );
}
