import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import { dt } from '@/distill/copy';
import type { CorrectionRecord } from '@/distill/prompts/correction';

/**
 * 单条纠正记录的编辑弹窗（EX-10「记忆修订」的单条编辑入口）。
 *
 * ★ 为什么 `target`（归属 memories / persona）不可改：
 *   改归属等于「把这条从记忆文件搬到人格文件」——
 *   那是**删除一条 + 新增一条**，不是编辑。真要换归属，请删了重加，
 *   语义上才对得上（也避免下标错位）。
 *
 * ★ 三个字段都必填：`formatCorrection` 渲染出来是
 *   `- [场景：X] 不应该 Y，应该 Z`，缺任何一个都会生成一条残缺的规则。
 */

export interface CorrectionEditorProps {
  open: boolean;
  /** 被编辑的记录；为 undefined 时不渲染内容 */
  record?: CorrectionRecord;
  onCancel: () => void;
  onSave: (patch: Partial<Omit<CorrectionRecord, 'target'>>) => void;
}

export function CorrectionEditor({
  open,
  record,
  onCancel,
  onSave,
}: CorrectionEditorProps): JSX.Element {
  const [scene, setScene] = useState('');
  const [wrong, setWrong] = useState('');
  const [correct, setCorrect] = useState('');

  // 每次打开都重新灌入被编辑条目的值（否则会残留上一条的内容）
  useEffect(() => {
    if (!open || !record) return;
    setScene(record.scene);
    setWrong(record.wrong);
    setCorrect(record.correct);
  }, [open, record]);

  const valid = scene.trim().length > 0 && wrong.trim().length > 0 && correct.trim().length > 0;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{dt('distill.correction.editTitle')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          <TextField
            label={dt('distill.correction.scene')}
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label={dt('distill.correction.wrong')}
            value={wrong}
            onChange={(e) => setWrong(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
          <TextField
            label={dt('distill.correction.correct')}
            value={correct}
            onChange={(e) => setCorrect(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onCancel}>
          {dt('distill.detail.back')}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!valid}
          onClick={() => onSave({ scene: scene.trim(), wrong: wrong.trim(), correct: correct.trim() })}
        >
          {dt('distill.correction.apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default CorrectionEditor;
