import { useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import LoadingOverlay from '@/components/LoadingOverlay';
import { t } from '@/copy';
import { useSnack } from '@/hooks/useSnack';
import { useDistillStore } from '@/store/distillStore';
import { TOTAL_STEPS } from '@/distill/flow';
import { StepIntake } from './StepIntake';
import { StepSources } from './StepSources';
import { StepAnalyze } from './StepAnalyze';
import { StepPreview } from './StepPreview';
import { StepWrite } from './StepWrite';
import { dt, type DistillCopyKey } from '@/distill/copy';

/**
 * 5 步向导容器（EX-01）。
 *
 * ★ 路由里没有向导页（路由表固定 27 条，见 `router/paths.ts`），
 *   所以向导由 `DistillListPage` 在本页内切换渲染，不新增路由。
 *
 * 步骤与状态机的映射：`flow.ts` 的 STEP_OF_STATUS
 *   1 intake → 2 importing → 3 analyzing → 4 preview → 5 writing → done
 */
export interface DistillWizardPageProps {
  onExit(): void;
}

const STEP_TITLES: readonly DistillCopyKey[] = [
  'distill.intake.title',
  'distill.sources.title',
  'distill.analyze.title',
  'distill.preview.title',
  'distill.write.title',
];

export function DistillWizardPage({ onExit }: DistillWizardPageProps): JSX.Element {
  const snack = useSnack();
  const step = useDistillStore((s) => s.step);
  const busy = useDistillStore((s) => s.busy);
  const current = useDistillStore((s) => s.current);
  const goStep = useDistillStore((s) => s.goStep);
  const back = useDistillStore((s) => s.back);
  const build = useDistillStore((s) => s.build);

  const titles = useMemo(() => STEP_TITLES.map((k) => dt(k)), []);

  const goto = useCallback(
    (n: number) => {
      void goStep(n).catch(() => snack.error('err.dbFailed'));
    },
    [goStep, snack],
  );

  const handleBack = useCallback(() => {
    void back().catch(() => snack.error('err.dbFailed'));
  }, [back, snack]);

  const regenerate = useCallback(() => {
    void build().catch(() => {
      // 同 StepAnalyze：没配模型要给「先去接一个模型」，不能一律说成"我这边的问题"
      const code = useDistillStore.getState().errorCode;
      snack.error(code === 'LLM_NO_PROVIDER' ? 'err.llmNoProvider' : 'err.llmFailed');
    });
  }, [build, snack]);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {current ? current.name : dt('distill.new')}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {dt('distill.stepOf', { n: step })}
          </Typography>
        </Box>
        <Button size="small" color="inherit" onClick={onExit} disabled={busy}>
          {dt('distill.exitWizard')}
        </Button>
      </Stack>

      <Stepper activeStep={step - 1} alternativeLabel sx={{ mb: 3 }}>
        {titles.map((label, i) => (
          <Step key={label} completed={i + 1 < step}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {step === 1 ? <StepIntake onNext={() => goto(2)} /> : null}
      {step === 2 ? <StepSources onNext={() => goto(3)} onBack={handleBack} /> : null}
      {step === 3 ? (
        <StepAnalyze
          onDone={() => goto(4)}
          onBack={handleBack}
        />
      ) : null}
      {step === 4 ? (
        <StepPreview
          onConfirm={() => goto(5)}
          onBack={handleBack}
          onRegenerate={regenerate}
          onAddMore={() => goto(2)}
        />
      ) : null}
      {step === 5 ? <StepWrite onBack={handleBack} /> : null}

      {step > TOTAL_STEPS ? (
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {t('common.done')}
        </Typography>
      ) : null}

      <LoadingOverlay open={busy} textKey="loading.distilling" />
    </Paper>
  );
}

export default DistillWizardPage;
