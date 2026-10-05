import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { PromptPreview } from '@/components/PromptPreview';
import { TokenBadge } from '@/components/TokenBadge';
import { SettingsField } from './SettingsField';
import { sl } from './settingsCopy';
import { buildPrompt } from '@/persona/PersonaCompiler';
import { SEGMENT_CONTROL_KEY } from '@/persona/promptTypes';
import { auditCapabilities } from '@/constants/capabilities';
import { DEFAULT_CONTEXT_WINDOW } from '@/constants/limits';
import { contextBudget } from '@/lib/token';
import { formatClock } from '@/lib/time';
import { redact } from '@/lib/errors';
import { downloadText } from '@/lib/download';
import { backupRepo } from '@/db/repo/backupRepo';
import { useLogStore } from '@/store/logStore';
import { useMemoryStore } from '@/store/memoryStore';
import { usePersonaStore } from '@/store/personaStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useActiveProvider } from '@/hooks/useSettings';
import { useSnack } from '@/hooks/useSnack';
import { useNavigate } from 'react-router-dom';
import { cl } from '@/features/capabilities/capabilitiesCopy';
import { to } from '@/router/paths';
import { t } from '@/copy';
import { SK } from '@/constants/storageKeys';
import type { MemoryHit } from '@/types/memory';
import type { PromptSegmentId } from '@/types/prompt';

/**
 * 开发者选项页（PG-19 / FN-26 / FN-30）。
 *
 * 四块内容：
 * ① **最终提示词逐段预览** + token 占用（可实时开关，写回 `injectControl`）；
 * ② **原始请求 / 响应**（取自日志流，**已脱敏**，Key 一律 `***`）；
 * ③ **日志流**（分级过滤、清空、导出 .jsonl）；
 * ④ **Mock 开关 + 危险区**（清空日志 / 清空本地数据）。
 *
 * ★ 隐私：展示的任何原始内容都过 `redact()`（架构文档 §6.3）。
 */
