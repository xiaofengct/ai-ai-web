import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { CapabilityGate } from '@/components/CapabilityGate';
import { personaRepo } from '@/db/repo/personaRepo';
import { sessionRepo } from '@/db/repo/sessionRepo';
import { MAX_TIME_KEY, MIN_TIME_KEY, messageRepo } from '@/db/repo/messageRepo';
import { memorySummarizer } from '@/memory/summarizer';
import { upsertMemories } from '@/memory/dedupe';
import { usePersonaStore } from '@/store/personaStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSnack } from '@/hooks/useSnack';
import { toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { t, type CopyKey } from '@/copy';
import { ml, mlv, type MemoryTextKey } from './memoryCopy';
import type { ChatSession, Message } from '@/types/chat';
import type { PersonaCard } from '@/types/persona';
import type { SummaryRange } from '@/types/memory';
import type { UUID } from '@/types/common';

/**
 * ★ 总结范围选择（PG-11 / FN-48）。
 *
 * 四种模式：
 * - `time`   按发生时间挑一段；
 * - `count`  取最近 N 条；
 * - `anchor` 用户指定起止两条消息（锚点）；
 * - `all`    整段都算。
 *
 * 落库走 `memory/dedupe.upsertMemories()`：**先去重再写入**，
 * 避免「同一段反复总结 → 记忆翻倍」（FN-57）。
 */

export interface SummaryScopeDialogProps {
  open: boolean;
  onClose: () => void;
  /** 由调用方指定会话；不传则由用户在弹窗里选 */
  sessionId?: UUID;
  /** 总结完成后刷新调用方列表 */
  onDone?: (added: number, merged: number) => void;
}

type ScopeMode = SummaryRange['mode'];

const MODE_KEYS: Readonly<Record<ScopeMode, MemoryTextKey>> = {
  time: 'mode.time',
  count: 'mode.count',
  anchor: 'mode.anchor',
  all: 'mode.all',
};

const MODES: readonly ScopeMode[] = ['time', 'count', 'anchor', 'all'];

/** ISO → `datetime-local` 输入框格式（本地时区） */
function toLocalInput(iso: string | undefined, fallback: Date): string {
  const parsed = iso ? new Date(iso) : undefined;
  const d = parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function SummaryScopeDialog({
  open,
  onClose,
  sessionId,
  onDone,
}: SummaryScopeDialogProps): JSX.Element {
  const snack = useSnack();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [targetSessionId, setTargetSessionId] = useState<string>(sessionId ?? '');
  const [mode, setMode] = useState<ScopeMode>('count');
  const [from, setFrom] = useState<string>(() => toLocalInput(undefined, new Date(Date.now() - 7 * 864e5)));
  const [to, setTo] = useState<string>(() => toLocalInput(undefined, new Date()));
  const [count, setCount] = useState<number>(40);
  const [anchorStart, setAnchorStart] = useState<string>('');
  const [anchorEnd, setAnchorEnd] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState<boolean>(false);

  // 打开时拉取会话列表
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const res = await sessionRepo.listRecent({ limit: 200 });
      const list = res.ok ? res.value : [];
      setSessions(list);
      if (!sessionId && list[0]) setTargetSessionId((prev) => prev || list[0]!.id);
    })();
  }, [open, sessionId]);

  useEffect(() => {
    if (sessionId) setTargetSessionId(sessionId);
  }, [sessionId]);

  // 选中会话后拉它的消息（锚点模式要用整段做下标定位）
  useEffect(() => {
    if (!open || !targetSessionId) return;
    void (async () => {
      const res = await messageRepo.range(targetSessionId, MIN_TIME_KEY, MAX_TIME_KEY, 5000);
      setMessages(res.ok ? res.value : []);
      setAnchorStart('');
      setAnchorEnd('');
    })();
  }, [open, targetSessionId]);

  /** 当前模式下的实际消息集合 */
  const selected = useMemo<Message[]>(() => {
    if (messages.length === 0) return [];
    switch (mode) {
      case 'all':
        return messages;
      case 'count':
        return messages.slice(Math.max(0, messages.length - Math.max(1, count)));
      case 'time': {
        const f = fromLocalInput(from);
        const t = fromLocalInput(to);
        return messages.filter((m) => (!f || m.createdAt >= f) && (!t || m.createdAt <= t));
      }
      case 'anchor': {
        const startIdx = messages.findIndex((m) => m.id === anchorStart);
        const endIdx = messages.findIndex((m) => m.id === anchorEnd);
        if (startIdx === -1 && endIdx === -1) return messages;
        const fromIdx = startIdx === -1 ? 0 : startIdx;
        const toIdx = endIdx === -1 ? messages.length - 1 : endIdx;
        return messages.slice(Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx) + 1);
      }
      default:
        return messages;
    }
  }, [anchorEnd, anchorStart, count, from, messages, mode, to]);

  const buildRange = useCallback((): SummaryRange => {
    switch (mode) {
      case 'time':
        return { mode: 'time', from: fromLocalInput(from), to: fromLocalInput(to) };
      case 'count':
        return { mode: 'count', count: Math.max(1, count) };
      case 'anchor':
        return { mode: 'anchor', anchorStartId: anchorStart || undefined, anchorEndId: anchorEnd || undefined };
      default:
        return { mode: 'all' };
    }
  }, [anchorEnd, anchorStart, count, from, mode, to]);

  const handleSummarize = useCallback(async (): Promise<void> => {
    if (selected.length === 0) {
      snack.info('common.done');
      return;
    }
    setBusy(true);
    try {
      // 角色优先取会话自己的，其次当前角色，最后回落到欣然
      const session = sessions.find((s) => s.id === targetSessionId);
      // 角色优先取会话自己的，其次当前角色（store 里已保证回落到欣然）
      const own = session ? await personaRepo.get(session.personaId) : undefined;
      const fromSession = own && own.ok ? own.value : undefined;
      const persona: PersonaCard | undefined = fromSession ?? usePersonaStore.getState().current();
      if (!persona) {
        snack.error('err.dbFailed');
        return;
      }

      const settings = useSettingsStore.getState().effectiveChat(session?.settingsOverride);
      const entries = await memorySummarizer.summarize({
        persona,
        messages: selected,
        range: buildRange(),
        settings,
      });

      // ★ 去重后再落库：相似条目合并，不新增重复记忆（FN-57）
      const result = await upsertMemories(entries, { sessionId: targetSessionId, personaId: persona.id });
      snack.success('ok.memorySaved');
      log.info('memory', 'summary saved', result, 'FN-48');
      onDone?.(result.added, result.merged);
      onClose();
    } catch (e) {
      const err = toAppError(e, 'UNKNOWN');
      const key: CopyKey = err.code === 'PARSE_FAIL' ? 'err.parseFail' : err.code.startsWith('LLM') ? 'err.llmFailed' : 'err.unknown';
      snack.error(key);
      log.warn('memory', 'summarize failed', err, 'FN-48');
    } finally {
      setBusy(false);
    }
  }, [buildRange, onClose, onDone, selected, sessions, snack, targetSessionId]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{ml('label.summaryTitle')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ opacity: 0.8, mb: 2, whiteSpace: 'pre-wrap' }}>
          {ml('label.summaryDesc')}
        </Typography>

        {/* 选哪段对话 */}
        <FormControl fullWidth size="small" disabled={busy || Boolean(sessionId)} sx={{ mb: 2 }}>
          <InputLabel id="summary-session-label">{ml('label.summarySession')}</InputLabel>
          <Select
            labelId="summary-session-label"
            label={ml('label.summarySession')}
            value={targetSessionId}
            onChange={(e) => setTargetSessionId(String(e.target.value))}
          >
            {sessions.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.title || t('session.unnamed')}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* 四种模式（PG-11） */}
        <Typography variant="caption" sx={{ opacity: 0.7 }}>
          {ml('label.summaryMode')}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          onChange={(_, next: ScopeMode | null) => {
            if (next) setMode(next);
          }}
          sx={{ mt: 0.5, mb: 1.5, flexWrap: 'wrap' }}
        >
          {MODES.map((m) => (
            <ToggleButton key={m} value={m} sx={{ minHeight: 44, px: 1.5 }}>
              {ml(MODE_KEYS[m])}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {mode === 'time' ? (
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
            <TextField
              label={ml('label.summaryFrom')}
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 200 }}
            />
            <TextField
              label={ml('label.summaryTo')}
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 200 }}
            />
          </Stack>
        ) : null}

        {mode === 'count' ? (
          <TextField
            label={ml('label.summaryCount')}
            type="number"
            value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
            size="small"
            sx={{ minWidth: 160 }}
          />
        ) : null}

        {mode === 'anchor' ? (
          <Stack spacing={1.5}>
            <FormControl fullWidth size="small">
              <InputLabel id="anchor-start-label">{ml('label.summaryAnchorStart')}</InputLabel>
              <Select
                labelId="anchor-start-label"
                label={ml('label.summaryAnchorStart')}
                value={anchorStart}
                onChange={(e) => setAnchorStart(String(e.target.value))}
              >
                {messages.map((m, i) => (
                  <MenuItem key={m.id} value={m.id}>
                    {`#${i + 1} ${m.content.slice(0, 24)}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id="anchor-end-label">{ml('label.summaryAnchorEnd')}</InputLabel>
              <Select
                labelId="anchor-end-label"
                label={ml('label.summaryAnchorEnd')}
                value={anchorEnd}
                onChange={(e) => setAnchorEnd(String(e.target.value))}
              >
                {messages.map((m, i) => (
                  <MenuItem key={m.id} value={m.id}>
                    {`#${i + 1} ${m.content.slice(0, 24)}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        ) : null}

        <Typography variant="caption" sx={{ display: 'block', mt: 1.5, opacity: 0.7, whiteSpace: 'pre-wrap' }}>
          {ml('hint.summaryMode')}
        </Typography>

        {messages.length === 0 ? (
          <Alert severity="info" variant="outlined" sx={{ mt: 1.5 }}>
            {ml('label.summaryNoMessage')}
          </Alert>
        ) : (
          <Typography variant="caption" sx={{ display: 'block', mt: 1.5, opacity: 0.8 }}>
            {mlv('label.memoryCount', { n: selected.length })}
          </Typography>
        )}
      </DialogContent>

      <DialogActions>
        {busy ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
        <Button onClick={onClose} color="inherit" sx={{ minHeight: 44 }} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <CapabilityGate featureId="FN-48">
          <Button
            variant="contained"
            onClick={() => void handleSummarize()}
            disabled={busy || selected.length === 0}
            sx={{ minHeight: 44 }}
          >
            {ml('label.summaryStart')}
          </Button>
        </CapabilityGate>
      </DialogActions>
    </Dialog>
  );
}

export default SummaryScopeDialog;
