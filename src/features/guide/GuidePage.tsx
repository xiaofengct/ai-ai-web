import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import HubIcon from '@mui/icons-material/HubOutlined';
import ChatIcon from '@mui/icons-material/ChatBubbleOutline';
import FaceIcon from '@mui/icons-material/FaceRetouchingNaturalOutlined';
import ModelIcon from '@mui/icons-material/MemoryOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline';
import { PersonaRail } from '@/features/home/PersonaRail';
import { markGuideDone, useHasProvider } from '@/router/RouteGuards';
import { sessionRepo } from '@/db/repo/sessionRepo';
import { usePersonaStore } from '@/store/personaStore';
import { useUiStore } from '@/store/uiStore';
import { useSnack } from '@/hooks/useSnack';
import { to } from '@/router/paths';
import { t, XINRAN_GREETINGS, type CopyKey } from '@/copy';
import { BUILTIN_XINRAN } from '@/constants/buildMode';
import { log } from '@/store/logStore';

/**
 * 首次启动引导（PG-07，4 步状态机）。
 *
 * 步骤（PRD §宣讲 §5 功能清单）：接入模型 → 导入/选择人设 → 认识欣然 → 开始聊天。
 * 走完第 4 步才写 `ai-ai.guide.v1` 标记（写标记后 `RequireGuide` 不再拦截），
 * 并回到用户原本想去的页面（守卫把来源路径塞在 `location.state.from`）。
 *
 * ★ 每一步的内容都尽量复用已有页面的分支：
 *   第 2 步复用角色轨，第 1 步直接跳连接测试页 —— 不重复实现一遍配置表单。
 */

interface GuideStep {
  id: 'model' | 'persona' | 'xinran' | 'chat';
  labelKey: CopyKey;
  icon: ReactElement;
}

const STEPS: readonly GuideStep[] = [
  { id: 'model', labelKey: 'guide.step1', icon: <ModelIcon fontSize="small" /> },
  {
    id: 'persona',
    // 不内置版没有"我"可认识 ⇒ 用指向动作的中性标题
    labelKey: BUILTIN_XINRAN ? 'guide.step2' : 'guide.step2Solo',
    icon: <FaceIcon fontSize="small" />,
  },
  // ★ 第 3 步「认识欣然」是**内置版专属**：它展示的是欣然的欢迎语与隐私红线，
  //   不内置版里这一切都不存在（没有角色可"认识"）⇒ 整步剔除。
  //   ⇒ 内置版 4 步、不内置版 3 步；`TOTAL_STEPS` 与进度条都跟着 `STEPS.length` 走，无需另外改。
  ...(BUILTIN_XINRAN
    ? [
        {
          id: 'xinran' as const,
          labelKey: 'guide.step3' as const,
          icon: <HubIcon fontSize="small" />,
        },
      ]
    : []),
  { id: 'chat', labelKey: 'guide.step4', icon: <ChatIcon fontSize="small" /> },
];

const TOTAL_STEPS = STEPS.length;

