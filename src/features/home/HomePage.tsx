import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Fab from '@mui/material/Fab';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import IconButton from '@mui/material/IconButton';
import { CapabilityGate } from '@/components/CapabilityGate';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SearchBar } from '@/components/SearchBar';
import { PersonaListPage } from '@/features/persona/PersonaListPage';
import { pl } from '@/features/persona/personaCopy';
import { PersonaRail } from './PersonaRail';
import { NoPersonaGuide } from './NoPersonaGuide';
import { SessionList } from './SessionList';
import { NewSessionDialog } from './NewSessionDialog';
import { sessionRepo } from '@/db/repo/sessionRepo';
import { usePersonaStore } from '@/store/personaStore';
import { useUiStore } from '@/store/uiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSnack } from '@/hooks/useSnack';
import { to } from '@/router/paths';
import { t } from '@/copy';
import type { ChatSession } from '@/types/chat';

/**
 * 首页（PG-14 / PG-15）。
 *
 * ★ 布局切换：原生有两个 Activity（HomeActivity / HomeActivity2），
 *   网页版不重复造两个页面，用 `uiStore.homeLayout` 在同一个页面里切两套排布
 *   （这正是 PG-15 在能力表里标注 `partial` 的原因，入口用 `<CapabilityGate>` 明示）：
 *   - `v1`：搜索 → 会话列表（紧凑），角色不在首屏出现；
 *   - `v2`：搜索 → 角色横向轨 → 快捷入口网格 → 会话列表。
 *
 * 开关会**同时**写回 `settings.appearance.homeLayout`，保证「UI 快照」与「设置项」两处一致。
 */
