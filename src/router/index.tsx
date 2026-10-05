import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { AppShell } from '@/layouts/AppShell';
import CrashPage from '@/features/crash/CrashPage';
import { useSnack } from '@/hooks/useSnack';
import { t } from '@/copy';
import { log } from '@/store/logStore';
import { ROUTE, ROUTE_COUNT, EXPECTED_ROUTE_COUNT } from './paths';
import { RequireGuide, RequireProvider } from './RouteGuards';

/**
 * ★ 路由表（架构文档 §5 T07 验收要点①）：27 条路由全部可达。
 *
 * 结构：
 * - `/guide` 与全屏页（图片预览 / 全屏文本 / 语音通话）**不套 AppShell**，各自独立铺满；
 * - 其余页面走「无 path 的布局路由」，由 `AppShell` 提供顶栏 / 侧栏 / 底部 Tab；
 * - 所有页面 **懒加载**（`manualChunks` 由 vite 配置统一拆分），
 *   模块还没落地时降级为「待接入」占位页，避免整站白屏（见 `lazyPage`）。
 */

type PageComponent = ComponentType<Record<string, unknown>>;
type PageModule = { default: PageComponent };

/**
 * 「页面尚未接入」占位页。
 * 只有当某个页面模块因故加载失败（例如对应任务尚未落地）时才会出现，
 * 正常用户路径上看不到它。
 */
function PagePending({ scope }: { scope: string }): JSX.Element {
  const snack = useSnack();
  return (
    <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 480, width: '100%' }}>
        <Stack spacing={1.5} alignItems="flex-start">
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('app.booting')}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.75 }}>
            {t('loading.default')}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.45, fontFamily: 'monospace' }}>
            {scope}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            sx={{ minHeight: 44 }}
            onClick={() => snack.info('loading.default')}
          >
            {t('common.refresh')}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

/**
 * 安全的懒加载包装：
 * - 正常情况下返回页面模块本身；
 * - 加载失败时**兜底为占位页**并记日志，不让 router 把错误往上抛导致白屏。
 */
function lazyPage(importer: () => Promise<PageModule>, scope: string): PageComponent {
  const Lazy = lazy(async (): Promise<PageModule> => {
    try {
      return await importer();
    } catch (e) {
      log.warn('router', '页面模块尚未接入，已降级为占位页', { scope, reason: String(e) }, 'PG-27');
      return { default: () => <PagePending scope={scope} /> };
    }
  });
  return Lazy;
}

