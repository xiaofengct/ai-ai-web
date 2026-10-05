import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { t } from '@/copy';
import { useDistillStore } from '@/store/distillStore';
import { dt } from '@/distill/copy';

/**
 * Step4 · 预览草案（各 5-8 行摘要）+ 确认。
 * 对应 ex-skill Step4 的「共同记忆摘要 / Persona 摘要 → 确认生成？还是需要调整？」
 */

/** 摘要行数上限（ex-skill 要求「各 5-8 行」） */
export const SUMMARY_MAX_LINES = 7;

/** 取前 N 个非空行作为摘要 */
export function summarizeMd(md: string, maxLines = SUMMARY_MAX_LINES): string[] {
  return md
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l !== '---')
    .slice(0, maxLines);
}

export interface StepPreviewProps {
  onConfirm(): void;
  onBack(): void;
  onRegenerate(): void;
  onAddMore(): void;
}

export function StepPreview({ onConfirm, onBack, onRegenerate, onAddMore }: StepPreviewProps): JSX.Element {
  const draftArtifact = useDistillStore((s) => s.draftArtifact);
  const busy = useDistillStore((s) => s.busy);

  const memories = summarizeMd(draftArtifact.memoriesMd);
  const persona = summarizeMd(draftArtifact.personaMd);
  const empty = memories.length === 0 && persona.length === 0;

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {dt('distill.preview.title')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.5 }}>
          {dt('distill.preview.desc')}
        </Typography>
      </Box>

      {empty ? (
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {dt('distill.preview.empty')}
        </Typography>
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>
              {dt('distill.preview.memories')}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {memories.map((line, i) => (
                <li key={`m-${i}`}>
                  <Typography variant="body2" sx={{ opacity: 0.85 }}>
                    {line}
                  </Typography>
                </li>
              ))}
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>
              {dt('distill.preview.persona')}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {persona.map((line, i) => (
                <li key={`p-${i}`}>
                  <Typography variant="body2" sx={{ opacity: 0.85 }}>
                    {line}
                  </Typography>
                </li>
              ))}
            </Box>
          </Paper>
        </>
      )}

      <Divider />

      <Stack direction="row" justifyContent="space-between" useFlexGap flexWrap="wrap" spacing={1}>
        <Stack direction="row" spacing={1}>
          <Button onClick={onBack} disabled={busy}>
            {t('common.prev')}
          </Button>
          <Button onClick={onAddMore} disabled={busy}>
            {dt('distill.preview.addMore')}
          </Button>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={onRegenerate} disabled={busy}>
            {dt('distill.preview.regenerate')}
          </Button>
          <Button variant="contained" onClick={onConfirm} disabled={busy || empty}>
            {dt('distill.preview.confirm')}
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}

export default StepPreview;
