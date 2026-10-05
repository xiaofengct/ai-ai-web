import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { SettingsSectionCard } from './SettingsSectionCard';
import { sl } from './settingsCopy';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { StickerManagerSection } from '@/features/stickers/StickerManagerSection';
import { MomentsSection } from './sections/MomentsSection';
import { ModelSection } from './sections/ModelSection';
import { ChatSection } from './sections/ChatSection';
import { ContextSection } from './sections/ContextSection';
import { ProactiveSection } from './sections/ProactiveSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { VoiceSection } from './sections/VoiceSection';
import { WechatSection } from './sections/WechatSection';
import { MemorySection } from './sections/MemorySection';
import { WorldSection } from './sections/WorldSection';
import { FeedbackSection } from '@/features/feedback/FeedbackSection';
import { BackupSection } from './sections/BackupSection';
import { AdvancedSection } from './sections/AdvancedSection';
import { AboutSection } from './sections/AboutSection';
import { cl } from '@/features/capabilities/capabilitiesCopy';
import { to } from '@/router/paths';
import { t } from '@/copy';
import type { CopyKey } from '@/copy/keys';

/**
 * 全局设置页（PG-17）。
 *
 * ★ 10 个分组（模型 / 聊天 / 上下文 / 主动消息 / 记忆 / 语音 / 外观 / 备份 / 高级 / 关于）
 *   与能力表 PG-17 的口径一致；63 个设置项（FN-01 ~ FN-63）分摊在这 10 组里，
 *   不可实现的项由各 section 内部的 `<CapabilityGate>` 置灰并给出原因。
 *
 * ★ 移动端（决策 A8）：分组可折叠（窄屏默认收起），所有触控目标 ≥44px。
 *
 * ★★ 2026-10-04 重构要点（用户诉求：更简洁、清晰、易用，功能与交互逻辑不变）：
 *
 *   1. **删掉标题右侧的能力编号**。原先每个分组标题右侧渲染一串能力 ID
 *      （最长 54 字符），既是布局塌方的元凶（把中文标题压成竖排，真机截图可证），
 *      对用户也毫无价值。能力审计改由 DOM 属性承担：`data-section-id`（本节）
 *      与 `data-feature-id`（`SettingRow`，不变）—— 视觉上不占空间。
 *   2. **用「权重 + 位置」表达层级**，而不是再加一层分组标题：
 *      模型 = `primary`（唯一必配项，其余功能都依赖它）；高级/关于 = `subtle`（低频）；
 *      其余 `default`。用户要的是"一眼看出先看哪块"，不是更多的字。
 *   3. **顺序按使用频率重排**：外观是低频偏好，从第 5 位下移到语音之后。
 *   4. **「能力总览」从顶部弱化并下移**：它是自检/参考入口，不是核心操作。
 *      原先是顶部的描边按钮，视觉权重与"配置模型"相当，喧宾夺主。
 *   5. **响应式**：桌面端双栏（`columnCount`），减少长页面滚动；窄屏单栏。
 */
interface SectionSpec {
  id: string;
  titleKey: CopyKey;
  descKey?: Parameters<typeof sl>[0];
  /**
   * 视觉权重（见 `SettingsSectionCard` 的 `emphasis`）。
   * ★ 这里**不再有** `featureIds` 字段 —— 能力编号不再进入 UI。
   */
  emphasis?: 'primary' | 'default' | 'subtle';
  element: JSX.Element;
}

