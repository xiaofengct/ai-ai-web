import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import ScienceIcon from '@mui/icons-material/Science';
import { to } from '@/router/paths';
import { t } from '@/copy';

/**
 * 「还没有任何角色」引导块（**不内置欣然版**首启的主界面）。
 *
 * ★ 什么时候出现：`personas.length === 0`。
 *   内置版**不可达**——`bootstrap()` 保证内置欣然卡恒在，且 `personaRepo` 禁删内置卡；
 *   所以这段代码对内置版是死分支（也正因如此，把它做成整页替换是安全的）。
 *
 * ★ 为什么是"整页替换"而不是"在角色轨位置放个空态"：
 *   无角色时，角色轨、会话列表、快捷入口**都是无意义的**——
 *   会话列表会显示「还没有聊天呢。想说什么就直说，我都在。」，
 *   而此刻根本没有人能听。⇒ 与其叠三个各说各话的空态，不如**只给一条明确的路**。
 *
 * ★ 两个入口对应本应用仅有的两种"产生角色"的方式（PRD FN-02 / EX-01）：
 *   ① **导入人设文件**（`sillytavern` v2 角色卡 / 本应用导出的人设 JSON）；
 *   ② **把聊天记录交给我**（进蒸馏向导，走 5 步生成角色卡）。
 *   两条路都不需要先有角色，所以在这个空态里是可执行的（不会点进去又撞空态）。
 *
 * ★ 文案：全部走文案表（A 档），主语刻意避开"我 = 欣然"的自我介绍
 *   ——此刻还没有角色，说「我在这里」是假话。
 */
export interface NoPersonaGuideProps {
  /** 「导入人设」——由父组件打开人设管理/导入弹窗（复用首页既有入口，不新造第二套） */
  onImportPersona: () => void;
}

export function NoPersonaGuide({ onImportPersona }: NoPersonaGuideProps): ReactElement {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 2,
        py: { xs: 5, md: 9 },
        px: 2,
      }}
    >
      <BadgeOutlinedIcon sx={{ fontSize: 56, opacity: 0.35 }} />

      <Typography variant="body1" sx={{ maxWidth: 460, lineHeight: 1.7 }}>
        {t('empty.noPersona')}
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1, width: { xs: '100%', sm: 'auto' } }}>
        <Button
          variant="contained"
          startIcon={<BadgeOutlinedIcon />}
          onClick={onImportPersona}
          sx={{ minHeight: 44, px: 3 }}
        >
          {t('action.importPersona')}
        </Button>
        <Button
          variant="outlined"
          startIcon={<ScienceIcon />}
          onClick={() => navigate(to.distill())}
          sx={{ minHeight: 44, px: 3 }}
        >
          {t('nav.distill')}
        </Button>
      </Stack>
    </Box>
  );
}

export default NoPersonaGuide;
