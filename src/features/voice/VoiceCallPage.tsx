import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import { CapabilityGate } from '@/components/CapabilityGate';
import { useSnack } from '@/hooks/useSnack';
import { t } from '@/copy';
import { llmClient } from '@/llm/client';
import { useSettingsStore } from '@/store/settingsStore';
import { useASR, type AsrChannel } from './useASR';
import { useTTS } from './useTTS';

/**
 * 语音通话页（PG-05 的降级实现）。
 *
 * ★★ 「实时语音」在浏览器里做不到：**改成三段式**
 *   `听（ASR）→ 想（LLM）→ 说（TTS）`，**有明显延迟**。
 *   这一段必须让用户一眼看到（能力表 PG-05 = alternative，文案 `alt.realtimeThreeStage`），
 *   绝不能让人以为这是实时对讲。
 *
 * 三档 ASR / TTS 通道与「语音测试页」一致：sherpa-onnx WASM → 云端 → 系统兜底。
 */

type Stage = 'idle' | 'listening' | 'thinking' | 'speaking' | 'done';

/**
 * 会画成进度 chip 的阶段。
 *
 * ★ 为什么要从 `Stage` 里单独切出来：`Stage` 还有 `idle` / `done` 两个**不展示**的状态。
 *   如果直接写 `Record<Stage, …>`，编译器会逼我为两个永不上屏的状态也配文案——
 *   要么编两条没人看的字，要么留空串。切出可见子集才是准确的建模。
 */
type VisibleStage = 'listening' | 'thinking' | 'speaking';

const STAGE_ORDER: readonly VisibleStage[] = ['listening', 'thinking', 'speaking'];

/**
 * 阶段 → 文案 key。
 *
 * ★ 为什么要有这张映射：`VisibleStage` 是内部枚举名（`listening` / `thinking` / `speaking`），
 *   直接拿它当 chip 的 label 就是把英文枚举渲染给用户——正是本轮在清的英文泄漏。
 *   写成 `Record<VisibleStage, …>` 而不是 switch：**加一个可见阶段、这里少一条就编译报错**，漏不掉。
 */
const STAGE_LABEL_KEY: Record<
  VisibleStage,
  'voice.stage.listening' | 'voice.stage.thinking' | 'voice.stage.speaking'
> = {
  listening: 'voice.stage.listening',
  thinking: 'voice.stage.thinking',
  speaking: 'voice.stage.speaking',
};