/** 懒加载边界：统一的加载态（文案走 copy 表） */
function AsyncPage({ Page }: { Page: PageComponent }): JSX.Element {
  return (
    <Suspense
      fallback={
        <Box sx={{ py: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={24} />
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {t('loading.default')}
          </Typography>
        </Box>
      }
    >
      <Page />
    </Suspense>
  );
}

/* ============================ 页面懒加载声明 ============================ */
/* T07 自有页面 */
const HomePage = lazyPage(() => import('@/features/home/HomePage'), 'HomePage');
const GuidePage = lazyPage(() => import('@/features/guide/GuidePage'), 'GuidePage');
/* T08 聊天主闭环与聊天周边页面 */
const ChatPage = lazyPage(() => import('@/features/chat/ChatPage'), 'ChatPage');
const ChatStatsPage = lazyPage(() => import('@/features/chat/ChatStatsPage'), 'ChatStatsPage');
const ChatSearchPage = lazyPage(() => import('@/features/chat/ChatSearchPage'), 'ChatSearchPage');
const ChatSettingsPage = lazyPage(() => import('@/features/chat/ChatSettingsPage'), 'ChatSettingsPage');
const ContextSettingsPage = lazyPage(
  () => import('@/features/chat/ContextSettingsPage'),
  'ContextSettingsPage',
);
const ForwardedDetailPage = lazyPage(
  () => import('@/features/chat/ForwardedDetailPage'),
  'ForwardedDetailPage',
);
const TextFullScreenPage = lazyPage(
  () => import('@/features/chat/TextFullScreenPage'),
  'TextFullScreenPage',
);
const FavoritesPage = lazyPage(() => import('@/features/favorites/FavoritesPage'), 'FavoritesPage');
/* 朋友圈（2026-10-04 新增，非能力表项） */
const MomentsPage = lazyPage(() => import('@/features/moments/MomentsPage'), 'MomentsPage');
const ImagePreviewPage = lazyPage(() => import('@/features/media/ImagePreviewPage'), 'ImagePreviewPage');
/* T09 设置体系 */
const SettingsPage = lazyPage(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const ConnectionTestPage = lazyPage(
  () => import('@/features/settings/ConnectionTestPage'),
  'ConnectionTestPage',
);
const DeveloperPage = lazyPage(() => import('@/features/settings/DeveloperPage'), 'DeveloperPage');
const DiagnosisPage = lazyPage(() => import('@/features/settings/DiagnosisPage'), 'DiagnosisPage');
const SponsorPage = lazyPage(() => import('@/features/settings/SponsorPage'), 'SponsorPage');
const SdkPage = lazyPage(() => import('@/features/settings/SdkPage'), 'SdkPage');
const BridgeSettingsPage = lazyPage(
  () => import('@/features/settings/BridgeSettingsPage'),
  'BridgeSettingsPage',
);
/* 反馈信箱（2026-10-04 新增，非能力表项） */
const FeedbackInboxPage = lazyPage(
  () => import('@/features/feedback/FeedbackInboxPage'),
  'FeedbackInboxPage',
);
/* T10 记忆管理 */
const MemoryManagePage = lazyPage(
  () => import('@/features/memory/MemoryManagePage'),
  'MemoryManagePage',
);
const MemoryEditorPage = lazyPage(
  () => import('@/features/memory/MemoryEditorPage'),
  'MemoryEditorPage',
);
/* T11 蒸馏 */
const DistillListPage = lazyPage(() => import('@/features/distill/DistillListPage'), 'DistillListPage');
const DistillJobDetailPage = lazyPage(
  () => import('@/features/distill/DistillJobDetailPage'),
  'DistillJobDetailPage',
);
/* T12 增强能力 */
const VoiceTestPage = lazyPage(() => import('@/features/voice/VoiceTestPage'), 'VoiceTestPage');
const VoiceCallPage = lazyPage(() => import('@/features/voice/VoiceCallPage'), 'VoiceCallPage');
const ModuleWebPage = lazyPage(() => import('@/features/module/ModuleWebPage'), 'ModuleWebPage');
const ModulePermissionPage = lazyPage(
  () => import('@/features/module/ModulePermissionPage'),
  'ModulePermissionPage',
);

/* 能力总览（141 项能力表的整体出口） */
const CapabilityOverviewPage = lazyPage(
  () => import('@/features/capabilities/CapabilityOverviewPage'),
  'CapabilityOverviewPage',
);

/* ================================ 路由表 ================================ */
export const routes: RouteObject[] = [
  // —— 全屏页：不套壳 ——
  // ① 引导页本身必须是「守卫的目标」，不能挂在 RequireGuide 之下
  { path: ROUTE.guide, element: <AsyncPage Page={GuidePage} /> },
  // ② 图片预览（PG-06）：全屏缩放，不需要顶栏侧栏
  {
    path: ROUTE.preview,
    element: (
      <RequireGuide>
        <AsyncPage Page={ImagePreviewPage} />
      </RequireGuide>
    ),
  },
  // ③ 全屏文本（PG-22）
  {
    path: ROUTE.text,
    element: (
      <RequireGuide>
        <AsyncPage Page={TextFullScreenPage} />
      </RequireGuide>
    ),
  },
  // ④ 语音通话（PG-05）：全屏通话态
  {
    path: ROUTE.voiceCall,
    element: (
      <RequireGuide>
        <RequireProvider>
          <AsyncPage Page={VoiceCallPage} />
        </RequireProvider>
      </RequireGuide>
    ),
  },

  // —— 主壳：AppShell（顶栏 + 侧栏 + 底部 Tab + 浮层）——
  {
    element: (
      <RequireGuide>
        <AppShell />
      </RequireGuide>
    ),
    errorElement: <CrashPage />,
    children: [
      { path: ROUTE.home, element: <AsyncPage Page={HomePage} /> },

      // 聊天域（PG-16 + 四个周边页）：必须已配置 Provider
      {
        path: ROUTE.chat,
        element: (
          <RequireProvider>
            <AsyncPage Page={ChatPage} />
          </RequireProvider>
        ),
      },
      {
        path: ROUTE.chatStats,
        element: (
          <RequireProvider>
            <AsyncPage Page={ChatStatsPage} />
          </RequireProvider>
        ),
      },
      {
        path: ROUTE.chatSearch,
        element: (
          <RequireProvider>
            <AsyncPage Page={ChatSearchPage} />
          </RequireProvider>
        ),
      },
      {
        path: ROUTE.chatSettings,
        element: (
          <RequireProvider>
            <AsyncPage Page={ChatSettingsPage} />
          </RequireProvider>
        ),
      },
      {
        path: ROUTE.chatContext,
        element: (
          <RequireProvider>
            <AsyncPage Page={ContextSettingsPage} />
          </RequireProvider>
        ),
      },
      { path: ROUTE.forward, element: <AsyncPage Page={ForwardedDetailPage} /> },

      // 记忆（PG-12 / PG-13）
      { path: ROUTE.memories, element: <AsyncPage Page={MemoryManagePage} /> },
      { path: ROUTE.memoryEdit, element: <AsyncPage Page={MemoryEditorPage} /> },

      // 收藏（PG-08）
      { path: ROUTE.favorites, element: <AsyncPage Page={FavoritesPage} /> },

      // 朋友圈（2026-10-04 新增）
      { path: ROUTE.moments, element: <AsyncPage Page={MomentsPage} /> },

      // 蒸馏（EX-01）
      { path: ROUTE.distill, element: <AsyncPage Page={DistillListPage} /> },
      { path: ROUTE.distillJob, element: <AsyncPage Page={DistillJobDetailPage} /> },

      // 设置体系（PG-17 ~ PG-23 / PG-26）
      { path: ROUTE.settings, element: <AsyncPage Page={SettingsPage} /> },
      { path: ROUTE.settingsConnection, element: <AsyncPage Page={ConnectionTestPage} /> },
      { path: ROUTE.settingsDeveloper, element: <AsyncPage Page={DeveloperPage} /> },
      { path: ROUTE.settingsDiagnosis, element: <AsyncPage Page={DiagnosisPage} /> },
      { path: ROUTE.settingsSponsor, element: <AsyncPage Page={SponsorPage} /> },
      { path: ROUTE.settingsSdk, element: <AsyncPage Page={SdkPage} /> },
      { path: ROUTE.settingsBridge, element: <AsyncPage Page={BridgeSettingsPage} /> },
      // 反馈信箱（2026-10-04 新增）：管理"这台设备上"的反馈。
      // ★ 不套 `RequireProvider` —— 反馈的是应用本身，跟配没配模型无关
      //   （一个"没配模型所以用不了"的反馈入口，恰好会在最需要它的场景下不可用）。
      { path: ROUTE.settingsFeedback, element: <AsyncPage Page={FeedbackInboxPage} /> },

      // 语音测试（PG-04）与沙箱模块（PG-24 / PG-25）
      { path: ROUTE.voiceTest, element: <AsyncPage Page={VoiceTestPage} /> },
      { path: ROUTE.module, element: <AsyncPage Page={ModuleWebPage} /> },
      { path: ROUTE.modulePermission, element: <AsyncPage Page={ModulePermissionPage} /> },

      // 能力总览（141 项，不可实现项在这里统一给出原因 + 替代方案，PRD §11）
      { path: ROUTE.capabilities, element: <AsyncPage Page={CapabilityOverviewPage} /> },

      // 兜底：未匹配路径
      { path: ROUTE.notFound, element: <CrashPage variant="notFound" /> },
    ],
  },
];

/** 路由数量自检（开发者页可展示；缺一条会在控制台告警） */
export function auditRoutes(): { total: number; expected: number; missing: number } {
  const missing = Math.max(0, EXPECTED_ROUTE_COUNT - ROUTE_COUNT);
  if (missing > 0) {
    log.warn('router', '路由数量不足', { total: ROUTE_COUNT, expected: EXPECTED_ROUTE_COUNT }, 'PG-27');
  }
  return { total: ROUTE_COUNT, expected: EXPECTED_ROUTE_COUNT, missing };
}

const router = createBrowserRouter(routes);

/** 应用路由宿主（由 App.tsx 挂载在 ThemeProvider / ErrorBoundary 之内） */
export function AppRouter(): JSX.Element {
  return <RouterProvider router={router} />;
}

export default AppRouter;
