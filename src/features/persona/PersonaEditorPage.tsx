import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { CapabilityGate } from '@/components/CapabilityGate';
import { blobRepo } from '@/db/repo/blobRepo';
import { personaRepo } from '@/db/repo/personaRepo';
import { timbreRepo } from '@/db/repo/timbreRepo';
import { usePersonaStore } from '@/store/personaStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSnack } from '@/hooks/useSnack';
import { DEFAULT_PERSONA_PRIVACY } from '@/constants/defaults';
import { newId } from '@/lib/id';
import { assertFileSize } from '@/lib/file';
import { toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { t } from '@/copy';
import { sl } from '@/features/settings/settingsCopy';
import { pl, CHARA_FIELD_HINT, CHARA_FIELD_ORDER } from './personaCopy';
import { tryAssertImageAllowed } from '@/persona/PersonaCompiler';
import type { ImageGenSettings, PersonaCard, PersonaCardData, PortraitRef } from '@/types/persona';
import type { UUID } from '@/types/common';

/**
 * 角色编辑器（FN-51 角色模型 / FN-52 立绘 / FN-55 音色 / FN-50 文生图 / XR-06 隐私红线）。
 *
 * ★ 可编辑范围：`chara_card_v2` 的 **9 个核心字段** + tags + 音色 + 立绘 + 隐私 + 文生图参数。
 * ★ 隐私红线（XR-06，不可协商）：
 *   - 欣然的「文生图」入口**直接隐藏**（验收③）；立绘入口同样不给她；
 *   - 欣然的 `privacy.noImage` 开关锁定为开，`personaRepo.setPrivacy` 在 repo 层还会再拦一次。
 */

export interface PersonaEditorPageProps {
  open: boolean;
  /** null = 新建；UUID = 编辑；undefined 时由 `open` 决定 */
  personaId: UUID | null;
  onClose: () => void;
  onSaved?: () => void;
}

interface Draft {
  data: PersonaCardData;
  tagsText: string;
  timbreId: string;
  modelId: string;
  noImage: boolean;
  imageGen: ImageGenSettings;
  portrait: PortraitRef[] | undefined;
}

const EMPTY_DATA: PersonaCardData = {
  name: '',
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  system_prompt: '',
  post_history_instructions: '',
  creator_notes: '',
  tags: [],
  character_book: { entries: [] },
};

function emptyImageGen(fallback: ImageGenSettings): ImageGenSettings {
  return {
    provider: fallback.provider,
    model: fallback.model,
    size: fallback.size,
    promptTemplate: fallback.promptTemplate,
    negativePrompt: fallback.negativePrompt ?? '',
  };
}

function toDraft(card: PersonaCard | undefined, fallbackImageGen: ImageGenSettings): Draft {
  if (!card) {
    return {
      data: { ...EMPTY_DATA },
      tagsText: '',
      timbreId: '',
      modelId: '',
      // ★ 新建草稿的默认保守值取单一真源，别再写一份字面量
      noImage: DEFAULT_PERSONA_PRIVACY.noImage,
      imageGen: emptyImageGen(fallbackImageGen),
      portrait: undefined,
    };
  }
  return {
    data: { ...EMPTY_DATA, ...card.data, tags: card.data.tags ?? [] },
    tagsText: (card.data.tags ?? []).join(', '),
    timbreId: card.timbreId ?? '',
    modelId: card.modelId ?? '',
    // ★ 导入/新建的默认保守值：默认不许生图，用户自己放开（欣然的由 repo 兜死）
    //   取单一真源 DEFAULT_PERSONA_PRIVACY，避免与 repo / importer / migrations 各写一份
    noImage: card.privacy?.noImage ?? DEFAULT_PERSONA_PRIVACY.noImage,
    imageGen: card.imageGen ?? emptyImageGen(fallbackImageGen),
    portrait: card.portrait,
  };
}

export function PersonaEditorPage({ open, personaId, onClose, onSaved }: PersonaEditorPageProps): JSX.Element {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const snack = useSnack();

  const providers = useSettingsStore((s) => s.settings.providers);
  const fallbackImageGen = useSettingsStore((s) => s.settings.chat.imageGen);

  const [card, setCard] = useState<PersonaCard | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(() => toDraft(undefined, fallbackImageGen));
  const [timbres, setTimbres] = useState<Array<{ id: UUID; name: string }>>([]);
  const [busy, setBusy] = useState<boolean>(false);

  // 打开时加载：编辑 → 取卡；新建 → 空草稿
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      if (personaId) {
        const res = await personaRepo.get(personaId);
        if (!alive) return;
        const loaded = res.ok ? res.value : undefined;
        setCard(loaded);
        setDraft(toDraft(loaded, fallbackImageGen));
        if (!res.ok) log.warn('persona', '读取角色失败', res.error, 'FN-51');
      } else {
        setCard(undefined);
        setDraft(toDraft(undefined, fallbackImageGen));
      }
      const list = await timbreRepo.listAll();
      if (!alive) return;
      setTimbres(list.ok ? list.value.map((v) => ({ id: v.id, name: v.name })) : []);
    })();
    return () => {
      alive = false;
    };
  }, [open, personaId, fallbackImageGen]);

  const isXinran = card?.isBuiltin === true || card?.origin === 'xinran';
  /** 隐私红线：欣然永远不许生图（FN-50 / XR-06） */
  const imageAllowed = card ? tryAssertImageAllowed(card) : true;
  /**
   * ★ XR-06 的 UI 层残留修复：`privacy.noImage === true` 时文生图参数**必须锁死**，
   *   不能只靠 `llm/imageGen.ts` 调用时抛 PRIVACY_BLOCK——那样用户能填、能点，
   *   点了才知道不行（PM 验收 §10.4 指出的残留）。repo 层仍有第二道拦截。
   */
  const imageGenLocked = draft.noImage;

  const patchData = useCallback(<K extends keyof PersonaCardData>(key: K, value: PersonaCardData[K]): void => {
    setDraft((prev) => ({ ...prev, data: { ...prev.data, [key]: value } }));
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    const name = draft.data.name.trim();
    if (!name) {
      snack.error('err.importInvalid');
      return;
    }
    setBusy(true);
    try {
      const data: PersonaCardData = {
        ...draft.data,
        name,
        tags: draft.tagsText
          .split(/[,，、\n]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      };

      let targetId: UUID;
      if (card) {
        const res = await personaRepo.updateData(card.id, data);
        if (!res.ok) throw res.error;
        targetId = card.id;
      } else {
        const created = await usePersonaStore.getState().create(name, data);
        targetId = created.id;
      }

      // 音色（FN-55）与模型（FN-51）
      const patchRes = await personaRepo.patch(targetId, {
        timbreId: draft.timbreId || undefined,
        modelId: draft.modelId || undefined,
        imageGen: draft.imageGen as unknown as Record<string, unknown>,
      });
      if (!patchRes.ok) throw patchRes.error;

      // 隐私开关：欣然会被 repo 拒绝，这里先自己挡一次（XR-06）
      if (!isXinran) {
        const privacyRes = await personaRepo.setPrivacy(targetId, draft.noImage);
        if (!privacyRes.ok) throw privacyRes.error;
      }

      // 立绘（FN-52）：只存引用，图在 blobs
      if (!isXinran) {
        const portraitRes = await personaRepo.setPortrait(targetId, draft.portrait);
        if (!portraitRes.ok) throw portraitRes.error;
      }

      await usePersonaStore.getState().reload();
      snack.success('ok.saved');
      onSaved?.();
      onClose();
    } catch (e) {
      const err = toAppError(e, 'DB_FAILED');
      snack.error(err.code === 'PRIVACY_BLOCK' ? 'err.privacyBlock' : 'err.dbFailed');
      log.warn('persona', '保存角色失败', err, 'FN-51');
    } finally {
      setBusy(false);
    }
  }, [card, draft, isXinran, onClose, onSaved, snack]);

  /** 立绘上传（FN-52）：写 blobs 后只存引用 */
  const handlePortraitPick = useCallback(
    async (file: File): Promise<void> => {
      if (isXinran) {
        snack.error('err.privacyBlock');
        return;
      }
      try {
        assertFileSize(file);
        const id = card?.id ?? `draft-${newId()}`;
        const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
        const path = `portraits/${id}/${newId()}.${ext}`;
        const res = await blobRepo.put(path, file, file.type || 'image/png');
        if (!res.ok) throw res.error;
        setDraft((prev) => ({
          ...prev,
          portrait: [{ type: 'image', assetId: res.value, opacity: 1, scale: 1 }],
        }));
        snack.success('ok.saved');
      } catch (e) {
        snack.error('err.dbFailed');
        log.warn('persona', '上传立绘失败', toAppError(e), 'FN-52');
      }
    },
    [card?.id, isXinran, snack],
  );

  const fieldRows = useMemo(
    () =>
      CHARA_FIELD_ORDER.map((field) => ({
        field,
        hint: CHARA_FIELD_HINT[field],
        multiline: field !== 'name' && field !== 'description',
      })),
    [],
  );

  return (
    <Dialog open={open} onClose={onClose} fullScreen={narrow} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {card ? pl('page.personaEditor.title') : pl('page.personaEditor.new')}
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label={t('common.close')} sx={{ minWidth: 44, minHeight: 44 }}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {isXinran ? (
          <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
            {t('tip.privacyNoImage')}
          </Alert>
        ) : null}

        {/* —— chara_card_v2 的 9 个核心字段 —— */}
        <Stack spacing={2}>
          {fieldRows.map(({ field, hint, multiline }) => (
            <TextField
              key={field}
              label={field}
              value={String(draft.data[field] ?? '')}
              onChange={(e) => patchData(field, e.target.value as PersonaCardData[typeof field])}
              multiline={multiline}
              minRows={multiline ? 3 : 1}
              maxRows={multiline ? 12 : 1}
              fullWidth
              size="small"
              disabled={busy}
              helperText={hint ? pl(hint) : undefined}
              InputLabelProps={{ shrink: true }}
            />
          ))}

          <TextField
            label={pl('label.personaTags')}
            value={draft.tagsText}
            onChange={(e) => setDraft((prev) => ({ ...prev, tagsText: e.target.value }))}
            fullWidth
            size="small"
            disabled={busy}
            helperText={pl('hint.tags')}
          />
        </Stack>

        <Divider sx={{ my: 2.5 }} />

        {/* —— Web 扩展项：模型 / 音色 / 立绘 / 隐私 / 文生图 —— */}
        <Stack spacing={2}>
          <FormControl fullWidth size="small" disabled={busy}>
            <InputLabel id="persona-model-label">{sl('label.personaModel')}</InputLabel>
            <Select
              labelId="persona-model-label"
              label={sl('label.personaModel')}
              value={draft.modelId}
              onChange={(e) => setDraft((prev) => ({ ...prev, modelId: String(e.target.value) }))}
            >
              <MenuItem value="">{sl('ui.notSet')}</MenuItem>
              {providers.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {`${p.name} · ${p.model}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small" disabled={busy || timbres.length === 0}>
            <InputLabel id="persona-timbre-label">{sl('label.timbre')}</InputLabel>
            <Select
              labelId="persona-timbre-label"
              label={sl('label.timbre')}
              value={draft.timbreId}
              onChange={(e) => setDraft((prev) => ({ ...prev, timbreId: String(e.target.value) }))}
            >
              <MenuItem value="">{sl('ui.notSet')}</MenuItem>
              {timbres.map((v) => (
                <MenuItem key={v.id} value={v.id}>
                  {v.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* —— 立绘（FN-52）：★ 欣然不给这个入口 —— */}
          {isXinran ? null : (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Typography variant="body2" sx={{ minWidth: 96 }}>
                {sl('label.portrait')}
              </Typography>
              <Button variant="outlined" component="label" sx={{ minHeight: 44 }} disabled={busy}>
                {t('common.upload')}
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void handlePortraitPick(file);
                  }}
                />
              </Button>
              <Button
                variant="text"
                sx={{ minHeight: 44 }}
                disabled={busy || !draft.portrait || draft.portrait.length === 0}
                onClick={() => {
                  setDraft((prev) => ({ ...prev, portrait: undefined }));
                  snack.success('ok.portraitCleared');
                }}
              >
                {sl('label.clearPortrait')}
              </Button>
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {draft.portrait && draft.portrait.length > 0 ? t('common.enabled') : sl('ui.notSet')}
              </Typography>
            </Stack>
          )}

          {/* —— 隐私红线（XR-06）—— */}
          <FormControlLabel
            control={
              <Switch
                checked={draft.noImage}
                disabled={busy || isXinran}
                onChange={(e) => setDraft((prev) => ({ ...prev, noImage: e.target.checked }))}
              />
            }
            label={pl('label.personaPrivacy')}
          />
          {isXinran ? (
            <Typography variant="caption" sx={{ opacity: 0.7, mt: -1 }}>
              {pl('hint.personaPrivacy')}
            </Typography>
          ) : null}

          {/* —— 角色文生图（FN-50）：★ 欣然隐藏；其余角色走能力闸门 —— */}
          {/*
            ★ 欣然走「整段隐藏」（下面 isXinran ? null），这段根本不渲染，
              所以 imageGenLocked 对上述四个字段**只对非内置角色生效**——
              不是漏写禁用，是这一段对欣然没有求值机会。
          */}
          {isXinran ? null : (
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                {sl('label.personaImageGen')}
              </Typography>
              <CapabilityGate featureId="FN-50">
                <Stack spacing={1.5}>
                  <TextField
                    label={pl('label.imageProvider')}
                    value={draft.imageGen.provider}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, imageGen: { ...prev.imageGen, provider: e.target.value } }))
                    }
                    size="small"
                    fullWidth
                    disabled={busy || imageGenLocked}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label={pl('label.imageModel')}
                    value={draft.imageGen.model}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, imageGen: { ...prev.imageGen, model: e.target.value } }))
                    }
                    size="small"
                    fullWidth
                    disabled={busy || imageGenLocked}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label={pl('label.imageSize')}
                    value={draft.imageGen.size}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, imageGen: { ...prev.imageGen, size: e.target.value } }))
                    }
                    size="small"
                    fullWidth
                    disabled={busy || imageGenLocked}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label={pl('label.imagePromptTemplate')}
                    value={draft.imageGen.promptTemplate}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        imageGen: { ...prev.imageGen, promptTemplate: e.target.value },
                      }))
                    }
                    size="small"
                    fullWidth
                    multiline
                    minRows={2}
                    disabled={busy || imageGenLocked}
                    InputLabelProps={{ shrink: true }}
                  />
                  {/* 原因直接进 Alert 正文：Tooltip 只在 hover/长按可达，
                      触屏与读屏都拿不到，等于锁因不可达 */}
                  {draft.noImage ? (
                    <Alert severity="warning" variant="outlined">
                      {pl('hint.imageGenLocked')}
                    </Alert>
                  ) : null}
                </Stack>
              </CapabilityGate>
              {!imageAllowed ? (
                <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                  {t('err.privacyBlock')}
                </Typography>
              ) : null}
            </Box>
          )}

          {/* 世界书：只读展示（编辑入口在蒸馏那边） */}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {pl('label.personaWorldBook')}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {`${(draft.data.character_book?.entries ?? []).length} · ${pl('hint.personaWorldBook')}`}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} color="inherit" sx={{ minHeight: 44 }} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={busy || draft.data.name.trim().length === 0}
          sx={{ minHeight: 44 }}
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default PersonaEditorPage;
