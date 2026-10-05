import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useSnack } from '@/hooks/useSnack';
import { t } from '@/copy';
import { feedbackRepo } from '@/db/repo/feedbackRepo';
import { log } from '@/store/logStore';
import {
  FEEDBACK_KINDS,
  MAX_FEEDBACK_CONTACT_LENGTH,
  MAX_FEEDBACK_LENGTH,
  type FeedbackItem,
  type FeedbackKind,
} from '@/types/feedback';
import { collectEnv, ENV_FIELDS, envLabel, envValue } from './feedbackEnv';
import { fb, kindText } from './feedbackCopy';

/**
 * ★ 反馈提交对话框（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个对话框有一件事必须做对：**别让用户以为东西已经送出去了**
 * ═══════════════════════════════════════════════════════════════════════════
 * 常见的反馈框会在提交后显示「提交成功，感谢反馈！」然后关掉。
 * 在这个应用里那句话是**假话** —— 没有服务端，东西还在用户自己手机上。
 * ⇒ 所以本对话框的提交流程刻意分成**两步**：
 *      ① 「交上去」= 存进本机（这一步的措辞是"交上去"，不是"发送"）
 *      ② 存完后**不自动关闭**，原地出现「复制这一条 / 发出去」两个按钮，
 *         并显示 `fb.note.local` 那段说明。
 *   用户点了「发出去」才算真的交到人手上。多一步，但这步不能省。
 *
 * ── 其它几个刻意的决定 ────────────────────────────────────────────────────
 * - **类型必选、默认选中「它坏了」**：反馈里最急的是 bug，默认落在最急的一档；
 *   同时必须显式选一次（不选就默认有点强加，所以默认选中但不隐藏选择）。
 * - **环境快照可见**：不是默默收集，而是在提交前把它**原样显示给用户看**
 *   （`fb.form.envNote` + 一列真实取值）。要收集就先给他看 —— 这条比任何隐私声明都实在。
 * - **字数不静默截断**：到上限时输入框报错并提示"超了 N 字"，
 *   而不是截断后存进去（截断会让用户以为他写的都交上去了）。
 */
export interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
  /** 存成功后回调（父组件用它刷新统计）；**不用于关闭对话框** —— 见上面的两步流程 */
  onSubmitted?: (item: FeedbackItem) => void;
}