export default function VoiceCallPage(): JSX.Element {
  const snack = useSnack();
  const asr = useASR();
  const tts = useTTS();
  const chat = useSettingsStore((s) => s.settings.chat);
  const voice = useSettingsStore((s) => s.settings.voice);
  /**
   * ★ A3′ 第 2 项（2026-10-04）：「语音输入」是否开着。
   *
   * ★★ 判据必须与引擎层闸门**逐字一致**（`useASR.ts` `start()` 开头那一对值）。
   *   如果这里漏了一个条件，就会造出「按钮亮着但点了没反应」——比不置灰更坏。
   *   故本行与引擎层共用同一个布尔表达式的写法，**故意重复而不抽公共函数**：
   *   一处是渲染态（订阅，随设置实时重渲染），一处是动作态（`getState()` 快照），
   *   两者生命周期不同，抽成一个函数反而会诱导后来者以为它们是同一次求值。
   */
  const asrReady = voice.enabled && voice.asr;

  const [stage, setStage] = useState<Stage>('idle');
  const [reply, setReply] = useState<string>('');
  const [manual, setManual] = useState<string>('');

  /** 把识别到的文本交给模型，再把回答念出来 */
  const runPipeline = useCallback(
    async (input: string) => {
      const text = input.trim();
      if (text === '') return;

      setStage('thinking');
      try {
        const answer = await llmClient.complete({
          messages: [
            // 语音场景的临时约束：只影响这一条三段式链路，不进 PersonaCompiler
            { role: 'system', content: 'Reply in short natural spoken Chinese, 1-3 sentences, no Markdown.' },
            { role: 'user', content: text },
          ],
          params: chat.params,
        });
        setReply(answer.trim());
        setStage('speaking');
        await tts.speak(answer.trim(), { rate: 1 });
        setStage('done');
      } catch {
        snack.error('err.llmFailed');
        setStage('done');
      }
    },
    [chat.params, tts, snack],
  );

  /**
   * ① 听：麦克风 → 文本。
   * ★ 结果统一走 `onFinal`：webSpeech 是事件驱动的，
   *   `start()` 会立刻返回，文本要等用户说完才来。
   */
  const handleListen = useCallback(async () => {
    setReply('');
    setStage('listening');
    await asr.start({ onFinal: (text) => void runPipeline(text) });
  }, [asr, runPipeline]);

  // 什么都没识别到（或用户掐断）时把状态收回去，避免一直卡在「听」这一档
  useEffect(() => {
    if (stage !== 'listening') return;
    if (asr.listening || asr.transcript || asr.interim) return;
    const timer = window.setTimeout(() => {
      setStage((prev) => (prev === 'listening' ? 'idle' : prev));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [stage, asr.listening, asr.transcript, asr.interim]);

  const handleStop = useCallback(() => {
    asr.stop();
    tts.stop();
    setStage('idle');
  }, [asr, tts]);

  /** 直接用输入框走后两段（不想说话时的等价路径） */
  const handleSendText = useCallback(async () => {
    if (manual.trim() === '') return;
    await runPipeline(manual);
  }, [manual, runPipeline]);

  const busy = stage === 'listening' || stage === 'thinking' || stage === 'speaking';

  return (
    <Box sx={{ width: '100%', maxWidth: 720, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      {/* ★★ 三段式声明：这不是实时通话 */}
      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
          {t('voice.pipelineTitle')}
        </Typography>
        <Typography variant="body2">{t('alt.realtimeThreeStage')}</Typography>
      </Alert>

      <CapabilityGate featureId="PG-05">
        <Typography variant="caption" sx={{ display: 'block', mb: 2, opacity: 0.75 }}>
          {t('alt.webSpeech')}
        </Typography>
      </CapabilityGate>

      {/* ——— 三段进度 ——— */}
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        {STAGE_ORDER.map((item) => (
          <Chip
            key={item}
            size="small"
            variant={stage === item ? 'filled' : 'outlined'}
            color={stage === item ? 'primary' : 'default'}
            // ★ 阶段名走文案：chip 直接渲染给用户看，写 `listening` 这种枚举名就是英文泄漏
            label={t(STAGE_LABEL_KEY[item])}
          />
        ))}
      </Stack>

      {/* ——— 识别结果 / 回复 ——— */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, minHeight: 96 }}>
        <Typography variant="caption" sx={{ opacity: 0.6 }}>
          {t('voice.panel.asr')}
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {asr.transcript || asr.interim || '—'}
        </Typography>
        <Divider sx={{ my: 1 }} />
        <Typography variant="caption" sx={{ opacity: 0.6 }}>
          {t('voice.panel.reply')}
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {reply || '—'}
        </Typography>
      </Paper>

      {/* ——— 通道选择 ——— */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label={t('voice.channel.asr')}
          value={asr.channel}
          onChange={(event) => asr.setChannel(event.target.value as AsrChannel)}
          sx={{ minWidth: 180 }}
        >
          {/* ★ `value=` 是控制流输入，**不能动**；动的是子节点的展示文案。 */}
          <MenuItem value="sherpaWasm" disabled={!asr.availability.sherpaWasm}>
            {t('voice.channel.sherpaWasm')}
          </MenuItem>
          <MenuItem value="cloud" disabled={!asr.availability.cloud}>
            {t('voice.channel.cloud')}
          </MenuItem>
          <MenuItem value="webSpeech" disabled={!asr.availability.webSpeech}>
            {t('voice.channel.webSpeech')}
          </MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label={t('voice.channel.tts')}
          value={tts.channel}
          onChange={(event) => tts.setChannel(event.target.value as 'sherpaWasm' | 'cloud' | 'webSpeech')}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="sherpaWasm" disabled={!tts.availability.sherpaWasm}>
            {t('voice.channel.sherpaWasm')}
          </MenuItem>
          <MenuItem value="cloud" disabled={!tts.availability.cloud}>
            {t('voice.channel.cloud')}
          </MenuItem>
          <MenuItem value="webSpeech" disabled={!tts.availability.webSpeech}>
            {t('voice.channel.webSpeech')}
          </MenuItem>
        </TextField>
      </Stack>

      {/* ——— 操作 ——— */}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        {/*
          ★★ 麦克风置灰 + 说明（A3′ 第 2 项，2026-10-04）。
            范式抄自 `components/CapabilityGate.tsx:72-90`（Tooltip + 灰化 `span` 包一层），
            **不新造组件**、也**不复用 CapabilityGate 本身**：
            那个组件是**能力表驱动**（按 `featureId` 查 `capabilities.ts`），
            这里要挡的是**设置驱动**（用户自己关的），两种语义混在一个组件里会让
            「这是什么级别不可用」变得说不清。范式相同、数据源不同，故抄范式。

          ★ 为什么必须包一层 `span` 而不是把 Button 直接给 Tooltip：
            `disabled` 的元素不触发鼠标事件，Tooltip 永远弹不出来（MUI 5 会在
            dev 控制台直接报这条错，见 `Tooltip.js:285`）。`span` 承担事件，按钮只管灰。

          ★ 为什么再叠一层「灰化 + `not-allowed`」而不只靠 `disabled`：
            MUI 的 `disabled` 只是变淡；这里要的是**一眼可辨**——「关着，不是坏了」。

          ★ `title` 传空串是**安全**的：MUI Tooltip 在 `!title && title !== 0` 时
            直接返回 children（`Tooltip.js:436`，文档亦写明「零长标题不展示」），
            所以无需条件包裹，一处 JSX 覆盖两态。
        */}
        <Tooltip title={asrReady ? '' : t('voice.asrOffHint')} placement="top" arrow>
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              ...(asrReady ? null : { opacity: 0.45, filter: 'saturate(0.4)', cursor: 'not-allowed' }),
            }}
            aria-disabled={asrReady ? undefined : true}
          >
            <Button
              variant="contained"
              startIcon={<MicIcon />}
              disabled={busy || !asrReady}
              onClick={() => void handleListen()}
              sx={{ minHeight: 44 }}
            >
              {/* ★ 原来是 `common.on`（「开」）——麦克风按钮配「开」语义错位，换成专用文案 */}
              {t('voice.action.start')}
            </Button>
          </Box>
        </Tooltip>
        <Button
          variant="outlined"
          startIcon={<StopIcon />}
          disabled={!busy}
          onClick={handleStop}
          sx={{ minHeight: 44 }}
        >
          {/* ★ 同上：停止按钮配「关」语义错位 */}
          {t('voice.action.stop')}
        </Button>
      </Stack>

      {/* ——— 打字兜底：麦克风不可用时也能走完后两段 ——— */}
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          label={t('voice.input.manual')}
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          fullWidth
        />
        <Button
          variant="text"
          disabled={busy || manual.trim() === ''}
          onClick={() => void handleSendText()}
          sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
        >
          {/* ★ 原来是 `common.next`（「下一步」）——这是「发送」，不是向导的下一步 */}
          {t('voice.action.send')}
        </Button>
      </Stack>

      {/* ——— 错误提示：权限被拒要单独说清楚「去浏览器里开一下」 ——— */}
      {asr.denied ? (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {t('err.microphoneDenied')}
        </Alert>
      ) : null}
      {asr.failed ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {t('err.asrFailed')}
        </Alert>
      ) : null}
      {tts.failed ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {t('err.ttsFailed')}
        </Alert>
      ) : null}
    </Box>
  );
}
