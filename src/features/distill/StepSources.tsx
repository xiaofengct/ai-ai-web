import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CapabilityGate from '@/components/CapabilityGate';
import FileDropZone from '@/components/FileDropZone';
import { useSnack } from '@/hooks/useSnack';
import { t } from '@/copy';
import { PARSERS, listUnavailableModes } from '@/distill/parsers/index';
import { SOCIAL_PLATFORM_LABEL } from '@/distill/parsers/social';
import type { ParseOptions, RawParser, SocialPlatform } from '@/distill/parsers/types';
import type { RawSourceKind } from '@/types/distill';
import { useDistillStore } from '@/store/distillStore';
import { dt, type DistillCopyKey } from '@/distill/copy';

/**
 * Step2 · 原材料导入（EX-02 ~ EX-07）。
 *
 * ★ 不可实现项统一走 `<CapabilityGate>`（如 `chat.db --direct`），
 *   禁止用散落的 `if (false)` 把功能藏起来（PRD §11）。
 */

const KIND_LABEL: Record<RawSourceKind, DistillCopyKey> = {
  wechat: 'distill.sources.kind.wechat',
  imessage: 'distill.sources.kind.imessage',
  sms: 'distill.sources.kind.sms',
  photo: 'distill.sources.kind.photo',
  social: 'distill.sources.kind.social',
  file: 'distill.sources.kind.file',
  paste: 'distill.sources.kind.paste',
};

const KIND_HINT: Record<RawSourceKind, DistillCopyKey> = {
  wechat: 'distill.sources.hint.wechat',
  imessage: 'distill.sources.hint.imessage',
  sms: 'distill.sources.hint.sms',
  photo: 'distill.sources.hint.photo',
  social: 'distill.sources.hint.social',
  file: 'distill.sources.hint.file',
  paste: 'distill.sources.hint.paste',
};

export interface StepSourcesProps {
  onNext(): void;
  onBack(): void;
}