export function DeveloperPage(): JSX.Element {
  const snack = useSnack();
  const navigate = useNavigate();
  const chat = useSettingsStore((s) => s.settings.chat);
  const setChat = useSettingsStore((s) => s.setChat);
  const dev = useSettingsStore((s) => s.settings.dev);
  const patch = useSettingsStore((s) => s.patch);
  const provider = useActiveProvider();

  const personas = usePersonaStore((s) => s.personas);
  const currentId = usePersonaStore((s) => s.currentId);
  const memories = useMemoryStore((s) => s.entries);

  const logs = useLogStore((s) => s.logs);
  const loadRecent = useLogStore((s) => s.loadRecent);
  const clearLogs = useLogStore((s) => s.clear);
  const exportJSONL = useLogStore((s) => s.exportJSONL);
  const setMirrorToConsole = useLogStore((s) => s.setMirrorToConsole);

  const [logLevel, setLogLevel] = useState<'all' | 'error'>('all');
  const [pendingClearLogs, setPendingClearLogs] = useState<boolean>(false);
  const [pendingWipe, setPendingWipe] = useState<boolean>(false);

  useEffect(() => {
    void loadRecent(200);
  }, [loadRecent]);

  /** 当前角色（默认回落到第一张卡） */
  const persona = useMemo(
    () => personas.find((p) => p.id === currentId) ?? personas[0],
    [personas, currentId],
  );

  /** 记忆命中：预览时用库里最近 20 条顶上（真实链路由 memory/retrieve.ts 给 score） */
  const memoryHits = useMemo<MemoryHit[]>(
    () =>
      memories
        .slice(0, 20)
        .map((entry) => ({ entry, score: entry.score, matchedTerms: [] as string[] })),
    [memories],
  );

  /**
   * ★★ 预览 = 真实装配结果。
   * 直接调 `PersonaCompiler.build()`（纯函数、不发请求），取它返回的 `segments`。
   * 这样开发者页看到的就是真正会发出去的那份提示词，不存在「另算一遍」导致的漂移。
   * 病娇开关与上下文窗口由编译器自己从 settingsStore 派生，这里不再传。
   */
  const preview = useMemo(() => {
    if (!persona) return null;
    return buildPrompt({
      persona,
      settings: chat,
      history: [],
      userInput: '',
      memoryHits,
      kind: 'chat',
    });
  }, [persona, chat, memoryHits]);

  const segments = preview?.segments ?? [];

  const contextWindow = provider?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const budget = useMemo(
    () => contextBudget(contextWindow, chat.params.maxTokens),
    [contextWindow, chat.params.maxTokens],
  );
  const warnings = useMemo(
    () => [...(preview?.warnings ?? []), sl('dev.segmentPreviewNote')],
    [preview?.warnings],
  );

  /**
   * 逐段开关写回 `injectControl`。
   * ★ 开关来源以 `SEGMENT_CONTROL_KEY`（`src/persona/promptTypes.ts`）为准，
   *   本页不再维护任何段 → 开关的映射表，避免两处定义漂移。
   */
  const handleToggle = useCallback(
    (id: PromptSegmentId, enabled: boolean): void => {
      const controlKey = SEGMENT_CONTROL_KEY[id];
      switch (controlKey) {
        case 'system':
          setChat({ injectControl: { system: enabled } });
          break;
        case 'worldBook':
          setChat({ injectControl: { worldBook: enabled } });
          break;
        case 'memory':
          setChat({ injectControl: { memory: enabled } });
          break;
        case 'jailbreak':
          setChat({ injectControl: { jailbreak: enabled } });
          break;
        // 'always' / 'extras' → 逐段覆写落在 injectControl.extras[id]
        default:
          setChat({ injectControl: { extras: { [id]: enabled } } });
          break;
      }
    },
    [setChat],
  );

  /** 原始请求/响应：日志里 scope='llm' 的条目（detail 入库前已 redact） */
  const llmLogs = useMemo(() => logs.filter((l) => l.scope === 'llm').slice(0, 5), [logs]);

  const visibleLogs = useMemo(
    () => (logLevel === 'error' ? logs.filter((l) => l.level === 'error' || l.level === 'warn') : logs),
    [logs, logLevel],
  );

  const audit = useMemo(() => auditCapabilities(), []);

  const handleExportLogs = useCallback((): void => {
    downloadText(exportJSONL(), `ai-ai-logs-${Date.now()}.jsonl`, 'application/jsonl');
    snack.success('ok.logsExported');
  }, [exportJSONL, snack]);

  /** 危险区：清空本地数据（日志 + 备份 + 设置快照），业务数据由各 repo 自己清 */
  const handleWipe = useCallback(async (): Promise<void> => {
    clearLogs();
    await backupRepo.clear().catch(() => undefined);
    try {
      localStorage.removeItem(SK.settings);
      localStorage.removeItem(SK.ui);
    } catch {
      /* 隐私模式下不可写，忽略 */
    }
    setPendingWipe(false);
    window.location.reload();
  }, [clearLogs]);

  return (
    <Box sx={{ width: '100%', maxWidth: 900, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Stack spacing={0.25} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {sl('label.developer')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {sl('page.developer.desc')}
        </Typography>
      </Stack>

      {/* ————— ① 提示词逐段预览 ————— */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
            {sl('dev.prompt')}
          </Typography>
          {/* token 占用直接取编译器的估算值（含 system 段），不再自己累加 */}
          <TokenBadge value={preview?.tokenEstimate ?? 0} budget={budget} />
        </Stack>
        {persona ? (
          <PromptPreview
            segments={segments}
            budget={budget}
            editable
            onToggle={handleToggle}
            warnings={warnings}
          />
        ) : (
          <EmptyState descKey="empty.personas" dense />
        )}
      </Paper>

      {/* ————— ② 原始请求 / 响应（脱敏） ————— */}
      <Paper variant="outlined" sx={{ p: 2, mt: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
            {sl('dev.request')} / {sl('dev.response')}
          </Typography>
          <Chip size="small" variant="outlined" color="warning" label={sl('dev.redacted')} />
        </Stack>
        {llmLogs.length === 0 ? (
          <Box sx={{ py: 1.5 }}>
            <EmptyState descKey="empty.logs" dense />
          </Box>
        ) : (
          <Stack spacing={1} sx={{ mt: 1 }}>
            {llmLogs.map((l) => (
              <Box key={l.id}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    size="small"
                    color={l.level === 'error' ? 'error' : l.level === 'warn' ? 'warning' : 'default'}
                    variant="outlined"
                    label={l.level}
                    sx={{ fontFamily: 'monospace' }}
                  />
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                    {formatClock(l.at)}
                  </Typography>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {l.message}
                  </Typography>
                  {l.featureId ? (
                    <Chip size="small" variant="outlined" label={l.featureId} sx={{ fontFamily: 'monospace' }} />
                  ) : null}
                </Stack>
                <Typography
                  component="pre"
                  variant="caption"
                  sx={{
                    mt: 0.5,
                    p: 1,
                    m: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    bgcolor: 'action.hover',
                    borderRadius: '12px',
                    fontFamily: 'monospace',
                    maxHeight: 220,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(redact(l.detail ?? {}), null, 2)}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Paper>

      {/* ————— ③ 日志流 ————— */}
      <Paper variant="outlined" sx={{ p: 2, mt: 1.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
            {sl('dev.logs')}
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={logLevel}
            onChange={(_e, v) => {
              if (v === 'all' || v === 'error') setLogLevel(v);
            }}
            sx={{ height: 44 }}
          >
            <ToggleButton value="all" sx={{ px: 1.25, height: 44 }}>
              {sl('dev.logLevelAll')}
            </ToggleButton>
            <ToggleButton value="error" sx={{ px: 1.25, height: 44 }}>
              {sl('dev.logLevelError')}
            </ToggleButton>
          </ToggleButtonGroup>
          <Button variant="outlined" onClick={handleExportLogs} sx={{ minHeight: 44 }}>
            {sl('label.exportLogs')}
          </Button>
          <Button variant="text" color="error" onClick={() => setPendingClearLogs(true)} sx={{ minHeight: 44 }}>
            {sl('dev.clearLogs')}
          </Button>
        </Stack>

        <Divider sx={{ my: 1 }} />

        {visibleLogs.length === 0 ? (
          <EmptyState descKey="empty.logs" dense />
        ) : (
          <Stack spacing={0.25} sx={{ maxHeight: 360, overflow: 'auto' }}>
            {visibleLogs.slice(0, 100).map((l) => (
              <Stack key={l.id} direction="row" spacing={1} alignItems="baseline">
                <Typography variant="caption" sx={{ opacity: 0.5, fontFamily: 'monospace', flexShrink: 0 }}>
                  {formatClock(l.at)}
                </Typography>
                <Chip
                  size="small"
                  color={l.level === 'error' ? 'error' : l.level === 'warn' ? 'warning' : 'default'}
                  variant="outlined"
                  label={l.level}
                  sx={{ fontFamily: 'monospace', flexShrink: 0 }}
                />
                <Typography variant="caption" sx={{ opacity: 0.6, flexShrink: 0 }}>
                  {l.scope}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-word' }}>
                  {l.message}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Paper>

      {/* ————— ④ 开关 + 能力自检 + 危险区 ————— */}
      <Paper variant="outlined" sx={{ p: 2, mt: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
          {sl('dev.mock')}
        </Typography>

        <SettingsField labelKey="dev.mock" hintKey="dev.mockOn" featureId="PG-19">
          <Switch checked={dev.mock} onChange={(e) => patch({ dev: { mock: e.target.checked } })} />
        </SettingsField>
        <SettingsField labelKey="dev.rawLog" hintCopyKey="settings.hint.dev" featureId="FN-26">
          <Switch
            checked={dev.rawLog}
            onChange={(e) => {
              patch({ dev: { rawLog: e.target.checked } });
              setMirrorToConsole(e.target.checked);
            }}
          />
        </SettingsField>

        {/* 能力表自检（+ 一行：跳能力总览看全部 141 项） */}
        <Box sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>
              {sl('dev.capabilityAudit')}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => navigate(to.capabilities())}
              sx={{ minHeight: 44 }}
            >
              {cl('page.capabilities.title')}
            </Button>
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', mt: 0.75 }}>
            <Chip size="small" variant="outlined" label={`${sl('ui.total')} ${audit.total}`} />
            <Chip size="small" variant="outlined" label={`${sl('dev.levelFull')} ${audit.byLevel.full}`} />
            <Chip size="small" variant="outlined" label={`${sl('dev.levelPartial')} ${audit.byLevel.partial}`} />
            <Chip
              size="small"
              variant="outlined"
              label={`${sl('dev.levelAlternative')} ${audit.byLevel.alternative}`}
            />
            <Chip
              size="small"
              color="error"
              variant="outlined"
              label={`${sl('dev.levelUnavailable')} ${audit.byLevel.unavailable}`}
            />
            <Chip
              size="small"
              color={audit.missing.length > 0 ? 'error' : 'success'}
              variant="outlined"
              label={`${sl('dev.missing')} ${audit.missing.length}`}
            />
          </Stack>
          {audit.missing.length > 0 ? (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.75, fontFamily: 'monospace', opacity: 0.7 }}>
              {`${sl('dev.missing')}: ${audit.missing.join(', ')}`}
            </Typography>
          ) : null}
        </Box>

        {/* 危险区 */}
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'error.main', mb: 0.75 }}>
            {sl('ui.dangerZone')}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="outlined" color="error" onClick={() => setPendingWipe(true)} sx={{ minHeight: 44 }}>
              {sl('dev.clearStorage')}
            </Button>
            <Typography variant="caption" sx={{ opacity: 0.6, alignSelf: 'center' }}>
              {sl('hint.clearStorage')}
            </Typography>
          </Stack>
        </Box>
      </Paper>

      <ConfirmDialog
        open={pendingClearLogs}
        titleKey="confirm.clearLogs"
        confirmKey="common.clear"
        cancelKey="common.cancel"
        danger
        onConfirm={() => {
          clearLogs();
          setPendingClearLogs(false);
          snack.success('ok.deleted');
        }}
        onCancel={() => setPendingClearLogs(false)}
      />

      {/* ★ 清空本地数据用自己的 Dialog：文案 key 不在总表里，避免误用语义不符的 key */}
      <Dialog open={pendingWipe} onClose={() => setPendingWipe(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{sl('dev.clearStorage')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {sl('hint.clearStorage')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingWipe(false)} color="inherit" sx={{ minHeight: 44 }}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void handleWipe()}
            variant="contained"
            color="error"
            sx={{ minHeight: 44 }}
          >
            {sl('dev.clearStorage')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default DeveloperPage;
