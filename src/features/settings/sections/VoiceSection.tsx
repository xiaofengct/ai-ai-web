import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import { SettingsField } from '../SettingsField';
import { SettingsNotice } from '../SettingsNotice';
import { sl } from '../settingsCopy';
import { useAdvancedText } from '../useAdvancedFlags';
import { isAsrSupported } from '@/llm/asr';
import { hasCloudTts, isWebSpeechAvailable } from '@/llm/tts';
import { useSettingsStore } from '@/store/settingsStore';
import { useActiveProvider } from '@/hooks/useSettings';
import { to } from '@/router/paths';

/**
 * 语音分组（FN-55 角色音色 / FN-59 语音功能，另含 PL-14 的能力探针展示）。
 *
 * ★ 端侧 sherpa-onnx 不可移植（PL-14 = alternative）：
 *   这里只做「能力探针 + 开关 + 入口」。能不能真的用，先看浏览器给不给面子。
 */
export function VoiceSection(): JSX.Element {
  const voice = useSettingsStore((s) => s.settings.voice);
  const patch = useSettingsStore((s) => s.patch);
  const provider = useActiveProvider();

  /** FN-55 云端音色 ID（端侧语音克隆无法实现，退而求其次） */
  const [cloudVoiceId, setCloudVoiceId] = useAdvancedText('FN-55', '');

  const setVoice = useCallback(
    (partial: Partial<{ enabled: boolean; tts: boolean; asr: boolean }>) => {
      patch({ voice: partial });
    },
    [patch],
  );

  /** 能力探针：三项都由浏览器/配置决定，改不了就如实展示 */
  const probes = useMemo(
    () => [
      { label: sl('label.speechProbe'), ok: isWebSpeechAvailable() },
      { label: sl('label.cloudTts'), ok: hasCloudTts(provider) },
      { label: sl('label.asr'), ok: isAsrSupported() },
    ],
    [provider],
  );

  return (
    <Box>
      {/* 能力探针一览：先说清楚这事儿不归我管 */}
      <SettingsNotice
        extra={
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            {probes.map((p) => (
              <Chip
                key={p.label}
                size="small"
                color={p.ok ? 'success' : 'default'}
                variant={p.ok ? 'filled' : 'outlined'}
                label={`${p.label}：${p.ok ? sl('ui.supported') : sl('ui.unsupported')}`}
              />
            ))}
          </Stack>
        }
      >
        {sl('hint.speechProbe')}
      </SettingsNotice>

      {/* —— FN-59 语音总开关 · 等级见能力表 capabilities.ts，此处不复制 —— */}
      <SettingsField labelKey="label.voice" hintKey="hint.voice" featureId="FN-59">
        <Switch checked={voice.enabled} onChange={(e) => setVoice({ enabled: e.target.checked })} />
      </SettingsField>

      {/* —— FN-59 语音播报 —— */}
      <SettingsField labelKey="label.tts" hintKey="hint.tts" nested featureId="FN-59">
        <Switch
          checked={voice.tts}
          disabled={!voice.enabled}
          onChange={(e) => setVoice({ tts: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-59 语音输入 —— */}
      <SettingsField labelKey="label.asr" hintKey="hint.asr" nested featureId="FN-59">
        <Switch
          checked={voice.asr}
          disabled={!voice.enabled}
          onChange={(e) => setVoice({ asr: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-55 角色音色 · 等级见能力表 capabilities.ts，此处不复制 —— */}
      <SettingsField labelKey="label.timbre" hintKey="hint.timbre" featureId="FN-55">
        <TextField
          size="small"
          value={cloudVoiceId}
          onChange={(e) => setCloudVoiceId(e.target.value)}
          placeholder={sl('ui.optional')}
          disabled={!voice.enabled}
          sx={{ width: 220 }}
        />
      </SettingsField>

      {/* 语音相关页面入口（PG-04 / PG-05） */}
      <SettingsField labelKey="label.voice">
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            component={Link}
            to={to.voiceTest()}
            sx={{ minHeight: 44 }}
          >
            {sl('voice.goTest')}
          </Button>
          <Button
            size="small"
            variant="text"
            component={Link}
            to={to.voiceCall()}
            sx={{ minHeight: 44 }}
          >
            {sl('voice.goCall')}
          </Button>
        </Stack>
      </SettingsField>
    </Box>
  );
}

export default VoiceSection;
