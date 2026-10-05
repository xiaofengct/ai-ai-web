import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { SettingsField } from './SettingsField';
import { SettingsNotice } from './SettingsNotice';
import { sl } from './settingsCopy';
import { useAdvancedText } from './useAdvancedFlags';
import { useSettingsStore } from '@/store/settingsStore';
import { to } from '@/router/paths';

/**
 * 桥接设置页（PG-23）。
 *
 * ★ 接微信现在有两条路：
 *   ① **原生通道（iLink Bot 官方接口）**：装在手机上、App 在前台时直接收发微信消息，
 *      入口在设置页的「微信 ClawBot」分组（`WechatSection`）；
 *   ② **手动导入（本页）**：不挑环境 —— 把聊天记录导出 / 复制 → 粘贴或选文件 →
 *      复用解析器读进来 → 导出为可分享文本 / 图片卡片。
 *
 * ★ 本页控件围绕第 ② 条（手动导入）设计：剪贴板监听、导入解析规则、导出模板、教程链接位。
 *   两条路的取舍与限制（原生挑环境、前台才收得到）由本页文案如实说明，不做静默降级。
 */
export function BridgeSettingsPage(): JSX.Element {
  const bridge = useSettingsStore((s) => s.settings.bridge);
  const patch = useSettingsStore((s) => s.patch);

  /** 教程链接位：留空壳（决策 A6：不做未知第三方跳转），用户可自己填 */
  const [tutorialUrl, setTutorialUrl] = useAdvancedText('PG-23.tutorial', '');

  const steps: readonly { key: Parameters<typeof sl>[0] }[] = [
    { key: 'bridge.step1' },
    { key: 'bridge.step2' },
    { key: 'bridge.step3' },
    { key: 'bridge.step4' },
  ];

  return (
    <Box sx={{ width: '100%', maxWidth: 860, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Stack spacing={0.25} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {sl('label.bridge')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {sl('page.bridge.desc')}
        </Typography>
      </Stack>

      {/* —— 环境限制说明（原生通道挑环境；手动导入不限） —— */}
      <SettingsNotice>{sl('bridge.wechatUnavailable')}</SettingsNotice>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        {/* —— 剪贴板监听 —— */}
        <SettingsField labelKey="bridge.clipboardWatch" hintKey="bridge.hint.clipboardWatch" featureId="PG-23">
          <Switch
            checked={bridge.clipboardWatch}
            onChange={(e) => patch({ bridge: { clipboardWatch: e.target.checked } })}
          />
        </SettingsField>

        {/* —— 导入解析规则 —— */}
        <SettingsField labelKey="bridge.importRules" hintKey="bridge.hint.importRules" featureId="PG-23">
          <TextField
            size="small"
            multiline
            minRows={3}
            maxRows={8}
            value={bridge.importRules.join('\n')}
            onChange={(e) =>
              patch({
                bridge: {
                  importRules: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter((s) => s !== ''),
                },
              })
            }
            sx={{ width: 280 }}
          />
        </SettingsField>

        {/* —— 导出模板 —— */}
        <SettingsField labelKey="bridge.exportTemplate" hintKey="bridge.hint.exportTemplate" featureId="PG-23">
          <TextField
            select
            size="small"
            value={bridge.exportTemplate}
            onChange={(e) => patch({ bridge: { exportTemplate: e.target.value } })}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="markdown">markdown</MenuItem>
            <MenuItem value="text">text</MenuItem>
            <MenuItem value="json">json</MenuItem>
          </TextField>
        </SettingsField>

        {/* —— 教程链接位（留空壳） —— */}
        <SettingsField labelKey="bridge.tutorial" hintKey="bridge.hint.tutorial" featureId="PG-23">
          <TextField
            size="small"
            value={tutorialUrl}
            onChange={(e) => setTutorialUrl(e.target.value)}
            placeholder={sl('ui.optional')}
            sx={{ width: 280 }}
          />
        </SettingsField>

        <Divider sx={{ my: 1.5 }} />

        {/* —— 两条路怎么走：原生扫码 / 浏览器手动导入 —— */}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
          {sl('bridge.howto')}
        </Typography>
        <Stack spacing={0.5}>
          {steps.map((s, i) => (
            <Stack key={s.key} direction="row" spacing={1} alignItems="center" sx={{ minHeight: 44 }}>
              <Chip size="small" variant="outlined" label={String(i + 1)} sx={{ fontFamily: 'monospace' }} />
              <Typography variant="body2">{sl(s.key)}</Typography>
            </Stack>
          ))}
        </Stack>

        <Button
          variant="contained"
          component={Link}
          to={to.distill()}
          sx={{ minHeight: 44, mt: 1.5 }}
        >
          {sl('bridge.gotoDistill')}
        </Button>
      </Paper>
    </Box>
  );
}

export default BridgeSettingsPage;