export function SettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const sections: readonly SectionSpec[] = [
    {
      // ★★ 快捷入口（2026-10-04 加）：承接原先挂在**首页**上的那 6 个磁贴。
      //   位置理由见 `sections/ShortcutsSection.tsx` 头部——一句话：
      //   排第一是为了「收藏」（全应用唯一入口）不掉到一屏之外；
      //   压到 `subtle` 是为了不抢「模型」（唯一 primary）的戏。
      id: 'shortcuts',
      titleKey: 'settings.group.shortcuts',
      descKey: 'desc.group.shortcuts',
      emphasis: 'subtle',
      element: <ShortcutsSection />,
    },
    {
      id: 'model',
      titleKey: 'settings.group.model',
      // ★ 用独立的 `desc.group.model`，**不再复用 `hint.provider`**：
      //   复用会让同一句话在本组标题下和「用哪一家」下面各出现一遍。
      //   同类问题在 memory / voice / backup / about 四组也存在，已一并补齐
      //   （成因与教训见 `settingsCopy.ts` 的 `desc.group.*` 注释块）。
      descKey: 'desc.group.model',
      // ★ 唯一 primary：不配模型，聊天/蒸馏/语音全都用不了
      emphasis: 'primary',
      element: <ModelSection />,
    },
    {
      id: 'chat',
      titleKey: 'settings.group.chat',
      descKey: 'desc.group.chat',
      element: <ChatSection />,
    },
    {
      id: 'context',
      titleKey: 'settings.group.context',
      descKey: 'desc.group.context',
      element: <ContextSection />,
    },
    {
      id: 'proactive',
      titleKey: 'settings.group.proactive',
      descKey: 'note.proactiveHidden',
      element: <ProactiveSection />,
    },
    {
      id: 'memory',
      titleKey: 'settings.group.memory',
      descKey: 'desc.group.memory',
      element: <MemorySection />,
    },
    {
      // ★ 世界设定（2026-10-04 加）：排在「记忆」之后、「语音」之前。
      //   位置理由：它和「记忆」一样属于"她是谁、她过着什么日子"的设定层，
      //   排在偏好类（语音/外观/备份）之前更合阅读顺序。
      //   · 内置欣然版：显示内置世界（只读，不可删）——排班/地图/朋友都在里面
      //   · 不内置欣然版：这就是用户导入世界的窗口
      id: 'world',
      titleKey: 'settings.group.world',
      descKey: 'hint.world',
      element: <WorldSection />,
    },
    {
      // ★ 朋友圈动态（2026-10-04 加）：紧跟「主动消息」——
      //   两者是同一族行为（"她主动说话"），分开放会让人找不到它们的关系。
      id: 'moments',
      titleKey: 'settings.group.moments',
      descKey: 'desc.group.moments',
      element: <MomentsSection />,
    },
    {
      // ★ 表情包（2026-10-04 加）：排在「语音」之前 —— 它和语音同级，
      //   都是"她怎么表达自己"的通道（语音是声音，表情是图）。
      //   放在设置里是因为：① 它是**管理**行为（导入/删包），低频；
      //   ② 聊天页的面板只做"选一张发出去"，导入这种事不该占聊天界面。
      id: 'stickers',
      titleKey: 'settings.group.stickers',
      descKey: 'desc.group.stickers',
      element: <StickerManagerSection />,
    },
    {
      id: 'voice',
      titleKey: 'settings.group.voice',
      descKey: 'desc.group.voice',
      element: <VoiceSection />,
    },
    {
      // ★ 微信 ClawBot（iLink 官方通道）：放在「语音」之后。
      //   位置理由：它也是一条"和外界说话"的通道（与语音同类），
      //   但依赖外部环境（原生+前台），排在纯本机配置之后更合阅读顺序。
      id: 'ilink',
      titleKey: 'settings.group.ilink',
      descKey: 'desc.group.ilink',
      element: <WechatSection />,
    },
    {
      // ★ 外观从第 5 位下移：它是低频偏好，排在对话行为之后
      id: 'appearance',
      titleKey: 'settings.group.appearance',
      descKey: 'desc.group.appearance',
      element: <AppearanceSection />,
    },
    {
      id: 'backup',
      titleKey: 'settings.group.backup',
      descKey: 'desc.group.backup',
      element: <BackupSection />,
    },
    {
      // ★ 反馈与建议（2026-10-04 加）：排在「备份」之后、「高级」之前。
      //   位置理由：它是**用户反馈问题的通道**，属于"出了事才会来找"的一类，
      //   放在日常配置项（模型/聊天/语音/外观）之后，但不该掉进
      //   「高级 / 关于」那种低频尾巴里 —— 找不到反馈入口的应用等于没有反馈通道。
      //   ★ 只放**入口 + 最近几条回执**；完整列表在独立页 `/settings/feedback`，
      //     理由见 `features/feedback/FeedbackSection.tsx` 文件头
      //     （设置页分区的高度必须可控，这个教训已经返工过一次）。
      id: 'feedback',
      titleKey: 'settings.group.feedback',
      descKey: 'desc.group.feedback',
      element: <FeedbackSection />,
    },
    {
      id: 'advanced',
      titleKey: 'settings.group.advanced',
      descKey: 'hint.customHeadersBlocked',
      emphasis: 'subtle',
      element: <AdvancedSection />,
    },
    {
      id: 'about',
      titleKey: 'settings.group.about',
      descKey: 'desc.group.about',
      emphasis: 'subtle',
      element: <AboutSection />,
    },
  ];

  return (
    <Box sx={{ width: '100%', maxWidth: 960, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {t('nav.settings')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {sl('page.settings.desc')}
        </Typography>
      </Stack>

      {/*
        响应式：窄屏单栏；md 以上双栏（CSS 多列，`breakInside: avoid` 保证一张卡不被拆开）。
        目的：10 个分组在桌面上不必滚很长，同时保持"从上到下"的阅读顺序。
      */}
      <Box sx={{ columnCount: { xs: 1, md: 2 }, columnGap: 2 }}>
        {sections.map((s) => (
          <Box key={s.id} sx={{ breakInside: 'avoid', mb: 1.25 }}>
            <SettingsSectionCard
              id={s.id}
              titleKey={s.titleKey}
              {...(s.descKey ? { descKey: s.descKey } : {})}
              {...(s.emphasis ? { emphasis: s.emphasis } : {})}
            >
              {s.element}
            </SettingsSectionCard>
          </Box>
        ))}
      </Box>

      {/* ★ 能力总览：自检/参考入口，非核心操作 ⇒ 从顶部下移到底部并降级为文字按钮 */}
      <Box sx={{ mt: 2, textAlign: 'center' }}>
        <Button variant="text" size="small" onClick={() => navigate(to.capabilities())} sx={{ minHeight: 44 }}>
          {cl('page.capabilities.title')}
        </Button>
      </Box>
    </Box>
  );
}

export default SettingsPage;