export default function GuidePage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const snack = useSnack();
  const hasProvider = useHasProvider();

  const personas = usePersonaStore((s) => s.personas);
  const currentPersonaId = usePersonaStore((s) => s.currentId);
  /** 列表读完了没有 —— 用于区分「还没读完」与「读完了确实没有」（见 PersonaRail 的 loading） */
  const personasHydrated = usePersonaStore((s) => s.hydrated);
  const selectPersona = usePersonaStore((s) => s.select);
  const setCurrentPersona = useUiStore((s) => s.setCurrentPersona);
  const setCurrentSession = useUiStore((s) => s.setCurrentSession);

  const [index, setIndex] = useState<number>(0);
  const [creating, setCreating] = useState<boolean>(false);

  // ★ 这里原有一句裸 `void reloadPersonas()`，已删除：`App.tsx` 才是人设列表的
  //   唯一加载点（它等 `bootstrap()` 落库完成再读），本页再读一次会与它抢 Dexie 事务，
  //   抢输就读到空列表。详见 `src/store/personaStore.ts` 里 `hydrated` 的说明。

  const step = STEPS[index] ?? STEPS[0];

  /** 守卫把用户原本要去的路径放在 state.from；没有就回首页 */
  const targetAfterDone = useMemo<string>(() => {
    const state = location.state as { from?: string } | null;
    const from = state?.from;
    return typeof from === 'string' && from.startsWith('/') && from !== to.guide()
      ? from
      : to.home();
  }, [location.state]);

  /** 第 4 步：建一个会话，直接开始聊 */
  const handleStartChat = useCallback(async (): Promise<void> => {
    const personaId = currentPersonaId ?? personas[0]?.id;
    // ★ 原为 `if (!personaId) return;`（静默返回）：不内置版若第 2 步没导入角色，
    //   点「开始吧」会毫无反应。改为明确告知（同 NewSessionDialog 的处理）。
    if (!personaId) {
      snack.error('err.noPersonaToChat');
      return;
    }

    setCreating(true);
    const res = await sessionRepo.create({
      title: personas.find((p) => p.id === personaId)?.data.name ?? t('nav.chat'),
      personaId,
      proactive: { enabled: false, inheritFromPrev: true },
    });
    setCreating(false);

    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }

    // ★ 写「已看过引导」的标记，之后 RequireGuide 不再拦截
    markGuideDone();
    setCurrentSession(res.value.id);
    setCurrentPersona(personaId);
    log.info('guide', 'guide finished', { from: targetAfterDone }, 'PG-07');

    snack.success('tip.guideDone');
    navigate(to.chat(res.value.id));
  }, [
    currentPersonaId,
    personas,
    navigate,
    snack,
    setCurrentPersona,
    setCurrentSession,
    targetAfterDone,
  ]);

  /** 直接完成（用户就是想跳过，不想新建会话）：同样写标记 */
  const finishWithoutSession = useCallback((): void => {
    markGuideDone();
    snack.success('tip.guideDone');
    navigate(targetAfterDone, { replace: true });
  }, [navigate, snack, targetAfterDone]);

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        bgcolor: 'background.default',
      }}
    >
      <Paper
        variant="outlined"
        sx={{ width: '100%', maxWidth: 560, p: { xs: 2, md: 3 }, borderRadius: 3 }}
      >
        <Stack spacing={2}>
          {/* ——— 进度 ——— */}
          <Stack direction="row" spacing={1} alignItems="center">
            {step.icon}
            <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 600 }} noWrap>
              {t(step.labelKey)}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>
              {`${index + 1} / ${TOTAL_STEPS}`}
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={((index + 1) / TOTAL_STEPS) * 100}
            sx={{ height: 6, borderRadius: 999 }}
          />

          {/* ——— 步骤内容 ——— */}
          <Box sx={{ minHeight: 200 }}>
            {step.id === 'model' ? (
              <Stack spacing={1.5}>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {t('settings.hint.baseUrl')}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {t('settings.hint.apiKey')}
                </Typography>
                {hasProvider ? (
                  <Alert severity="success" variant="outlined" icon={<CheckCircleIcon fontSize="small" />}>
                    {t('ok.connectionOk')}
                  </Alert>
                ) : (
                  <Alert severity="warning" variant="outlined">
                    {t('tip.providerMissing')}
                  </Alert>
                )}
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => navigate(to.settingsConnection())}
                  sx={{ alignSelf: 'flex-start', minHeight: 44 }}
                >
                  {t('settings.group.model')}
                </Button>
              </Stack>
            ) : null}

            {step.id === 'persona' ? (
              <Stack spacing={1.5}>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {/* 同 PersonaRail 的分流理由：不内置版「一个人都没有」，
                      沿用「只有我一个」会变成假话。
                      ★ 外加一道 `personasHydrated` 门闩：读库尚未完成时 `personas` 也是空的，
                        此时说「只有我一个」同样是假话（欣然就在库里，只是还没读回来）。 */}
                  {personasHydrated ? t(BUILTIN_XINRAN ? 'empty.personas' : 'empty.personasSolo') : ''}
                </Typography>
                <PersonaRail
                  personas={personas}
                  currentId={currentPersonaId}
                  loading={!personasHydrated}
                  onPick={(card) => {
                    selectPersona(card.id);
                    setCurrentPersona(card.id);
                  }}
                />
              </Stack>
            ) : null}

            {step.id === 'xinran' ? (
              <Stack spacing={1.5}>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {t('app.subtitle')}
                </Typography>
                {/* 欣然的欢迎语之一（XR-04：首次进入随机取一） */}
                <Paper
                  variant="outlined"
                  sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover', fontSize: 14 }}
                >
                  {XINRAN_GREETINGS[Math.floor(Math.random() * XINRAN_GREETINGS.length)]}
                </Paper>
                {/* ★ 隐私红线（XR-06）：提前说清楚，不藏着 */}
                <Alert severity="info" variant="outlined">
                  {t('tip.privacyNoImage')}
                </Alert>
              </Stack>
            ) : null}

            {step.id === 'chat' ? (
              <Stack spacing={1.5}>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {t('tip.guideDone')}
                </Typography>
                {!hasProvider ? (
                  <Alert severity="warning" variant="outlined">
                    {t('err.llmNoProvider')}
                  </Alert>
                ) : null}
                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                  {t('settings.hint.proactiveInterval')}
                </Typography>
              </Stack>
            ) : null}
          </Box>

          {/* ——— 前进/后退 ——— */}
          <Stack direction="row" spacing={1} justifyContent="space-between">
            <Button
              variant="text"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              sx={{ minHeight: 44 }}
            >
              {t('common.prev')}
            </Button>

            <Stack direction="row" spacing={1}>
              {index < TOTAL_STEPS - 1 ? (
                <Button
                  variant="contained"
                  onClick={() => setIndex((i) => Math.min(TOTAL_STEPS - 1, i + 1))}
                  sx={{ minHeight: 44 }}
                >
                  {t('common.next')}
                </Button>
              ) : (
                <>
                  <Button variant="text" onClick={finishWithoutSession} sx={{ minHeight: 44 }}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="contained"
                    disabled={creating || personas.length === 0}
                    onClick={() => void handleStartChat()}
                    sx={{ minHeight: 44 }}
                  >
                    {t('common.done')}
                  </Button>
                </>
              )}
            </Stack>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
