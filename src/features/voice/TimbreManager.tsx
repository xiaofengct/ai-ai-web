/**
 * ★★ A 档（走文案表）。本组件**曾随 `VoiceTestPage` 一起被误判成 B 档，已一并纠正**。
 *
 * 原 B 档理由有两条，两条都不成立：
 *   ① 「唯一使用方是诊断台，随它走开发者通路」——但 `设置 → 语音 → 去试听` 是一级用户路径，
 *      诊断台本身就在用户视野里（纠正过程见 `VoiceTestPage.tsx` 头部）；
 *   ② 「这些是给配置的人看的字段名」——**配置的人也是用户**。判据是「会不会渲染到 DOM」，
 *      不是「看的人懂不懂技术」。
 *
 * ★ 但有一条例外必须守住，且**不因改成中文而弱化**：`voiceId` 的 helperText 原来写着
 *   「fixed speaker id / cloud voice id — not voice cloning」——这是**如实披露**
 *   「固定音色编号 ≠ 声音克隆」，属于产品承诺。现在它变成 `voice.timbre.voiceIdHelper`，
 *   **语义一个字没减**。豁免的是"要不要走文案表"，不是"能不能不如实说"。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { EmptyState } from '@/components/EmptyState';
import { blobRepo } from '@/db/repo/blobRepo';
import { timbreRepo } from '@/db/repo/timbreRepo';
import { useSnack } from '@/hooks/useSnack';
import { log } from '@/store/logStore';
import { XINRAN_GREETINGS, XINRAN_NAME, t } from '@/copy';
import type { CopyKey } from '@/copy/keys';
import type { VoiceTimbre } from '@/types/media';
import type { UUID } from '@/types/common';
import { useTTS } from './useTTS';

/**
 * 音色管理（FN-55 / PG-04）。
 *
 * ★ 三种音色来源，对应 `VoiceTimbre.provider`：
 * | provider | 含义 | 试听方式 |
 * |---|---|---|
 * | `web-speech` | 浏览器系统音色 | `speechSynthesis`，零成本 |
 * | `siliconflow` | 云端 voiceId（用户自备 Key） | 云端 TTS 合成 |
 * | `custom` | 上传的参考 mp3 + 端侧模型 | **参考音只能回放**；要实时合成需 sherpa 模型（见下） |
 *
 * ★★ 能力边界必须如实标注（PRD §11 / 能力表 FN-55）：
 *   端侧用的是模型自带的**固定 speaker id**，
 *   **不等价于**原 App 的硅基流动语音克隆——英文技术说明写在界面上，中文降级说明走 `alt.ttsFallback`。
 */

/**
 * ★ 同 `VoiceTestPage` 的做法：技术 id（'web-speech' 等）只留在数据层，展示层走文案映射。
 *   用 `Record<VoiceTimbre['provider'], _>` 让"新增提供方忘了配文案"变成编译错误。
 */
const PROVIDERS: readonly VoiceTimbre['provider'][] = ['web-speech', 'siliconflow', 'custom'];

const PROVIDER_NAME_KEY: Record<VoiceTimbre['provider'], CopyKey> = {
  'web-speech': 'voice.timbre.provider.webSpeech',
  siliconflow: 'voice.timbre.provider.siliconflow',
  custom: 'voice.timbre.provider.custom',
};

const PROVIDER_HINT_KEY: Record<VoiceTimbre['provider'], CopyKey> = {
  'web-speech': 'voice.timbre.providerHint.webSpeech',
  siliconflow: 'voice.timbre.providerHint.siliconflow',
  custom: 'voice.timbre.providerHint.custom',
};