export function FeedbackDialog({ open, onClose, onSubmitted }: FeedbackDialogProps): JSX.Element {
  const snack = useSnack();
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [content, setContent] = useState<string>('');
  const [contact, setContact] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  /** 已存下的那一条：非 null 表示进入"第二步"（交出去） */
  const [saved, setSaved] = useState<FeedbackItem | null>(null);

  // ★ 每次打开都重置 —— 上次的正文留在框里会让人以为"上次没提交成功"
  useEffect(() => {
    if (open) {
      setContent('');
      setContact('');
      setSaved(null);
      setSaving(false);
    }
  }, [open]);

  // ★ 环境快照在打开时采一次（不是每次按键采），避免边打字边算；
  //   它也确实不该变 —— 用户不会在写反馈的过程中换手机。
  const env = useMemo(() => (open ? collectEnv() : null), [open]);

  const trimmed = content.trim();
  const over = Math.max(0, content.length - MAX_FEEDBACK_LENGTH);
  const tooLong = over > 0;
  const canSubmit = trimmed !== '' && !tooLong && !saving;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!canSubmit || env === null) return;
    setSaving(true);
    const res = await feedbackRepo.create({ kind, content, contact, env });
    setSaving(false);
    if (!res.ok) {
      snack.error('err.dbFailed');
      log.warn('app', '反馈写入失败', res.error.code, 'PG-17');
      return;
    }
    setSaved(res.value);
    // ★ 提示语在主表（`useSnack` 只收 `CopyKey`，域内表的 key 传不进去）。
    //   这句刻意带上了"想让我真看到，点发出去"—— 见下面那段注释里的两步流程理由。
    snack.success('ok.feedbackSaved');
    onSubmitted?.(res.value);
  }, [canSubmit, env, kind, content, contact, onSubmitted, snack]);

  const handleCopy = useCallback(async (): Promise<void> => {
    if (!saved) return;
    // 动态 import：把「分享/导出」这几个用不到的函数挪出首屏包
    const { formatFeedbackItem, shareOrCopy } = await import('./feedbackShare');
    const outcome = await shareOrCopy(formatFeedbackItem(saved), fb('fb.form.title'));
    if (outcome === 'failed') snack.error('err.feedbackCopyFailed');
    else snack.success('common.copied');
  }, [saved, snack]);

  const handleShare = useCallback(async (): Promise<void> => {
    if (!saved) return;
    const { formatFeedbackItem, shareOrCopy } = await import('./feedbackShare');
    const outcome = await shareOrCopy(formatFeedbackItem(saved), fb('fb.form.title'));
    if (outcome === 'failed') snack.error('err.feedbackShareFailed');
    else if (outcome === 'copied') snack.success('common.copied');
    // 'shared' 时不弹提示：系统分享面板本身就是反馈，再弹一个飘窗是噪音
  }, [saved, snack]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{fb('fb.form.title')}</DialogTitle>
      <DialogContent>
        {/*
          ★★ 第二步：已存下，等用户交出去。
             UI 上刻意**不显示输入框**（避免他以为还要再点一次"交上去"）。
        */}
        {saved ? (
          <Stack spacing={1.5}>
            <Alert severity="success" sx={{ py: 0.5 }}>
              {t('ok.feedbackSaved')}
            </Alert>
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.25,
                maxHeight: 220,
                overflow: 'auto',
                bgcolor: 'action.hover',
              }}
            >
              <Typography
                variant="caption"
                component="pre"
                sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', m: 0 }}
              >
                {saved.content}
              </Typography>
            </Box>
            {/* ★ 边界说明：固定可见，不折叠、不藏进帮助 */}
            <Typography variant="caption" sx={{ opacity: 0.7, lineHeight: 1.7, display: 'block' }}>
              {(fb('fb.note.local') as string).split('\n').map((line) => (
                <span key={line}>
                  {line}
                  <br />
                </span>
              ))}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Button
                variant="contained"
                size="small"
                onClick={() => void handleShare()}
                sx={{ minHeight: 40 }}
              >
                {fb('fb.action.share')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => void handleCopy()}
                sx={{ minHeight: 40 }}
              >
                {fb('fb.action.copy')}
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1.75}>
            <Typography variant="body2" sx={{ opacity: 0.75 }}>
              {fb('fb.form.desc')}
            </Typography>

            {/* —— 类型 —— */}
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.65, display: 'block', mb: 0.75 }}>
                {fb('fb.form.kindLabel')}
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={kind}
                onChange={(_e, next: FeedbackKind | null) => {
                  if (next) setKind(next);
                }}
                sx={{ flexWrap: 'wrap', gap: 0.5 }}
              >
                {FEEDBACK_KINDS.map((k) => (
                  <ToggleButton key={k} value={k} sx={{ px: 1.5, minHeight: 36 }}>
                    {kindText(k)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            {/* —— 正文 —— */}
            <TextField
              label={fb('fb.form.contentLabel')}
              placeholder={fb('fb.form.contentPlaceholder')}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              multiline
              minRows={4}
              maxRows={10}
              fullWidth
              error={tooLong}
              helperText={
                tooLong
                  ? fb('fb.form.tooLong', { over })
                  : fb('fb.form.counter', { left: MAX_FEEDBACK_LENGTH - content.length })
              }
              inputProps={{ maxLength: MAX_FEEDBACK_LENGTH * 2 }}
            />

            {/* —— 联系方式（可选）—— */}
            <TextField
              label={fb('fb.form.contactLabel')}
              placeholder={fb('fb.form.contactPlaceholder')}
              value={contact}
              onChange={(e) => setContact(e.target.value.slice(0, MAX_FEEDBACK_CONTACT_LENGTH))}
              fullWidth
              size="small"
              helperText={fb('fb.form.contactHint')}
            />

            <Divider />

            {/* —— 环境快照：**给用户看**，不是默默收集 —— */}
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.65, lineHeight: 1.7, display: 'block' }}>
                {fb('fb.form.envNote')}
              </Typography>
              {env ? (
                <Box
                  sx={{
                    mt: 0.75,
                    px: 1,
                    py: 0.75,
                    borderRadius: 1,
                    bgcolor: 'action.hover',
                    fontFamily: 'monospace',
                  }}
                >
                  {ENV_FIELDS.map((field) => {
                    const raw = env[field];
                    if (!raw) return null;
                    return (
                      <Typography
                        key={field}
                        variant="caption"
                        sx={{ display: 'block', fontFamily: 'monospace', opacity: 0.75 }}
                      >
                        {`${envLabel(field)}: ${envValue(field, raw)}`}
                      </Typography>
                    );
                  })}
                </Box>
              ) : null}
              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.55 }}>
                {fb('fb.note.noIdentity')}
              </Typography>
            </Box>

            {/*
              ★ 边界说明在**提交前**就要出现，不能等到存完才说。
                理由：用户按下「交上去」的那一瞬间，他心里的预期是"发出去了"。
                如果这句话只在第二步出现，那么他在按下去之前一直是误以为的状态 ——
                而"误以为已经发了"正是这个功能最需要避免的错觉。
                ★ 第二屏（存完之后）还会把同一段再说一遍，那是**第二次**提醒，
                  而且是动作当下那一次，两次都必要，不算重复渲染
                  （同一屏出现两遍才是 bug，见 `settingsCopy.ts` 的 `desc.group.*` 注释）。
            */}
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.7, lineHeight: 1.7, display: 'block' }}>
                {(fb('fb.note.local') as string).split('\n').map((line) => (
                  <span key={line}>
                    {line}
                    <br />
                  </span>
                ))}
              </Typography>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {saved ? (
          <Button onClick={onClose} sx={{ minHeight: 40 }}>
            {t('common.close')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose} sx={{ minHeight: 40 }}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="contained"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
              sx={{ minHeight: 40 }}
            >
              {saving ? fb('fb.form.submitting') : fb('fb.form.submit')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default FeedbackDialog;
