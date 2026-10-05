import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { NumberField } from '@/components/NumberField';
import { SettingsField } from '../SettingsField';
import { SettingsNotice } from '../SettingsNotice';
import { sl } from '../settingsCopy';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * 主动消息分组（FN-06 ~ FN-10 / FN-14 / FN-18 ~ FN-20）。
 *
 * ★ 这一组里 6 项在能力表里是 `partial`（浏览器没有后台常驻）：
 *   每一项都保留控件并交给 `<CapabilityGate>` 展示原因（PRD §11 不允许静默缺失），
 *   最上面再用一条横幅把「页面关掉或藏起来就不保证触发」讲清楚（SV-06 的降级口径）。
 */
export function ProactiveSection(): JSX.Element {
  const chat = useSettingsStore((s) => s.settings.chat);
  const setChat = useSettingsStore((s) => s.setChat);
  const p = chat.proactive;

  return (
    <Box>
      {/* ★ 降级横幅：先讲清楚，别让人以为是我偷懒 */}
      <SettingsNotice>{sl('note.proactiveHidden')}</SettingsNotice>

      {/* —— FN-06 主动消息 · 等级见能力表 capabilities.ts，此处不复制 —— */}
      <SettingsField labelKey="label.proactive" hintKey="hint.proactive" featureId="FN-06">
        <Switch
          checked={p.enabled}
          onChange={(e) => setChat({ proactive: { enabled: e.target.checked } })}
        />
      </SettingsField>

      {/* —— FN-07 继承 —— */}
      <SettingsField labelKey="label.proactiveInherit" hintKey="hint.proactiveInherit" featureId="FN-07">
        <Switch
          checked={p.inherit}
          onChange={(e) => setChat({ proactive: { inherit: e.target.checked } })}
        />
      </SettingsField>

      {/* —— FN-08 间隔 —— */}
      <SettingsField labelKey="label.proactiveInterval" hintCopyKey="settings.hint.proactiveInterval" featureId="FN-08">
        <NumberField
          value={p.intervalMin}
          onChange={(v) => setChat({ proactive: { intervalMin: v } })}
          min={1}
          max={1440}
          step={1}
          presets={[15, 30, 60, 120]}
          width={110}
        />
      </SettingsField>

      {/* —— FN-09 停用超时 —— */}
      <SettingsField labelKey="label.idleTimeout" hintCopyKey="settings.hint.idleTimeout" featureId="FN-09">
        <NumberField
          value={p.idleTimeoutMin}
          onChange={(v) => setChat({ proactive: { idleTimeoutMin: v } })}
          min={1}
          max={1440}
          step={1}
          presets={[15, 30, 60, 120]}
          width={110}
        />
      </SettingsField>

      {/* —— FN-10 全天候 + 安静时段 —— */}
      <SettingsField labelKey="label.allDay" hintCopyKey="settings.hint.allDay" featureId="FN-10">
        <Switch
          checked={p.allDay}
          onChange={(e) => setChat({ proactive: { allDay: e.target.checked } })}
        />
      </SettingsField>
      <SettingsField labelKey="label.quietHours" hintKey="hint.quietHours" nested featureId="FN-10">
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            type="time"
            value={p.quietHours?.from ?? '23:00'}
            onChange={(e) =>
              setChat({
                proactive: {
                  quietHours: { from: e.target.value, to: p.quietHours?.to ?? '07:00' },
                },
              })
            }
            disabled={p.allDay}
            sx={{ width: 120 }}
          />
          <Typography variant="caption">—</Typography>
          <TextField
            size="small"
            type="time"
            value={p.quietHours?.to ?? '07:00'}
            onChange={(e) =>
              setChat({
                proactive: {
                  quietHours: { from: p.quietHours?.from ?? '23:00', to: e.target.value },
                },
              })
            }
            disabled={p.allDay}
            sx={{ width: 120 }}
          />
        </Stack>
      </SettingsField>

      {/* —— FN-14 动态主动性 —— */}
      <SettingsField labelKey="label.dynamic" hintCopyKey="settings.hint.dynamic" featureId="FN-14">
        <Switch
          checked={p.dynamic}
          onChange={(e) => setChat({ proactive: { dynamic: e.target.checked } })}
        />
      </SettingsField>

      {/* —— FN-18 后台消息 · 等级见能力表 capabilities.ts，此处不复制 —— */}
      <SettingsField labelKey="label.backgroundMessage" hintKey="hint.backgroundMessage" featureId="FN-18">
        <Switch
          checked={chat.backgroundMessage}
          onChange={(e) => setChat({ backgroundMessage: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-19 后台消息 Toast · 等级见能力表 capabilities.ts，此处不复制 —— */}
      <SettingsField labelKey="label.backgroundToast" hintKey="hint.backgroundToast" featureId="FN-19">
        <Switch
          checked={chat.backgroundToast}
          onChange={(e) => setChat({ backgroundToast: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-20 后台消息退出确认 · 等级见能力表 capabilities.ts，此处不复制 —— */}
      <SettingsField
        labelKey="label.backgroundExitConfirm"
        hintKey="hint.backgroundExitConfirm"
        featureId="FN-20"
      >
        <Switch
          checked={chat.backgroundExitConfirm}
          onChange={(e) => setChat({ backgroundExitConfirm: e.target.checked })}
        />
      </SettingsField>
    </Box>
  );
}

export default ProactiveSection;
