import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import EmptyState from '@/components/EmptyState';
import { t } from '@/copy';
import { useSnack } from '@/hooks/useSnack';
import { useDistillStore } from '@/store/distillStore';
import { to } from '@/router/paths';
import { useNavigate } from 'react-router-dom';
import { formatRelative } from '@/lib/time';
import { DistillWizardPage } from './DistillWizardPage';
import { dt, type DistillCopyKey } from '@/distill/copy';
import type { DistillStatus } from '@/types/distill';

/**
 * 蒸馏作业列表（EX-01 入口）。
 *
 * ★ 向导没有独立路由，所以在本页内切换：
 *   `wizardOpen === true` → 渲染 DistillWizardPage，否则渲染列表。
 */

const STATUS_KEY: Record<DistillStatus, DistillCopyKey> = {
  intake: 'distill.status.intake',
  importing: 'distill.status.importing',
  analyzing: 'distill.status.analyzing',
  preview: 'distill.status.preview',
  writing: 'distill.status.writing',
  done: 'distill.status.done',
  failed: 'distill.status.failed',
};

export function DistillListPage(): JSX.Element {
  const navigate = useNavigate();
  const snack = useSnack();
  const jobs = useDistillStore((s) => s.jobs);
  const wizardOpen = useDistillStore((s) => s.wizardOpen);
  const reload = useDistillStore((s) => s.reload);
  const startNew = useDistillStore((s) => s.startNew);
  const openJob = useDistillStore((s) => s.openJob);
  const closeWizard = useDistillStore((s) => s.closeWizard);
  const importArtifact = useDistillStore((s) => s.importArtifact);

  /** 隐藏的文件选择框（产物导入入口，.json / .zip） */
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<boolean>(false);

  useEffect(() => {
    void reload();
  }, [reload]);

  const open = (id: string): void => {
    void openJob(id).then(() => navigate(to.distillJob(id)));
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // 清空 value，否则连续选同一个文件不会再触发 change
    e.target.value = '';
    if (!file) return;
    void (async () => {
      setImporting(true);
      try {
        const result = await importArtifact(file);
        snack.success('ok.imported');
        await openJob(result.jobId);
        navigate(to.distillJob(result.jobId));
      } catch {
        snack.error('err.importInvalid');
      } finally {
        setImporting(false);
      }
    })();
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 960, mx: 'auto' }}>
      {wizardOpen ? (
        <DistillWizardPage onExit={closeWizard} />
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {dt('distill.title')}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.25 }}>
                {dt('distill.subtitle')}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} useFlexGap>
              <Button variant="outlined" disabled={importing} onClick={() => fileRef.current?.click()}>
                {dt('distill.import.title')}
              </Button>
              <Button variant="contained" onClick={startNew}>
                {dt('distill.new')}
              </Button>
            </Stack>
            {/* 产物导入：只收 .json / .zip，内部按内容识别，不靠后缀判断格式 */}
            <input
              ref={fileRef}
              type="file"
              accept=".json,.zip,application/json,application/zip"
              hidden
              onChange={onPickFile}
            />
          </Stack>

          {jobs.length === 0 ? (
            <EmptyState descKey="empty.distillJobs" actionKey="action.newDistill" onAction={startNew} />
          ) : (
            <Stack spacing={1.25}>
              {jobs.map((job) => (
                <Paper
                  key={job.id}
                  variant="outlined"
                  sx={{ p: 2, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                  onClick={() => open(job.id)}
                >
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {job.name}
                    </Typography>
                    <Chip
                      size="small"
                      color={job.status === 'done' ? 'success' : job.status === 'failed' ? 'error' : 'default'}
                      variant={job.status === 'done' ? 'filled' : 'outlined'}
                      label={dt(STATUS_KEY[job.status])}
                    />
                    <Chip size="small" variant="outlined" label={dt('distill.version', { v: job.version })} />
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                      {dt('distill.lastUpdated', { at: formatRelative(job.updatedAt) })}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    {dt('distill.sourcesCount', { n: job.sources.length })}
                    {job.correctionsCount > 0
                      ? ` · ${dt('distill.corrections', { n: job.correctionsCount })}`
                      : ''}
                    {` · exes/${job.slug}/`}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Button
                      size="small"
                      variant="text"
                      onClick={(e) => {
                        e.stopPropagation();
                        open(job.id);
                      }}
                    >
                      {job.status === 'done' ? t('common.open') : dt('distill.continue')}
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </Box>
  );
}

export default DistillListPage;
