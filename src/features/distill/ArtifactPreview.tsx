import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import MarkdownView from '@/components/MarkdownView';
import { t } from '@/copy';
import { useSnack } from '@/hooks/useSnack';
import { copyText, downloadText } from '@/lib/download';
import type { DistillJob, ExSkillArtifact } from '@/types/distill';
import { dt, type DistillCopyKey } from '@/distill/copy';

/**
 * 产物预览（EX-09）：4 个 Tab —— memories.md / persona.md / SKILL.md / meta.json。
 * 与 ex-skill 的 `exes/{slug}/` 四个文件一一对应，可直接复制 / 下载。
 */

const TAB_KEYS: readonly DistillCopyKey[] = [
  'distill.detail.tab.memories',
  'distill.detail.tab.persona',
  'distill.detail.tab.skill',
  'distill.detail.tab.meta',
];

export interface ArtifactPreviewProps {
  artifact: ExSkillArtifact;
  job: DistillJob;
}

export function ArtifactPreview({ artifact, job }: ArtifactPreviewProps): JSX.Element {
  const snack = useSnack();
  const [tab, setTab] = useState<number>(0);

  const contents: readonly string[] = [
    artifact.memoriesMd,
    artifact.personaMd,
    artifact.skillMd,
    artifact.metaJson,
  ];
  const fileNames: readonly string[] = ['memories.md', 'persona.md', 'SKILL.md', 'meta.json'];
  const content = contents[tab] ?? '';

  const onCopy = async (): Promise<void> => {
    const okDone = await copyText(content);
    snack.show(okDone ? 'common.copied' : 'err.unknown');
  };

  return (
    <Paper variant="outlined">
      <Tabs
        value={tab}
        onChange={(_, v: number) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        {TAB_KEYS.map((k) => (
          <Tab key={k} label={dt(k)} />
        ))}
      </Tabs>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, pt: 1.25 }}>
        <Typography variant="caption" sx={{ opacity: 0.6, fontFamily: 'monospace' }}>
          exes/{job.slug}/{fileNames[tab]}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => void onCopy()}>
            {dt('distill.detail.copy')}
          </Button>
          <Button size="small" onClick={() => downloadText(content, fileNames[tab])}>
            {dt('distill.detail.download')}
          </Button>
        </Stack>
      </Stack>

      <Box sx={{ p: 2, maxHeight: 520, overflow: 'auto' }}>
        {tab === 3 ? (
          <Typography
            component="pre"
            variant="body2"
            sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', m: 0 }}
          >
            {content}
          </Typography>
        ) : content ? (
          <MarkdownView content={content} enabled dense={false} />
        ) : (
          <Typography variant="body2" sx={{ opacity: 0.6 }}>
            {t('ui.segmentEmpty')}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

export default ArtifactPreview;
