import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { t } from '@/copy';
import { useSnack } from '@/hooks/useSnack';
import { useDistillStore } from '@/store/distillStore';
import { MAX_VERSIONS } from '@/constants/limits';
import { to } from '@/router/paths';
import { useNavigate } from 'react-router-dom';
import { dt } from '@/distill/copy';

/**
 * Step5 · 写入产物（EX-09）。
 *
 * 产物：memories.md / persona.md / meta.json / SKILL.md + versions/v1 快照。
 * 写完可直接转成角色卡（XR-08，默认 privacy.noImage = true）。
 */
export interface StepWriteProps {
  onBack(): void;
}

export function StepWrite({ onBack }: StepWriteProps): JSX.Element {
  const snack = useSnack();
  const navigate = useNavigate();
  const busy = useDistillStore((s) => s.busy);
  const progress = useDistillStore((s) => s.progress);
  const confirmWrite = useDistillStore((s) => s.confirmWrite);
  const toPersonaCard = useDistillStore((s) => s.toPersonaCard);
  const current = useDistillStore((s) => s.current);
  const artifact = useDistillStore((s) => s.artifact);
  const chunks = useDistillStore((s) => s.chunks);

  const [done, setDone] = useState<boolean>(Boolean(artifact));

  /**
   * ★ 没有原材料时不得宣称「我记得她说话的样子」（`ok.distillDone`）。
   *   这条路径上 `runAnalysis` / `runBuild` 一次 LLM 都没调，产物只是骨架模板；
   *   用 `ok.distillDone` 等于把没发生的事说成发生了，违反「不编造共同回忆」的红线。
   */
  const noMaterial = chunks.length === 0;

  const run = async (): Promise<void> => {
    try {
      await confirmWrite();
      setDone(true);
      // 有原材料才说「看完了、记住了」；没有就只报写入完成，骨架的事实由下方 Alert 说明
      if (!noMaterial) snack.success('ok.distillDone');
    } catch {
      snack.error('err.dbFailed');
    }
  };

  const convert = async (): Promise<void> => {
    if (!current) return;
    try {
      await toPersonaCard(current.id);
      snack.success('ok.saved');
    } catch {
      snack.error('err.dbFailed');
    }
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {dt('distill.write.title')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.5 }}>
          {dt('distill.write.desc')}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mt: 0.75 }}>
          {dt('distill.versions.max', { n: MAX_VERSIONS })}
        </Typography>
      </Box>

      {busy ? (
        <Box>
          <LinearProgress variant="determinate" value={Math.round(progress * 100)} />
          <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 0.75 }}>
            {dt('distill.write.writing')}
          </Typography>
        </Box>
      ) : null}

      {done && noMaterial ? (
        <Alert severity="warning" variant="outlined">
          {dt('distill.write.skeletonDone')}
        </Alert>
      ) : null}

      {done && !noMaterial ? (
        <Alert severity="success" variant="outlined">
          {dt('distill.write.done')}
        </Alert>
      ) : null}

      <Stack direction="row" justifyContent="space-between" useFlexGap flexWrap="wrap" spacing={1}>
        <Button onClick={onBack} disabled={busy}>
          {t('common.prev')}
        </Button>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {!done ? (
            <Button variant="contained" disabled={busy} onClick={() => void run()}>
              {dt('distill.write.go')}
            </Button>
          ) : (
            <>
              <Button variant="outlined" onClick={() => void convert()} disabled={busy || !current}>
                {dt('distill.write.toCard')}
              </Button>
              <Button
                variant="contained"
                onClick={() => {
                  if (current) navigate(to.distillJob(current.id));
                }}
              >
                {dt('distill.write.openDetail')}
              </Button>
            </>
          )}
        </Stack>
      </Stack>

      {done ? (
        <Typography variant="caption" sx={{ opacity: 0.65 }}>
          {dt('distill.write.versionsNote')}
        </Typography>
      ) : null}
    </Stack>
  );
}

export default StepWrite;