export function StepSources({ onNext, onBack }: StepSourcesProps): JSX.Element {
  const snack = useSnack();
  const sources = useDistillStore((s) => s.sources);
  const addSource = useDistillStore((s) => s.addSource);
  const removeSource = useDistillStore((s) => s.removeSource);
  const busy = useDistillStore((s) => s.busy);
  const current = useDistillStore((s) => s.current);

  const [target, setTarget] = useState<string>(current?.name ?? '');
  const [pasteText, setPasteText] = useState<string>('');
  const [platform, setPlatform] = useState<SocialPlatform>('auto');

  const unavailableModes = useMemo(() => listUnavailableModes(), []);
  const fileParsers = useMemo(() => PARSERS.filter((p) => p.kind !== 'paste'), []);

  const opts = (): ParseOptions => ({ target: target.trim() || undefined });

  const handleFiles = async (parser: RawParser, files: File[]): Promise<void> => {
    try {
      const n = await addSource(
        parser.kind,
        parser.multi ? { files, platform } : { file: files[0], platform },
        opts(),
      );
      if (n > 0) snack.success('ok.imported');
      else snack.warn('err.parseFail');
    } catch {
      snack.error('err.parseFail');
    }
  };

  const handlePaste = async (): Promise<void> => {
    if (!pasteText.trim()) {
      snack.warn('err.parseFail');
      return;
    }
    try {
      const n = await addSource('paste', { text: pasteText }, opts());
      if (n > 0) {
        snack.success('ok.imported');
        setPasteText('');
      } else {
        snack.warn('err.parseFail');
      }
    } catch {
      snack.error('err.parseFail');
    }
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {dt('distill.sources.title')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.5 }}>
          {dt('distill.sources.desc')}
        </Typography>
      </Box>

      {/* 目标过滤：只保留她说的那部分（ex-skill 的 --target） */}
      <TextField
        label={dt('distill.sources.target')}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        helperText={dt('distill.sources.targetHint')}
        size="small"
        fullWidth
      />

      {/* A~E：文件类原材料 */}
      {fileParsers.map((parser) => (
        <Paper key={parser.kind} variant="outlined" sx={{ p: 2 }}>
          <CapabilityGate featureId={parser.featureId}>
            <Box sx={{ width: '100%' }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {dt(KIND_LABEL[parser.kind])}
                </Typography>
                <Chip size="small" variant="outlined" label={parser.accept.join(' / ')} />
              </Stack>
              <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mb: 1.25 }}>
                {dt(KIND_HINT[parser.kind])}
              </Typography>

              {parser.kind === 'social' ? (
                <TextField
                  select
                  size="small"
                  label={dt('distill.sources.platform')}
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
                  sx={{ minWidth: 180, mb: 1.25 }}
                >
                  {(Object.keys(SOCIAL_PLATFORM_LABEL) as SocialPlatform[]).map((p) => (
                    <MenuItem key={p} value={p}>
                      {SOCIAL_PLATFORM_LABEL[p]}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}

              <FileDropZone
                acceptExt={parser.accept}
                multiple={parser.multi === true}
                disabled={busy || !parser.available()}
                onFiles={(files) => void handleFiles(parser, files)}
                onError={() => snack.error('err.parseUnsupported')}
              />
            </Box>
          </CapabilityGate>
        </Paper>
      ))}

      {/* F：直接粘贴 */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <CapabilityGate featureId="EX-07">
          <Box sx={{ width: '100%' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.75 }}>
              {dt('distill.sources.kind.paste')}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mb: 1.25 }}>
              {dt('distill.sources.hint.paste')}
            </Typography>
            <TextField
              multiline
              minRows={5}
              fullWidth
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={dt('distill.sources.pastePlaceholder')}
            />
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.25 }}>
              <Button
                variant="outlined"
                size="small"
                disabled={busy || !pasteText.trim()}
                onClick={() => void handlePaste()}
              >
                {t('common.add')}
              </Button>
            </Stack>
          </Box>
        </CapabilityGate>
      </Paper>

      {/* ★ 不可实现模式清单：逐条置灰 + 原因（EX-03 的 chat.db --direct 在这里） */}
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
          {dt('distill.sources.unavailable')}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.65, display: 'block', mb: 1 }}>
          {dt('distill.sources.unavailableHint')}
        </Typography>
        <Stack spacing={1}>
          {unavailableModes.map((mode) => (
            <CapabilityGate key={mode.id} featureId={mode.featureId}>
              {/* ★ PRD §11：不可实现项必须「逐条置灰 + 给出原因」，禁止静默缺失。
                  之前这里只渲染了 `mode.label`，`reason` / `altKey` 两个字段
                  是**零消费**的死数据（与 `parsers/types.ts` 的注释要求不符）。 */}
              <Box>
                <Button size="small" variant="outlined" disabled>
                  {mode.label}
                </Button>
                <Typography variant="caption" sx={{ opacity: 0.75, display: 'block', mt: 0.5 }}>
                  {mode.reason}
                </Typography>
                {mode.altKey ? (
                  <Typography variant="caption" sx={{ opacity: 0.6, display: 'block' }}>
                    {`${dt('distill.sources.altPrefix')}：${t(mode.altKey)}`}
                  </Typography>
                ) : null}
              </Box>
            </CapabilityGate>
          ))}
        </Stack>
      </Box>

      <Divider />

      {/* 已导入清单 */}
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {dt('distill.sources.added', { name: '已导入', n: sources.length })}
        </Typography>
        {sources.length === 0 ? (
          <Alert severity="info" variant="outlined">
            {dt('distill.sources.desc')}
          </Alert>
        ) : (
          <Stack spacing={0.75}>
            {sources.map((s, i) => (
              <Stack key={s.id} direction="row" alignItems="center" spacing={1}>
                <Chip size="small" label={dt(KIND_LABEL[s.kind])} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>
                  {s.fileName ?? s.kind}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  {dt('distill.sources.chunks', { n: s.chunkCount })}
                </Typography>
                <Button size="small" color="inherit" onClick={() => removeSource(i)}>
                  {dt('distill.sources.remove')}
                </Button>
              </Stack>
            ))}
          </Stack>
        )}
      </Box>

      <Stack direction="row" justifyContent="space-between">
        <Button onClick={onBack}>{t('common.prev')}</Button>
        <Stack direction="row" spacing={1}>
          <Button onClick={onNext}>{dt('distill.sources.skip')}</Button>
          <Button variant="contained" onClick={onNext}>
            {t('common.next')}
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}

export default StepSources;
