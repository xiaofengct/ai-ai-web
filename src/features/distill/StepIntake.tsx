import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { useDistillStore } from '@/store/distillStore';
import {
  ATTACHMENT_TYPES,
  LOVE_TAGS,
  buildIntakeSummary,
  parseIntake,
  slugifyName,
} from '@/distill/prompts/index';
import { t } from '@/copy';
import { dt } from '@/distill/copy';
import { useSnack } from '@/hooks/useSnack';
import { toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';

/**
 * Step1 · 基础信息录入（EX-01 / intake.md）。
 *
 * 只问 3 个问题：昵称（必填）+ 基本信息 + 性格画像，后两个可跳过。
 * 解析走 `prompts/intake.ts` 的本地规则（**不调 LLM**，省 token）。
 */
export interface StepIntakeProps {
  onNext(): void;
}

export function StepIntake({ onNext }: StepIntakeProps): JSX.Element {
  const snack = useSnack();
  const draft = useDistillStore((s) => s.draft);
  const setDraft = useDistillStore((s) => s.setDraft);
  const submitIntake = useDistillStore((s) => s.submitIntake);
  const errorCode = useDistillStore((s) => s.errorCode);

  const parsed = useMemo(
    () => parseIntake({ name: draft.name, basic: draft.basic, personality: draft.personality }),
    [draft.name, draft.basic, draft.personality],
  );

  const slug = draft.slug || slugifyName(draft.name);
  const nameMissing = draft.name.trim().length === 0;

  const summary = useMemo(
    () =>
      buildIntakeSummary({
        name: draft.name || '（未填）',
        profile: parsed.profile,
        tags: parsed.tags,
        impression: parsed.impression,
        zodiac: parsed.zodiac,
      }),
    [draft.name, parsed],
  );

  /**
   * ★ 提交必须**把失败讲出来**（真 bug，2026-10-04 QA 回归发现）：
   *   原实现是 `await submitIntake(); onNext();`，任一步 reject 都会被 `void submit()`
   *   吞成 unhandled rejection —— 表现是「下一步点了没反应、也不报错」，用户卡死在 Step1。
   *   典型触发：新建的称呼与已有作业同名（slug 撞 unique 索引）。
   *   slug 去重已在 `distillJobRepo.resolveUniqueSlug()` 修掉，这里补上「万一还失败要说一声」。
   */
  const submit = async (): Promise<void> => {
    if (nameMissing) {
      setDraft({ name: draft.name });
      return;
    }
    try {
      await submitIntake();
    } catch (e) {
      log.warn('distill', '基础信息提交失败', toAppError(e), 'EX-01');
      snack.error('err.dbFailed');
      return;
    }
    onNext();
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {dt('distill.intake.title')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.5 }}>
          {dt('distill.intake.desc')}
        </Typography>
      </Box>

      <TextField
        label={dt('distill.intake.q1')}
        value={draft.name}
        onChange={(e) => setDraft({ name: e.target.value, slug: slugifyName(e.target.value) })}
        helperText={dt('distill.intake.q1Hint')}
        error={nameMissing && errorCode === 'IMPORT_INVALID'}
        fullWidth
        required
      />

      <TextField
        label={dt('distill.intake.q2')}
        value={draft.basic}
        onChange={(e) => setDraft({ basic: e.target.value })}
        helperText={dt('distill.intake.q2Hint')}
        multiline
        minRows={2}
        fullWidth
      />

      <TextField
        label={dt('distill.intake.q3')}
        value={draft.personality}
        onChange={(e) => setDraft({ personality: e.target.value })}
        helperText={dt('distill.intake.q3Hint')}
        multiline
        minRows={2}
        fullWidth
      />

      {/* 标签识别结果：让用户一眼看到「我读出了什么」，不对可以改原文 */}
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {dt('distill.intake.tags')}
        </Typography>
        {parsed.tags.personality.length === 0 && !parsed.tags.attachment ? (
          <Typography variant="body2" sx={{ opacity: 0.6 }}>
            {dt('distill.intake.noTags')}
          </Typography>
        ) : (
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            {parsed.tags.personality.map((tag) => (
              <Chip key={tag} size="small" label={tag} />
            ))}
            {parsed.tags.attachment ? (
              <Chip size="small" color="primary" variant="outlined" label={parsed.tags.attachment} />
            ) : null}
          </Stack>
        )}

        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 2, mb: 1 }}>
          {dt('distill.intake.attachment')}
        </Typography>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
          {ATTACHMENT_TYPES.map((a) => (
            <Chip
              key={a}
              size="small"
              variant={parsed.tags.attachment === a ? 'filled' : 'outlined'}
              color={parsed.tags.attachment === a ? 'primary' : 'default'}
              label={a}
              onClick={() => {
                // 手动覆盖：写回 personality 字段，让解析结果稳定
                const rest = draft.personality.replace(parsed.tags.attachment ?? '', '').trim();
                setDraft({ personality: `${rest} ${a}`.trim() });
              }}
            />
          ))}
        </Stack>

        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 2, mb: 1 }}>
          {dt('distill.intake.advanced')}
        </Typography>
        {LOVE_TAGS.map((group) => (
          <Box key={group.group} sx={{ mb: 1 }}>
            <Typography variant="caption" sx={{ opacity: 0.65 }}>
              {group.group}
            </Typography>
            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
              {group.tags.map((tag) => {
                const on = parsed.tags.personality.includes(tag);
                return (
                  <Chip
                    key={tag}
                    size="small"
                    variant={on ? 'filled' : 'outlined'}
                    color={on ? 'primary' : 'default'}
                    label={tag}
                    onClick={() => {
                      const next = on
                        ? draft.personality.replace(tag, ' ').replace(/\s+/g, ' ').trim()
                        : `${draft.personality} ${tag}`.trim();
                      setDraft({ personality: next });
                    }}
                  />
                );
              })}
            </Stack>
          </Box>
        ))}
      </Box>

      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {dt('distill.intake.summary')}
        </Typography>
        <Typography
          variant="body2"
          component="pre"
          sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', opacity: 0.85, mt: 0.5, mb: 0 }}
        >
          {summary}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.55 }}>
          {dt('distill.intake.slugPreview', { slug: slug || 'ex' })}
        </Typography>
      </Box>

      {nameMissing && errorCode === 'IMPORT_INVALID' ? (
        <Typography variant="body2" color="error">
          {dt('distill.intake.nameRequired')}
        </Typography>
      ) : null}

      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" disabled={nameMissing} onClick={() => void submit()}>
          {t('common.next')}
        </Button>
      </Stack>
    </Stack>
  );
}

export default StepIntake;
