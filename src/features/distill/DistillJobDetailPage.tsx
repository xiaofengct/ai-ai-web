import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadingOverlay from '@/components/LoadingOverlay';
import { t } from '@/copy';
import { useSnack } from '@/hooks/useSnack';
import { useParams, useNavigate } from 'react-router-dom';
import { to } from '@/router/paths';
import { downloadBlob } from '@/lib/download';
import { useDistillStore } from '@/store/distillStore';
import { exportFileName } from '@/distill/artifactWriter';
import { ArtifactPreview } from './ArtifactPreview';
import { VersionHistory } from './VersionHistory';
import { CorrectionEditor } from './CorrectionEditor';
import { SUMMARY_MAX_LINES, summarizeMd } from './StepPreview';
import { dt } from '@/distill/copy';
import type { CorrectionRecord } from '@/distill/prompts/correction';

/**
 * 蒸馏作业详情（EX-09 / EX-10）：产物预览 + 版本回滚 + 对话纠正 + 导出 zip + 转角色卡。
 *
 * ★ 导出 zip 还原 `exes/{slug}/` 目录结构（决策 A4 / C3），与 ex-skill 原产物双向兼容。
 */
export function DistillJobDetailPage(): JSX.Element {
  const { jobId = '' } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const snack = useSnack();

  const job = useDistillStore((s) => s.current);
  const artifact = useDistillStore((s) => s.artifact);
  const versions = useDistillStore((s) => s.versions);
  const corrections = useDistillStore((s) => s.corrections);
  const busy = useDistillStore((s) => s.busy);

  const openJob = useDistillStore((s) => s.openJob);
  const exportJobZip = useDistillStore((s) => s.exportJobZip);
  const exportJobJson = useDistillStore((s) => s.exportJobJson);
  const exportJobPng = useDistillStore((s) => s.exportJobPng);
  const jsonFileNameOf = useDistillStore((s) => s.jsonFileNameOf);
  const pngFileNameOf = useDistillStore((s) => s.pngFileNameOf);
  const removeJob = useDistillStore((s) => s.removeJob);
  const toPersonaCard = useDistillStore((s) => s.toPersonaCard);
  const applyCorrectionText = useDistillStore((s) => s.applyCorrectionText);
  const editCorrection = useDistillStore((s) => s.editCorrection);
  const removeCorrection = useDistillStore((s) => s.removeCorrection);

  const [utterance, setUtterance] = useState<string>('');
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  /** 正在编辑的纠正条目下标（undefined = 未打开编辑器） */
  const [editingIndex, setEditingIndex] = useState<number | undefined>(undefined);
  /** 待删除的纠正条目下标 */
  const [removingIndex, setRemovingIndex] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (jobId) void openJob(jobId);
  }, [jobId, openJob]);

  const onExport = useCallback(async () => {
    try {
      const blob = await exportJobZip(jobId);
      downloadBlob(blob, job ? exportFileName(job) : `exes-${jobId}.zip`);
      snack.success('ok.exported');
    } catch {
      snack.error('err.dbFailed');
    }
  }, [exportJobZip, job, jobId, snack]);

  /**
   * 导出 JSON：结构化快照，**能再导入回来**（`artifactTransfer.importArtifactFile`）。
   * 与 zip 的区别：zip 还原 `exes/{slug}/` 目录（给 ex-skill 生态用），
   * JSON 是给本应用自己看的单文件（含版本快照）。
   */
  const onExportJson = useCallback(async () => {
    try {
      const blob = await exportJobJson(jobId);
      downloadBlob(blob, job ? jsonFileNameOf(job) : `exes-${jobId}.json`);
      snack.success('ok.exported');
    } catch {
      snack.error('err.dbFailed');
    }
  }, [exportJobJson, job, jobId, jsonFileNameOf, snack]);

  /**
   * 导出 PNG 长图：canvas 自绘（项目内无现成图片导出工具，未引入第三方库）。
   * 只画共同记忆 + 人物性格两段，太长会截断并在图上注明。
   */
  const onExportPng = useCallback(async () => {
    try {
      const blob = await exportJobPng(jobId);
      downloadBlob(blob, job ? pngFileNameOf(job) : `exes-${jobId}.png`);
      snack.success('ok.exported');
    } catch {
      snack.error('err.dbFailed');
    }
  }, [exportJobPng, job, jobId, pngFileNameOf, snack]);

  const onDelete = useCallback(async () => {
    try {
      await removeJob(jobId);
      snack.success('ok.deleted');
      navigate(to.distill());
    } catch {
      snack.error('err.dbFailed');
    } finally {
      setDeleteOpen(false);
    }
  }, [jobId, navigate, removeJob, snack]);

  const onToCard = useCallback(async () => {
    try {
      await toPersonaCard(jobId);
      snack.success('ok.saved');
    } catch {
      snack.error('err.dbFailed');
    }
  }, [jobId, snack, toPersonaCard]);

  const onCorrect = useCallback(async () => {
    if (!utterance.trim()) {
      snack.warn('err.parseFail');
      return;
    }
    try {
      await applyCorrectionText(utterance);
      snack.success('ok.saved');
      setUtterance('');
    } catch {
      snack.error('err.llmFailed');
    }
  }, [applyCorrectionText, snack, utterance]);

  const onEditCorrection = useCallback(
    async (patch: Partial<Omit<CorrectionRecord, 'target'>>): Promise<void> => {
      if (editingIndex === undefined) return;
      try {
        await editCorrection(editingIndex, patch);
        snack.success('ok.saved');
      } catch {
        snack.error('err.dbFailed');
      } finally {
        setEditingIndex(undefined);
      }
    },
    [editingIndex, editCorrection, snack],
  );

  const onRemoveCorrection = useCallback(async (): Promise<void> => {
    if (removingIndex === undefined) return;
    try {
      await removeCorrection(removingIndex);
      snack.success('ok.deleted');
    } catch {
      snack.error('err.dbFailed');
    } finally {
      setRemovingIndex(undefined);
    }
  }, [removeCorrection, removingIndex, snack]);

  if (!job) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {t('loading.default')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1000, mx: 'auto' }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" useFlexGap flexWrap="wrap">
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {job.name}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              exes/{job.slug}/ · {dt('distill.version', { v: job.version })} ·{' '}
              {dt('distill.sourcesCount', { n: job.sources.length })}
              {job.correctionsCount > 0 ? ` · ${dt('distill.corrections', { n: job.correctionsCount })}` : ''}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button size="small" onClick={() => navigate(to.distill())}>
              {dt('distill.detail.back')}
            </Button>
            <Button size="small" variant="outlined" disabled={busy || !artifact} onClick={() => void onExport()}>
              {dt('distill.detail.export')}
            </Button>
            <Button size="small" variant="outlined" disabled={busy || !artifact} onClick={() => void onExportJson()}>
              {dt('distill.detail.exportJson')}
            </Button>
            <Button size="small" variant="outlined" disabled={busy || !artifact} onClick={() => void onExportPng()}>
              {dt('distill.detail.exportPng')}
            </Button>
            <Button size="small" variant="outlined" disabled={busy || !artifact} onClick={() => void onToCard()}>
              {dt('distill.detail.personaCard')}
            </Button>
            <Button size="small" color="error" disabled={busy} onClick={() => setDeleteOpen(true)}>
              {dt('distill.detail.delete')}
            </Button>
          </Stack>
        </Stack>

        {artifact?.personaCardId ? (
          <Alert severity="info" variant="outlined">
            {dt('distill.detail.personaCardHint')}
          </Alert>
        ) : null}

        {!artifact ? (
          <Alert severity="warning" variant="outlined">
            {dt('distill.detail.noArtifact')}
          </Alert>
        ) : (
          <>
            <ArtifactPreview artifact={artifact} job={job} />
            <Alert severity="info" variant="outlined" icon={false}>
              {dt('distill.detail.noImageNote')}
            </Alert>
          </>
        )}

        <VersionHistory versions={versions} currentVersion={job.version} />

        {/* ——— 对话纠正（EX-10）——— */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
            {dt('distill.correction.title')}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mb: 1.25 }}>
            {dt('distill.correction.desc')}
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={2}
            value={utterance}
            onChange={(e) => setUtterance(e.target.value)}
            placeholder={dt('distill.correction.utterance')}
          />
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.25 }}>
            <Button variant="contained" size="small" disabled={busy || !artifact} onClick={() => void onCorrect()}>
              {dt('distill.correction.apply')}
            </Button>
          </Stack>

          <Divider sx={{ my: 2 }} />

          {corrections.length === 0 ? (
            <Typography variant="body2" sx={{ opacity: 0.7 }}>
              {dt('distill.correction.empty')}
            </Typography>
          ) : (
            <Stack spacing={0.75}>
              {corrections.map((c, i) => (
                <Stack key={`${c.scene}-${i}`} direction="row" spacing={1} alignItems="center">
                  <Chip size="small" variant="outlined" label={c.target === 'memories' ? 'memories' : 'persona'} />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {dt('distill.correction.scene')}：{c.scene} · {dt('distill.correction.wrong')} {c.wrong} ·{' '}
                    {dt('distill.correction.correct')} {c.correct}
                  </Typography>
                  {/* ★ 单条编辑 / 删除：改完或删完都会重写 Correction 节并升版本 */}
                  <Button size="small" variant="text" disabled={busy} onClick={() => setEditingIndex(i)}>
                    {dt('distill.correction.edit')}
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    color="error"
                    disabled={busy}
                    onClick={() => setRemovingIndex(i)}
                  >
                    {dt('distill.correction.delete')}
                  </Button>
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>

        {/* ——— 产物速览（折叠式摘要，和 Step4 同一套摘要逻辑）——— */}
        {artifact ? (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>
              {dt('distill.preview.memories')}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {summarizeMd(artifact.memoriesMd, SUMMARY_MAX_LINES).map((line, i) => (
                <li key={`m-${i}`}>
                  <Typography variant="body2" sx={{ opacity: 0.85 }}>
                    {line}
                  </Typography>
                </li>
              ))}
            </Box>
          </Paper>
        ) : null}
      </Stack>

      <ConfirmDialog
        open={deleteOpen}
        titleKey="confirm.deleteDistill"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void onDelete()}
      />

      {/* —— 单条纠正的编辑弹窗 —— */}
      <CorrectionEditor
        open={editingIndex !== undefined}
        record={editingIndex !== undefined ? corrections[editingIndex] : undefined}
        onCancel={() => setEditingIndex(undefined)}
        onSave={(patch) => void onEditCorrection(patch)}
      />

      {/* —— 单条纠正的删除确认 —— */}
      <ConfirmDialog
        open={removingIndex !== undefined}
        titleKey="confirm.deleteCorrection"
        danger
        onCancel={() => setRemovingIndex(undefined)}
        onConfirm={() => void onRemoveCorrection()}
      >
        <Typography variant="body2" sx={{ opacity: 0.8 }}>
          {dt('distill.correction.deleteHint')}
        </Typography>
      </ConfirmDialog>

      <LoadingOverlay open={busy} textKey="loading.distilling" />
    </Box>
  );
}

export default DistillJobDetailPage;