export default function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const snack = useSnack();

  const layout = useUiStore((s) => s.homeLayout);
  const setHomeLayout = useUiStore((s) => s.setHomeLayout);
  const setCurrentSession = useUiStore((s) => s.setCurrentSession);
  const setCurrentPersona = useUiStore((s) => s.setCurrentPersona);
  const setAppearance = useSettingsStore((s) => s.setAppearance);

  const personas = usePersonaStore((s) => s.personas);
  const currentPersonaId = usePersonaStore((s) => s.currentId);
  /**
   * ★ 人设列表读完了没有（区分「还没读完」与「读完了确实没有」）。
   *
   * 本页**不再自己调 `reloadPersonas()`**：`App.tsx` 已经用
   * `bootstrap().then(() => reloadPersonas())` 做过一次**等种子落库完成**的加载，
   * 而这里原先那句裸 `void reloadPersonas()` 会与它抢同一个 Dexie 事务 ——
   * 抢输的那次读到空列表，于是**内置版首启会闪出下面那块「一个角色都没有」的引导**
   * （内置欣然卡明明在，只是还没读出来）。这属于典型的「两处都在读，其中一处漏了等」。
   * ⇒ 加载归 `App.tsx` 一处负责；本页只**消费**状态，并用 `hydrated` 判断能否下结论。
   */
  const personasHydrated = usePersonaStore((s) => s.hydrated);
  const selectPersona = usePersonaStore((s) => s.select);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [keyword, setKeyword] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null);
  /** 人设管理（T10）：27 条路由里没有独立人设页，这里用全屏弹窗形态打开 */
  const [personaOpen, setPersonaOpen] = useState<boolean>(false);

  /** 载入会话（最近活跃优先） */
  const load = useCallback(async () => {
    setLoading(true);
    const res = await sessionRepo.listRecent({ includeArchived: false });
    if (!res.ok) {
      snack.error('err.dbFailed');
      setSessions([]);
    } else {
      setSessions(res.value);
    }
    setLoading(false);
  }, [snack]);

  useEffect(() => {
    void load();
    // 人设列表的加载**不在这里**（见上方 personasHydrated 的说明）：
    // 裸调 reload() 会与 App.tsx 里「等 bootstrap 完成」的那次抢 Dexie 事务。
  }, [load]);

  /** 会话列表过滤：标题 + 预览 + 角色名 */
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (kw === '') return sessions;
    return sessions.filter((s) => {
      const personaName = personas.find((p) => p.id === s.personaId)?.data.name ?? '';
      return (
        s.title.toLowerCase().includes(kw) ||
        (s.lastMessagePreview ?? '').toLowerCase().includes(kw) ||
        personaName.toLowerCase().includes(kw)
      );
    });
  }, [sessions, keyword, personas]);

  const personaNameOf = useCallback(
    (personaId: string): string => personas.find((p) => p.id === personaId)?.data.name ?? '',
    [personas],
  );

  const handleOpen = useCallback(
    (session: ChatSession): void => {
      setCurrentSession(session.id);
      navigate(to.chat(session.id));
    },
    [navigate, setCurrentSession],
  );

  const handleDelete = useCallback((session: ChatSession): void => {
    setPendingDelete(session);
  }, []);

  /** 归档（PG-14）：会话不删除，只移出首页列表（可再次去归档区找回） */
  const handleArchive = useCallback(
    async (session: ChatSession): Promise<void> => {
      const res = await sessionRepo.setArchived(session.id, true);
      if (!res.ok) {
        snack.error('err.dbFailed');
        return;
      }
      await load();
      snack.success('ok.saved');
    },
    [load, snack],
  );

  const confirmDelete = useCallback(async (): Promise<void> => {
    if (!pendingDelete) return;
    const res = await sessionRepo.removeWithMessages(pendingDelete.id);
    setPendingDelete(null);
    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }
    await load();
    snack.success('ok.deleted');
  }, [pendingDelete, load, snack]);

  /** 布局切换：UI 快照与设置项同步（PG-15 的 Web 表达方式） */
  const handleLayout = useCallback(
    (_event: unknown, next: 'v1' | 'v2' | null): void => {
      if (next !== 'v1' && next !== 'v2') return;
      setHomeLayout(next);
      setAppearance({ homeLayout: next });
    },
    [setHomeLayout, setAppearance],
  );

  const handlePickPersona = useCallback(
    (personaId: string): void => {
      selectPersona(personaId);
      setCurrentPersona(personaId);
    },
    [selectPersona, setCurrentPersona],
  );

  // ★ 「一个角色都没有」→ 整页换成引导（**不内置欣然版**首启会走到）。
  //   内置版**不可达**：`bootstrap()` 保证内置欣然卡恒在，且 `personaRepo` 禁删内置卡。
  //   之所以整页替换而不是原地放空态：此状态下角色轨 / 会话列表 / 快捷入口会同时
  //   渲染出**三条各说各话的空态**（「只有我一个」/「想说什么就直说」/…），
  //   用户看不出该先做哪一步（见 NoPersonaGuide 头部注释）。
  //   ★ 用 early return 而不是包一层 `<>`：原有 100+ 行渲染逻辑**一个字符都不用动**，
  //     缩进也不需要重排——改动面最小。
  //   ★ 注意：`PersonaListPage`（人设管理/导入弹窗）**必须一起渲染**，
  //     否则引导块上的「导入人设」按钮点了没反应。
  //
  //   ★★ 判据里**不能**再用 `!loading`（2026-10-04 修正，由"种子失败路径"验证发现）：
  //     `loading` 是**会话列表**的加载态，却曾被当作"初始加载完成"的粗略代理
  //     （那是 `hydrated` 出现之前的写法）。两者是**并行、互不同步**的两条链路，
  //     于是存在一个窗口：`hydrated` 已为 true 且 `personas` 确实为空，
  //     但 `loading` 仍为 true ⇒ 引导块不渲染 ⇒ 走到下面正常首页 ⇒
  //     角色轨按空列表渲染出**错误的**「只有我一个」（库里一个角色都没有，哪来的"我一个"）。
  //     实测（内置版 + 破坏 IndexedDB 模拟播种失败）：该窗口稳定复现。
  //     ⇒ 用 `personasHydrated` 作唯一判据：角色列表一读定，就立刻能给结论。
  //       它与会话加载无关，也不会造成闪烁（读库未完成时 `hydrated` 为 false）。
  if (personasHydrated && personas.length === 0) {
    return (
      <Box sx={{ width: '100%', maxWidth: 960, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
        <NoPersonaGuide onImportPersona={() => setPersonaOpen(true)} />
        <PersonaListPage open={personaOpen} onClose={() => setPersonaOpen(false)} />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: 960, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      {/* ——— 操作区：布局切换 / 搜索 / 新建 ——— */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.25}
        alignItems={{ xs: 'stretch', sm: 'center' }}
      >
        <SearchBar value={keyword} onChange={setKeyword} placeholder={t('common.search')} />

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          {/* PG-15 = partial：入口保留，但把「只是换了布局形态」这件事明说 */}
          <CapabilityGate featureId="PG-15">
            <Tooltip title={t('settings.hint.homeLayout')} arrow>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={layout}
                onChange={handleLayout}
                sx={{ height: 44 }}
              >
                <ToggleButton value="v1" sx={{ px: 1.25, height: 44 }}>
                  v1
                </ToggleButton>
                <ToggleButton value="v2" sx={{ px: 1.25, height: 44 }}>
                  v2
                </ToggleButton>
              </ToggleButtonGroup>
            </Tooltip>
          </CapabilityGate>

          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setDialogOpen(true)}
            sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
          >
            {t('action.newSession')}
          </Button>

          {/* 人设管理入口（T10）：图标键，44px 触控目标，两种布局下都在 */}
          <Tooltip title={pl('page.persona.title')} arrow>
            <IconButton
              onClick={() => setPersonaOpen(true)}
              aria-label={pl('page.persona.title')}
              sx={{ minWidth: 44, minHeight: 44 }}
            >
              <PeopleAltOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {/* ——— v2：角色轨（快捷入口已迁至设置页，见下方注释） ——— */}
      {layout === 'v2' ? (
        <>
          <Box sx={{ mt: 2 }}>
            <PersonaRail
              personas={personas}
              currentId={currentPersonaId}
              onPick={(card) => handlePickPersona(card.id)}
              loading={!personasHydrated}
            />
          </Box>
          <Divider sx={{ my: 2 }} />
        </>
      ) : (
        <Divider sx={{ my: 2 }} />
      )}

      {/* ——— 会话列表 ——— */}
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, opacity: 0.75 }}>
        {t('home.sessionTitle')}
      </Typography>

      <SessionList
        sessions={filtered}
        loading={loading}
        dense={layout === 'v2'}
        personaNameOf={personaNameOf}
        onOpen={handleOpen}
        onArchive={(session) => void handleArchive(session)}
        onDelete={handleDelete}
        onNew={() => setDialogOpen(true)}
      />

      {/*
        ★★ 首页快捷入口网格**已整体迁到设置页**（2026-10-04，用户要求）。

        原先是 `{layout === 'v1' ? <QuickEntries columns={3} /> : null}`
        —— 两套布局各挂一处，v2 在角色轨下面、v1 在会话列表下面。

        搬走的理由见 `features/settings/sections/ShortcutsSection.tsx` 头部：
        6 个磁贴里 3 个与底部 Tab / 侧栏重复，白占两行垂直空间，
        把真正要看的会话列表挤出首屏。

        ★ 这里**不留空位、不保留 Divider**：摘掉就该看不出它曾经在过。
      */}

      {filtered.length > 0 ? (
        <Typography variant="caption" sx={{ display: 'block', mt: 2, opacity: 0.5 }}>
          {`${filtered.length} / ${sessions.length}`}
        </Typography>
      ) : null}

      {/* 移动端浮动新建键：拇指最容易够到 */}
      <Fab
        color="primary"
        aria-label={t('action.newSession')}
        onClick={() => setDialogOpen(true)}
        sx={{ position: 'fixed', right: 16, bottom: 80, display: { sm: 'none' } }}
      >
        <AddIcon />
      </Fab>

      <NewSessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(session) => {
          setCurrentSession(session.id);
          navigate(to.chat(session.id));
        }}
      />

      {/* 人设管理：全屏弹窗形态的「页」（路由表里没有独立人设页） */}
      <PersonaListPage open={personaOpen} onClose={() => setPersonaOpen(false)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        titleKey="confirm.deleteSession"
        confirmKey="common.delete"
        cancelKey="common.cancel"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </Box>
  );
}
