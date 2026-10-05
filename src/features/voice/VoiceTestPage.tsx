/**
 * ★★ A 档（走文案表，不允许裸露英文）。本页**曾经被误判成 B 档，已纠正**，过程记录如下：
 *
 * 原来的 B 档理由是「首页入口改指 `/voice/call` 之后，本页只剩设置 → 语音这一条**开发者通路**」。
 * 这个理由是**错的**：`设置 → 语音 → 去试听` 是一级用户路径
 * （`VoiceSection.tsx:114` 的按钮，文案 `voice.goTest`），不是开发者通路。
 * 判据从头到尾都是「**谁会看到它**」——用户看得到，那就是 A 档。
 * 我在写那句判据的同一段注释里把它判错了：**把"它叫什么名字"（诊断台 / test）当成了
 * "谁会看到它"**，而这正是那段注释自己警告过的错误。
 *
 * 纠正后的落点：通道名（`sherpaWasm` / `cloud` / `webSpeech`）与三句英文说明
 * 全部收编为 `voice.channel.*` / `voice.channelNote.*`，走 `t()` 渲染。
 * 通道的**技术 id 仍然保留在数据层**（`TtsChannel` 联合类型、`useTTS` 内部逻辑不变），
 * 变的只是展示层——这两层不要混为一谈。
 *
 * ★ 保留下来的如实披露：端侧用的是固定 speaker id，不等价于原 App 的语音克隆；
 *   参考 mp3 只能回放（`alt.ttsFallback`）。B 档豁免的是"要不要走文案表"，不是"能不能不如实说"。
 */
import { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import { CapabilityGate } from '@/components/CapabilityGate';
import { useSnack } from '@/hooks/useSnack';
import { XINRAN_GREETINGS, XINRAN_NAME, t } from '@/copy';
import type { CopyKey } from '@/copy/keys';
import TimbreManager from './TimbreManager';
import { useTTS, type TtsChannel } from './useTTS';

/**
 * 语音测试页（PG-04 / FN-59 / PL-14）。
 *
 * ★ 三档通道在这里可切换并试听：
 *   `sherpaWasm`（离线，需 `public/sherpa/` 有官方产物，默认没有）→
 *   `cloud`（自备 Key）→ `webSpeech`（系统音色兜底）。
 *
 * ★★ 必须如实标注两点（能力表 PG-04 / FN-55 已写明）：
 *   1. 端侧用的是**固定 speaker id**，不等价于原 App 的语音克隆；
 *   2. 参考 mp3 只能回放，实时合成要么配云端，要么用系统音色（`alt.ttsFallback`）。
 */

/**
 * 三条通道的展示顺序。**技术 id 只在数据层用**，展示层一律走下面的文案映射。
 * ★ 用 `Record<TtsChannel, _>` 是为了让"新增通道忘了配文案"变成**编译错误**，
 *   而不是运行时显示成 key 字符串——这正是 `capabilities.ts` 那 141 条想达到的效果。
 */
const CHANNELS: readonly TtsChannel[] = ['sherpaWasm', 'cloud', 'webSpeech'];

const CHANNEL_NAME_KEY: Record<TtsChannel, CopyKey> = {
  sherpaWasm: 'voice.channel.sherpaWasm',
  cloud: 'voice.channel.cloud',
  webSpeech: 'voice.channel.webSpeech',
};

const CHANNEL_NOTE_KEY: Record<TtsChannel, CopyKey> = {
  sherpaWasm: 'voice.channelNote.sherpaWasm',
  cloud: 'voice.channelNote.cloud',
  webSpeech: 'voice.channelNote.webSpeech',
};

export default function VoiceTestPage(): JSX.Element {
  const snack = useSnack();
  const tts = useTTS();
  // 试听文本默认取欣然的一条欢迎语（文案走 copy 层，不在组件里写台词）
  const [text, setText] = useState<string>(XINRAN_GREETINGS[0] ?? XINRAN_NAME);
  const [lastChannel, setLastChannel] = useState<TtsChannel | undefined>(undefined);

  const handleSpeak = useCallback(async () => {
    if (text.trim() === '') return;
    const used = await tts.speak(text);
    setLastChannel(used);
    if (tts.failed) {
      snack.error('err.ttsFailed');
      return;
    }
    // 请求 sherpa 但实际用的是系统音色时，如实告诉用户降级发生了
    if (tts.channel === 'sherpaWasm' && used !== 'sherpaWasm') {
      snack.info('alt.ttsFallback');
    }
  }, [text, tts, snack]);

  return (
    <Box sx={{ width: '100%', maxWidth: 760, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {t('settings.group.voice')}
      </Typography>

      {/* ★ PG-04 = partial：入口保留，但把「只能做到一半」这件事明说 */}
      <CapabilityGate featureId="PG-04">
        <Typography variant="caption" sx={{ display: 'block', mb: 2, opacity: 0.75 }}>
          {t('alt.ttsFallback')}
        </Typography>
      </CapabilityGate>

      {/* ——— 通道选择 ——— */}
      <ToggleButtonGroup
        exclusive
        size="small"
        orientation="vertical"
        value={tts.channel}
        onChange={(_event, next: TtsChannel | null) => {
          if (next) tts.setChannel(next);
        }}
        sx={{ width: '100%', mb: 1 }}
      >
        {CHANNELS.map((channel) => (
          <ToggleButton key={channel} value={channel} sx={{ justifyContent: 'flex-start', py: 1 }}>
            <Stack alignItems="flex-start" sx={{ textAlign: 'left' }}>
              <Typography variant="body2">{t(CHANNEL_NAME_KEY[channel])}</Typography>
              <Typography variant="caption" sx={{ opacity: 0.65 }}>
                {t(CHANNEL_NOTE_KEY[channel])}
              </Typography>
            </Stack>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        {CHANNELS.map((channel) => {
          const available = tts.availability[channel];
          return (
            <Chip
              key={channel}
              size="small"
              label={t('voice.channelStatus', {
                name: t(CHANNEL_NAME_KEY[channel]),
                state: available ? t('common.on') : t('common.off'),
              })}
              color={available ? 'success' : 'default'}
              variant="outlined"
            />
          );
        })}
        {lastChannel ? (
          <Chip
            size="small"
            color="primary"
            variant="outlined"
            label={t('voice.lastUsed', { channel: t(CHANNEL_NAME_KEY[lastChannel]) })}
          />
        ) : null}
      </Stack>

      {/* ——— sherpa 模型选择（只有真的部署了才有得选） ——— */}
      {tts.sherpaModels.length > 0 ? (
        <TextField
          select
          label={t('voice.field.sherpaModel')}
          value={tts.sherpaModelId ?? ''}
          onChange={(event) => tts.setSherpaModelId(event.target.value)}
          size="small"
          fullWidth
          sx={{ mb: 2 }}
        >
          {tts.sherpaModels.map((model) => (
            <MenuItem key={model.id} value={model.id}>
              {model.label}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <Paper variant="outlined" sx={{ p: 1.25, mb: 2 }}>
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.75 }}>
            {`${t('voice.hint.sherpaNotDeployed')} ${t('alt.onnxOptional')}`}
          </Typography>
        </Paper>
      )}

      {/* ——— 试听文本 ——— */}
      <TextField
        label={t('voice.field.testText')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        multiline
        minRows={3}
        fullWidth
        sx={{ mb: 1.5 }}
      />

      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          disabled={tts.speaking || tts.loading || text.trim() === ''}
          onClick={() => void handleSpeak()}
          sx={{ minHeight: 44 }}
        >
          {t('common.preview')}
        </Button>
        <Button
          variant="outlined"
          startIcon={<StopIcon />}
          onClick={tts.stop}
          disabled={!tts.speaking}
          sx={{ minHeight: 44 }}
        >
          {/* ★ 这里是「停止播放」这个动作，不是「关掉开关」：common.off 语义不对，用 voice.action.stop */}
          {t('voice.action.stop')}
        </Button>
      </Stack>

      {tts.loading ? (
        <Typography variant="caption" sx={{ display: 'block', mt: 1, opacity: 0.7 }}>
          {t('loading.default')}
        </Typography>
      ) : null}

      <Divider sx={{ my: 3 }} />

      {/* ——— 音色管理（FN-55 / PG-04） ——— */}
      <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
        {t('settings.group.voice')}
      </Typography>
      <TimbreManager />
    </Box>
  );
}
