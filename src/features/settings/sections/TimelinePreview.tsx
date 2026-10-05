import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { momentRepo } from '@/db/repo/momentRepo';
import { useSettingsStore } from '@/store/settingsStore';
import { evaluateMomentGate, MOMENT_BLOCK_TEXT, summarizeRecentMoments } from '@/proactive/momentGate';
import { activeWorldPack } from '@/world/activeWorld';
import { usePersonaStore } from '@/store/personaStore';
import { sl, slv } from '../settingsCopy';
import type { Moment } from '@/types/moment';

/**
 * ★★ 「现在会不会发、下次大概什么时候」预览（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么要做这个（这是本页最有价值的一块）
 * ═══════════════════════════════════════════════════════════════════════════
 * 动态发布有**七道闸门**（见 `proactive/momentGate.ts`）。用户调完间隔与上限之后，
 * 只有一个问题：**"那现在到底会不会发？"**
 *
 * 不回答这个问题，用户唯一的验证方式就是"等一小时看看"——
 * 而如果是因为"她的作息不在活跃时段"被拦了，等一天也等不到，
 * 用户只会得出"这功能坏了"的结论。
 *
 * ⇒ 直接把闸门的判定结果**翻译成人话**摆在这里：
 *   · 现在能发 → "现在可以发，今天还能发 N 条"
 *   · 被拦了 → **具体是被哪一关拦的**（也是人话）
 * 这样"调旋钮"与"看效果"之间就没有延迟了。
 *
 * ★ 这里调的是**同一个** `evaluateMomentGate()`（不是另写一套判断）——
 *   预览与真实行为用同一个函数，才不会出现"预览说能发、实际不发"。
 *   这是本项目反复强调的原则：**判定只有一个入口**。
 *
 * ★ 用的也是**同一个** rng 缺失状态（不传 rng ⇒ 概率门按真实随机）——
 *   所以"世界概率门没过"这一条每次刷新都可能不同，
 *   这是**如实反映**（它本来就是随机的），不是 bug。
 *   文案里对这种情况会说明"这次掷骰子没过，再刷新试试"。
 */
export function TimelinePreview(): JSX.Element {
  const chat = useSettingsStore((s) => s.settings.chat);
  const personas = usePersonaStore((s) => s.personas);
  const currentId = usePersonaStore((s) => s.currentId);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<{
    allowed: boolean;
    reason: string;
    remainingToday: number;
    waitMinutes?: number;
    todayCount: number;
    lastAt?: string;
    shift?: string | null;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      const res = await momentRepo.listRecent(20);
      if (!alive) return;
      const moments: Moment[] = res.ok ? res.value : [];
      const { todayCount, minutesSinceLast } = summarizeRecentMoments(moments);
      const card = personas.find((p) => p.id === currentId) ?? personas[0];
      const gate = evaluateMomentGate({
        chat,
        ...(card?.id ? { personaId: card.id } : {}),
        ...(minutesSinceLast !== undefined ? { minutesSinceLast } : {}),
        todayCount,
        world: activeWorldPack(),
      });
      const last = moments.find((x) => x.authorKind === 'persona');
      setState({
        allowed: gate.allowed,
        reason: gate.reason,
        remainingToday: gate.remainingToday,
        ...(gate.waitMinutes !== undefined ? { waitMinutes: gate.waitMinutes } : {}),
        todayCount,
        ...(last ? { lastAt: last.createdAt } : {}),
        shift: gate.shift ?? null,
      });
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // ★ 依赖里带上 `chat.moments`：用户一改旋钮，预览立刻重算 ——
    //   这正是这个组件存在的意义（"调完立刻看到效果"）。
  }, [chat, chat.moments, personas, currentId]);

  if (loading) {
    return (
      <Stack alignItems="center" sx={{ py: 2 }}>
        <CircularProgress size={18} />
      </Stack>
    );
  }
  if (!state) return <Typography variant="caption">—</Typography>;

  const lines: string[] = [];
  lines.push(slv('ui.momentsToday', { count: state.todayCount }));
  if (state.allowed) {
    lines.push(slv('ui.momentsCanPost', { n: state.remainingToday }));
  } else {
    lines.push(slv('ui.momentsBlocked', { why: MOMENT_BLOCK_TEXT[state.reason as keyof typeof MOMENT_BLOCK_TEXT] ?? state.reason }));
    if (state.waitMinutes !== undefined) {
      lines.push(slv('ui.momentsWait', { min: state.waitMinutes }));
    }
  }
  if (state.shift) lines.push(slv('ui.momentsShift', { shift: state.shift }));

  return (
    <Box sx={{ pl: 1, py: 1 }}>
      {lines.map((l) => (
        <Typography key={l} variant="caption" sx={{ display: 'block', opacity: 0.72, lineHeight: 1.6 }}>
          {l}
        </Typography>
      ))}
      <Typography variant="caption" sx={{ display: 'block', opacity: 0.5, mt: 0.5 }}>
        {sl('ui.momentsPreviewRefresh')}
      </Typography>
    </Box>
  );
}

export default TimelinePreview;
