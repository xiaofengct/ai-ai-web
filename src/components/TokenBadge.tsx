import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { estimateTokens, formatTokens } from '@/lib/token';
import { t } from '@/copy';

/**
 * token 估算徽标（上下文设置页 PG-10、开发者页 PG-19 用）。
 *
 * 估算规则：CJK 1 字 ≈ 1 token，ASCII 4 字符 ≈ 1 token（见 lib/token.ts）。
 * 超过预算时变红提示。
 */
export interface TokenBadgeProps {
  /** 直接给数字 */
  value?: number;
  /** 或给文本（内部估算） */
  text?: string;
  /** 预算上限；超过时显示告警色 */
  budget?: number;
  label?: string;
  size?: 'small' | 'medium';
}

export function TokenBadge({ value, text, budget, label, size = 'small' }: TokenBadgeProps) {
  const tokens = value ?? estimateTokens(text ?? '');
  const over = budget !== undefined && tokens > budget;

  /**
   * ★ 徽标文字 = `label`（调用方传进来的**已是文案表取值结果**，如「预算」，可为空）+ 数量。
   *
   * 原先 `tok` 后缀硬编码在 JSX 里，是 `lint:copy` A 档**唯一**残留
   * （它是英文，CJK 兜底扫描对它 100% 静默；是 E3 把 A 档判据改成"按取值方式、不看字符种类"之后才浮出来的）。
   * 现在走 `ui.tokenBadge`，文案用「tokens」，与 tooltip（`ui.tokenEstimateTip`）保持一致。
   *
   * ⚠ 诚实标注：**这里还剩一个字符串字面量——label 与数量之间的那个空格**。
   *   它是**连接符不是内容**（与同文件 `:50` 那个 `—— ` 破折号同性质），因此**已裁定不入表**，
   *   理由见 `docs/07-交付说明.md` §6.5.3；也因此把它挪出了 JSX 属性（否则 `lint:copy` 会把模板串一起报）。
   *
   * ★★ 为什么不为它建 `ui.tokenBadgeLabeled: '{label} {count} tokens'`（不要再来问一遍）：
   *   ① 加 key 就得传 `label ?? ''`——**用空串把「没有」伪装成「有但为空」**，
   *      这正是我们在 `cap.note.*` 上明确反对过的（§6.5.6）；且 5 个调用点里只有 1 个传 label，
   *      另外 4 个都得走空串分支；
   *   ② `label` 本身不是主表的东西——唯一传它的 `ContextSection.tsx:141` 传的是
   *      `sl('label.budget')`，**settings 域内表**的取值结果。让主表模板去规定域内表文案怎么摆放，
   *      是跨表耦合，比这个空格贵得多；
   *   ③ 「要不要带 label」是**分支**（调用方传不传），不是文案。
   *      真到要改语序那天（比如想写成「1.2k tokens（预算）」）再建 key——
   *      那时是**两个不同的说法**，不是「有没有前缀」。
   */
  const tokenText = t('ui.tokenBadge', { count: formatTokens(tokens) });
  const badgeLabel = label ? `${label} ${tokenText}` : tokenText;

  return (
    <Tooltip
      title={
        // ★ 两条都走文案总表（B-06 硬编码清理）。
        //   注意占位符是 {count} / {budget}，与 xinran.ts 里的写法保持一致。
        budget === undefined
          ? t('ui.tokenEstimateTip', { count: tokens })
          : `${t('ui.tokenBudgetTip', { count: tokens, budget })}${
              over ? ` —— ${t('ui.tokenOverBudget')}` : ''
            }`
      }
      arrow
    >
      <Chip
        size={size}
        label={badgeLabel}
        color={over ? 'error' : 'default'}
        variant={over ? 'filled' : 'outlined'}
        sx={{ fontFamily: 'monospace', fontSize: 12 }}
      />
    </Tooltip>
  );
}

export default TokenBadge;