export interface TimbreManagerProps {
  /** 当前选中的音色 id */
  selectedId?: UUID;
  /**
   * 选中变化回调。
   * ★ 现状（2026-10-04 由 software-engineer-5 查出、software-engineer-4 复核确认）：
   *   **唯一的调用点 `VoiceTestPage.tsx:224` 是不传任何 props 的 `<TimbreManager />`**，
   *   所以 `selectedId` / `onSelect` 目前**都没有人传**，`settings.voice.defaultTimbreId`
   *   **全仓无读无写**（只有 `types/settings.ts:113` 的类型声明）——音色选择不会被记住。
   * ⚠ 旧注释写的是"父页面写回 `settings.voice.defaultTimbreId`"，那是**没有代码支撑的断言**，已订正。
   *   若将来要接上持久化，改**这里**加 `onSelect` 调用方 + 在设置侧写回，不要只改本文件。
   */
  onSelect?: (id: UUID) => void;
}

export default function TimbreManager({ selectedId, onSelect }: TimbreManagerProps): JSX.Element {
  const snack = useSnack();
  const tts = useTTS();

  const [items, setItems] = useState<VoiceTimbre[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [name, setName] = useState<string>('');
  const [provider, setProvider] = useState<VoiceTimbre['provider']>('web-speech');
  const [voiceId, setVoiceId] = useState<string>('');
  const [sampleText, setSampleText] = useState<string>('');
  const [refFile, setRefFile] = useState<File | undefined>(undefined);
  const [busy, setBusy] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await timbreRepo.listAll();
    if (!res.ok) {
      snack.error('err.dbFailed');
      setItems([]);
    } else {
      setItems(res.value);
    }
    setLoading(false);
  }, [snack]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 新增音色：参考音先落 blobs，再写 timbres 表 */
  const handleAdd = useCallback(async () => {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      const created = await timbreRepo.create({
        name: name.trim(),
        provider,
        externalVoiceId: voiceId.trim() === '' ? undefined : voiceId.trim(),
        sampleText: sampleText.trim() === '' ? undefined : sampleText.trim(),
      });
      if (!created.ok) {
        snack.error('err.dbFailed');
        return;
      }
      const timbre = created.value;

      // 参考 mp3：路径约定 `timbres/{id}.mp3`
      if (refFile) {
        const put = await blobRepo.put(`timbres/${timbre.id}.mp3`, refFile, refFile.type || 'audio/mpeg');
        if (!put.ok) {
          snack.error('err.dbFailed');
          return;
        }
        const patched = await timbreRepo.upsert({ ...timbre, refAssetId: put.value });
        if (!patched.ok) {
          snack.error('err.dbFailed');
          return;
        }
      }

      log.info('voice', 'timbre created', { provider, id: timbre.id }, 'FN-55');
      setName('');
      setVoiceId('');
      setSampleText('');
      setRefFile(undefined);
      if (fileInputRef.current) fileInputRef.current.value = '';
      snack.success('ok.saved');
      await reload();
    } finally {
      setBusy(false);
    }
  }, [name, provider, voiceId, sampleText, refFile, snack, reload]);

  /** 试听：有参考音就回放参考音（端侧合成未必可用），否则走合成 */
  const handlePreview = useCallback(
    async (timbre: VoiceTimbre) => {
      if (timbre.refAssetId) {
        const res = await blobRepo.getObjectURL(timbre.refAssetId);
        if (!res.ok || !res.value) {
          snack.error('err.ttsFailed');
          return;
        }
        const audio = new Audio(res.value);
        audio.onended = () => URL.revokeObjectURL(res.value as string);
        void audio.play().catch(() => snack.error('err.ttsFailed'));
        return;
      }

      // 试听文本：优先音色自带的 sampleText，兜底取欣然的欢迎语（文案一律来自 copy 层）
      const sample = timbre.sampleText ?? XINRAN_GREETINGS[0] ?? XINRAN_NAME;
      const used = await tts.speak(sample, {
        timbreId: timbre.id,
        rate: timbre.speed ?? 1,
        pitch: timbre.pitch ?? 1,
      });
      if (tts.failed) {
        snack.error('err.ttsFailed');
        return;
      }
      log.debug('voice', `timbre preview, actual channel ${used}`, { id: timbre.id }, 'PG-04');
    },
    [tts, snack],
  );

  const handleDelete = useCallback(
    async (timbre: VoiceTimbre) => {
      const res = await timbreRepo.remove(timbre.id);
      if (!res.ok) {
        snack.error('err.dbFailed');
        return;
      }
      if (timbre.refAssetId) await blobRepo.remove(timbre.refAssetId);
      snack.success('ok.deleted');
      await reload();
    },
    [snack, reload],
  );

  return (
    <Box sx={{ width: '100%' }}>
      {/* ——— 新增音色 ——— */}
      <Stack spacing={1.25}>
        <TextField
          label={t('voice.timbre.field.name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          select
          label={t('voice.timbre.provider')}
          value={provider}
          onChange={(event) => setProvider(event.target.value as VoiceTimbre['provider'])}
          size="small"
          fullWidth
        >
          {PROVIDERS.map((option) => (
            <MenuItem key={option} value={option}>
              {t('voice.timbre.option', {
                name: t(PROVIDER_NAME_KEY[option]),
                hint: t(PROVIDER_HINT_KEY[option]),
              })}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={t('voice.timbre.field.voiceId')}
          value={voiceId}
          onChange={(event) => setVoiceId(event.target.value)}
          size="small"
          fullWidth
          // ★ 如实披露（见文件头）：固定音色编号 ≠ 声音克隆。改成中文，语义不减。
          helperText={t('voice.timbre.voiceIdHelper')}
        />
        <TextField
          label={t('voice.timbre.field.sampleText')}
          value={sampleText}
          onChange={(event) => setSampleText(event.target.value)}
          size="small"
          fullWidth
          multiline
          minRows={2}
        />

        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            startIcon={<PlayArrowIcon />}
            onClick={() => fileInputRef.current?.click()}
          >
            {`${t('common.upload')} mp3`}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3"
            hidden
            onChange={(event) => setRefFile(event.target.files?.[0])}
          />
          <Typography variant="caption" sx={{ opacity: 0.7 }}>
            {refFile ? refFile.name : t('ui.noMatchedFile')}
          </Typography>
        </Stack>

        <Button
          variant="contained"
          size="small"
          disabled={busy || name.trim() === ''}
          onClick={() => void handleAdd()}
          sx={{ minHeight: 44 }}
        >
          {t('common.add')}
        </Button>
      </Stack>

      <Divider sx={{ my: 2 }} />

      {/* ——— 已有音色 ——— */}
      {!loading && items.length === 0 ? (
        <EmptyState descKey="empty.timbres" dense />
      ) : (
        <Stack spacing={1}>
          {items.map((timbre) => (
            <Stack
              key={timbre.id}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{
                px: 1.25,
                py: 1,
                borderRadius: 2,
                border: 1,
                borderColor: timbre.id === selectedId ? 'primary.main' : 'divider',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {timbre.name}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.65 }} noWrap>
                  {/* ★ provider 的技术 id（'web-speech'）不能直接给用户看，走名称文案映射 */}
                  {`${t(PROVIDER_NAME_KEY[timbre.provider])}${timbre.externalVoiceId ? ` · ${timbre.externalVoiceId}` : ''}`}
                </Typography>
              </Box>

              {timbre.refAssetId ? (
                <Chip size="small" label={t('voice.timbre.field.refMp3')} variant="outlined" />
              ) : null}

              <Tooltip title={t('common.preview')} arrow>
                <IconButton size="small" onClick={() => void handlePreview(timbre)}>
                  <PlayArrowIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              {onSelect ? (
                <Button
                  size="small"
                  variant={timbre.id === selectedId ? 'contained' : 'text'}
                  onClick={() => onSelect(timbre.id)}
                >
                  {timbre.id === selectedId ? t('common.enabled') : t('common.open')}
                </Button>
              ) : null}

              <Tooltip title={t('common.delete')} arrow>
                <IconButton size="small" onClick={() => void handleDelete(timbre)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      )}

      {/* ★ 能力边界如实标注：固定 speaker id ≠ 语音克隆 */}
      <Typography variant="caption" sx={{ display: 'block', mt: 2, opacity: 0.7 }}>
        {`fixed speaker id / cloud voiceId — NOT equivalent to the original app's voice cloning. ${t('alt.ttsFallback')}`}
      </Typography>
    </Box>
  );
}
