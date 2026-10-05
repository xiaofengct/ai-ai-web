import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import HubIcon from '@mui/icons-material/Hub';
import MicIcon from '@mui/icons-material/MicNoneOutlined';
import PsychologyAltIcon from '@mui/icons-material/PsychologyAlt';
import ScienceIcon from '@mui/icons-material/Science';
import { CapabilityGate } from '@/components/CapabilityGate';
import { to } from '@/router/paths';
import { t, type CopyKey } from '@/copy';

/**
 * ★★ 「快捷入口」分区 —— 承接原先挂在**首页**上的那 6 个磁贴（2026-10-04 迁入）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么搬家（用户原话）
 * ═══════════════════════════════════════════════════════════════════════════
 * > 「第一张图中我圈出的部分功能并非必要，请将这些功能统一集成到"设置"页面中，
 * >   主界面保持简洁」
 *
 * 圈出的是首页那个 3×2 的入口网格（记忆 / 蒸馏 / 收藏 / 语音 / 模型 / 设置）。
 *
 * ── 改动前它为什么确实"不必要" ─────────────────────────────────────────
 * 6 个磁贴里有 3 个是**重复入口**：
 *   · 记忆 / 蒸馏 / 设置 —— 底部 Tab（移动端）和侧栏（桌面端）**都已经有了**；
 *   · 模型 —— 点进去是"连接测试"页，而设置页第一个分组本来就是「模型」。
 * 于是首页在"搜索 + 布局切换 + 新建会话 + 人设入口 + 角色轨 + 会话列表"之外，
 * 又白占了整整两行的垂直空间，把真正的会话列表挤到首屏之外。
 * ⇒ 摘掉它，首页回到"看会话、开新会话"这一件事上。
 *
 * ── 为什么搬到设置页而不是直接删掉 ───────────────────────────────────
 * 「收藏」**全应用只有这一个入口**（实测：`to.favorites()` 的调用点仅此一处）。
 * 直接删掉 = 收藏夹功能彻底不可达 —— 那就不是"精简"，是**功能丢失**。
 * ⇒ 入口必须保留，只是换个位置：低频功能收进设置页，是符合直觉的归属。
 *
 * ── 为什么不把「设置」这一项也搬过来 ─────────────────────────────────
 * 它指向的就是**当前这一页**。留着只会得到"点一下、页面没变"的困惑。
 * ⇒ 5 项进设置页，`设置` 一项去掉（用户的诉求是"集成进设置"，不是"设置里再放一个设置"）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 排版位置：排在设置页**第一个**，但用 `emphasis: 'subtle'`
 * ═══════════════════════════════════════════════════════════════════════════
 * 放最后的话，「收藏」会掉到一屏之外 —— 那和删掉没区别。
 * 放第一个又怕抢了「模型」（唯一 primary，不配它什么都用不了）的戏。
 * ⇒ 位置给第一（保证可达），**视觉权重压到 subtle**（保证不抢戏）。
 *   两者各管一件事，是这个取舍的关键。
 *
 * ★ 每一项都对应一条真实路由；**网页版做不到的能力**用 `<CapabilityGate>` 包起来，
 *   由它统一置灰 + 展示原因与替代方案（架构文档 §6.10，不允许静默缺失）。
 *   之所以用 `ButtonBase` 而不是 `Paper`：闸门会给孩子注入 `disabled`，
 *   `ButtonBase` 能正确吞掉点击事件并给出 `aria-disabled`，语义上更安全。
 */
interface ShortcutEntry {
  icon: ReactElement;
  labelKey: CopyKey;
  target: string;
  /** 关联的功能项 ID（能力闸门据此判断是否置灰） */
  featureId: string;
}

const ENTRIES: readonly ShortcutEntry[] = [
  { icon: <PsychologyAltIcon fontSize="small" />, labelKey: 'nav.memories', target: to.memories(), featureId: 'FN-56' },
  { icon: <ScienceIcon fontSize="small" />, labelKey: 'nav.distill', target: to.distill(), featureId: 'EX-01' },
  // ★ 收藏：全应用**唯一**入口，删不得（见文件头）
  { icon: <FavoriteBorderIcon fontSize="small" />, labelKey: 'nav.favorites', target: to.favorites(), featureId: 'PG-08' },
  // ★ 语音入口指向**通话页** `/voice/call`，不是测试页 `/voice/test`。
  //   用户点「语音」是**想跟欣然说话**；`/voice/test` 是满屏英文的技术诊断台，
  //   只从「设置 → 语音 → 去试听」进入（开发者 / 自助排查通路，B 档豁免）。
  //   featureId 也必须跟着用 PG-05 —— 闸门按「你要进去的页面」判，不是按旧页面。
  { icon: <MicIcon fontSize="small" />, labelKey: 'settings.group.voice', target: to.voiceCall(), featureId: 'PG-05' },
  { icon: <HubIcon fontSize="small" />, labelKey: 'settings.group.model', target: to.settingsConnection(), featureId: 'PG-18' },
];

export function ShortcutsSection(): JSX.Element {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        display: 'grid',
        // ★ 自适应列数：窄屏 3 列、宽一点自动变多。
        //   原先写死 `repeat(3, ...)`（首页是 3 列），搬到设置页后卡片本身
        //   还有内边距，写死列数在窄屏上会让每个磁贴只剩 ~70px，
        //   中文标签要挤成两行 —— 用 `auto-fill` 让浏览器按可用宽度自己定。
        gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))',
        gap: 1,
      }}
    >
      {ENTRIES.map((entry) => (
        <CapabilityGate key={entry.target} featureId={entry.featureId}>
          <ButtonBase
            focusRipple
            onClick={() => navigate(entry.target)}
            sx={{
              minHeight: 68,
              p: 1,
              border: 1,
              borderColor: 'divider',
              borderRadius: 2.5,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.5,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ color: 'primary.main', display: 'flex' }}>{entry.icon}</Box>
            <Typography variant="caption" align="center" sx={{ lineHeight: 1.3, opacity: 0.85 }}>
              {t(entry.labelKey)}
            </Typography>
          </ButtonBase>
        </CapabilityGate>
      ))}
    </Box>
  );
}

export default ShortcutsSection;
