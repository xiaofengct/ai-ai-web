import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useSnack } from '@/hooks/useSnack';
import { t } from '@/copy';
import { hasUsableProvider, useDistillStore } from '@/store/distillStore';
import type { CostEstimate } from '@/distill/pipeline';
import { BATCH_CHARS, MAX_VERSIONS } from '@/constants/limits';
import { dt } from '@/distill/copy';

/**
 * Step3 · 双线分析（EX-08 / C6）。
 *
 * ★★ 成本预估弹窗是硬要求：
 *   「分批调用 LLM 前先算字符数 / 预估 token → 弹窗展示 → 用户确认后才发请求」。
 *   这里是防止用户误烧额度的关键闸门，任何路径都不能跳过。
 */
export interface StepAnalyzeProps {
  onDone(): void;
  onBack(): void;
}

export function StepAnalyze({ onDone, onBack }: StepAnalyzeProps): JSX.Element {
  const snack = useSnack();
  const chunks = useDistillStore((s) => s.chunks);
  const busy = useDistillStore((s) => s.busy);
  const progress = useDistillStore((s) => s.progress);
  const progressLabel = useDistillStore((s) => s.progressLabel);
  const estimate = useDistillStore((s) => s.estimate);
  const analyze = useDistillStore((s) => s.analyze);

  const [cost, setCost] = useState<CostEstimate | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 进入本步就先算一次成本（只算不请求）
  useEffect(() => {
    if (chunks.length > 0) setCost(estimate());
  }, [chunks.length, estimate]);

  const noMaterial = chunks.length === 0;

  const start = async (): Promise<void> => {
    // ★ 判据是「有没有可用的 Provider/Key」，不是「适配器有没有注入」：
    //   `main.tsx` 必然注入适配器，用后者当守卫会让"没配 Key"被说成"服务故障"。
    if (!hasUsableProvider()) {
      snack.error('err.llmNoProvider');
      return;
    }
    // ★ 没有原材料时不弹成本框（不调 LLM，只生成骨架）
    if (noMaterial) {
      await run();
      return;
    }
    const c = estimate();
    setCost(c);
    setConfirmOpen(true);
  };

  const run = async (): Promise<void> => {
    try {
      await analyze();
      // ★ 没有原材料时不能说「我在看她说过的话」——这条路径一次 LLM 都没调
      if (!noMaterial) snack.info('loading.distilling');
      onDone();
    } catch {
      // 没配模型要给「先去接一个模型」，不能一律说成"我这边的问题"
      const code = useDistillStore.getState().errorCode;
      snack.error(code === 'LLM_NO_PROVIDER' ? 'err.llmNoProvider' : 'err.llmFailed');
    }
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {dt('distill.analyze.title')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.5 }}>
          {dt('distill.analyze.desc')}
        </Typography>
      </Box>

      {noMaterial ? (
        <Alert severity="info" variant="outlined">
          {dt('distill.analyze.noMaterial')}
        </Alert>
      ) : (
        <Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <ChipLike label={dt('distill.analyze.chars', { n: cost?.chars ?? 0 })} />
            <ChipLike label={dt('distill.analyze.batches', { n: cost?.batches ?? 0 })} />
            <ChipLike label={dt('distill.analyze.calls', { n: cost?.calls ?? 0 })} />
            <ChipLike label={dt('distill.analyze.tokens', { n: cost?.totalTokens ?? 0 })} />
          </Stack>
          <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mt: 1 }}>
            {dt('distill.analyze.model', { name: cost?.modelLabel ?? '（未选择）' })} · 分批 {BATCH_CHARS} 字
          </Typography>
        </Box>
      )}

      {busy ? (
        <Box>
          <LinearProgress variant="determinate" value={Math.round(progress * 100)} />
          <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 0.75 }}>
            {progressLabel ?? dt('distill.analyze.progress', { done: 0, total: cost?.batches ?? 0 })}
          </Typography>
        </Box>
      ) : null}

      <Stack direction="row" justifyContent="space-between">
        <Button onClick={onBack} disabled={busy}>
          {t('common.prev')}
        </Button>
        <Button variant="contained" disabled={busy} onClick={() => void start()}>
          {dt('distill.analyze.start')}
        </Button>
      </Stack>

      {/* ★ 成本预估确认弹窗：确认后才真正发请求 */}
      <ConfirmDialog
        open={confirmOpen}
        titleKey="confirm.distillCost"
        maxWidth="sm"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void run();
        }}
      >
        {cost ? (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {[
                dt('distill.analyze.chars', { n: cost.chars }),
                dt('distill.analyze.batches', { n: cost.batches }),
                dt('distill.analyze.calls', { n: cost.calls }),
                dt('distill.analyze.tokens', { n: cost.totalTokens }),
                dt('distill.analyze.model', { name: cost.modelLabel }),
              ].join('\n')}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.65, display: 'block', mt: 1 }}>
              {dt('distill.versions.max', { n: MAX_VERSIONS })}
            </Typography>
          </Box>
        ) : null}
      </ConfirmDialog>
    </Stack>
  );
}

function ChipLike({ label }: { label: string }): JSX.Element {
  return (
    <Box
      sx={{
        px: 1.25,
        py: 0.35,
        borderRadius: 10,
        border: '1px solid',
        borderColor: 'divider',
        fontSize: 12.5,
        opacity: 0.9,
      }}
    >
      {label}
    </Box>
  );
}

export default StepAnalyze;
