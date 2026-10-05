import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import BackHandIcon from '@mui/icons-material/BackHand';
import CallMergeIcon from '@mui/icons-material/CallMerge';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ImageIcon from '@mui/icons-material/Image';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import SendIcon from '@mui/icons-material/Send';
import SentimentSatisfiedIcon from '@mui/icons-material/SentimentSatisfied';
import StopIcon from '@mui/icons-material/Stop';
import { CapabilityGate } from '@/components/CapabilityGate';
import { StickerPicker } from './StickerPicker';
import { CameraDialog } from './CameraDialog';
import { newId } from '@/lib/id';
import { blobRepo } from '@/db/repo/blobRepo';
import { readBytes } from '@/lib/file';
import { MAX_FILE_SIZE } from '@/constants/limits';
import { useSnack } from '@/hooks/useSnack';
import { t } from '@/copy';
import type { MessageAttachment } from '@/types/chat';
import type { StickerItem } from '@/types/media';
import type { UUID } from '@/types/common';

/**
 * 输入区（架构文档 §2 `src/features/chat/Composer.tsx`）。
 *
 * ★ 三条实现要点：
 * 1. **回车 / 换行的输入法判定**在 `useChatSend.onKeyDown` 里（`isComposing`），
 *    这里只负责把事件透传，不重复实现；
 * 2. 图片附件走 `blobRepo`，**不把 base64 塞进消息内容**——
 *    一条 5MB 的图会直接把 IndexedDB 的消息表撑爆；
 * 3. 发图按钮用 `<CapabilityGate featureId="FN-25">` 包起来，
 *    不可用时自动置灰并给出「为什么」与替代方案，UI 里不写死任何降级判断。
 */

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => boolean;
  sending: boolean;
  canSend: boolean;
  attachments: readonly MessageAttachment[];
  onAddAttachments: (items: readonly MessageAttachment[]) => void;
  onRemoveAttachment: (id: UUID) => void;
  onPat: () => void;
  onMerge: () => void;
  /** 多选态下禁用输入（避免边选边发） */
  disabled?: boolean;
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onKeyDown,
  sending,
  canSend,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  onPat,
  onMerge,
  disabled = false,
}: ComposerProps): JSX.Element {
  const snack = useSnack();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const pickImage = (): void => {
    fileRef.current?.click();
  };

  const onFilePicked = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    const out: MessageAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        snack.error('err.unknown');
        continue;
      }
      const bytes = await readBytes(file);
      const assetId = await blobRepo.put(`chat/${newId()}/${file.name}`, bytes, file.type || 'image/png');
      if (!assetId.ok) continue;
      out.push({
        id: newId(),
        kind: 'image',
        assetId: assetId.value,
        mime: file.type || 'image/png',
        name: file.name,
      });
    }
    if (out.length > 0) onAddAttachments(out);
  };

  /**
   * ★★ 拍照结果 → 待发附件（2026-10-04 加）。
   *
   * ★ 与相册选图走**同一套存储约定**（`blobRepo` + `chat/<随机>/<文件名>`）——
   *   两条来源（相机 / 相册）最终产出的 `MessageAttachment` 完全同构，
   *   下游的渲染、预览、多模态发送都不用区分"这张是拍的还是选的"。
   *   如果给拍照单独开一条路径，就会出现"拍的照片在某些地方显示不出来"这类
   *   只在一条分支上存在的 bug。
   *
   * ★ 体积检查放在这里（而不是相机里）：`MAX_FILE_SIZE` 是**附件层的统一约束**，
   *   所有附件来源都该过同一道闸。相机侧只负责把照片拍出来。
   */
  const onCameraCapture = async (blob: Blob): Promise<void> => {
    if (blob.size > MAX_FILE_SIZE) {
      snack.error('chat.cameraTooLarge');
      return;
    }
    const name = `photo-${Date.now()}.jpg`;
    const assetId = await blobRepo.put(`chat/${newId()}/${name}`, blob, 'image/jpeg');
    if (!assetId.ok) {
      snack.error('err.dbFailed');
      return;
    }
    onAddAttachments([
      { id: newId(), kind: 'image', assetId: assetId.value, mime: 'image/jpeg', name },
    ]);
  };

  const onSticker = (item: StickerItem): void => {
    if (!item.assetId) {
      onChange(`${value}${item.description}`);
      return;
    }
    onAddAttachments([
      {
        id: newId(),
        kind: 'sticker',
        assetId: item.assetId,
        mime: 'image/png',
        name: item.description || item.fileName,
      },
    ]);
  };

  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 1.5, py: 1 }}>
      {/* 附件预览条 */}
      {attachments.length > 0 ? (
        <Stack direction="row" spacing={0.75} sx={{ mb: 1, flexWrap: 'wrap', gap: 0.75 }}>
          {attachments.map((att) => (
            <Box
              key={att.id}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.25,
                borderRadius: 1.5,
                bgcolor: 'action.selected',
                fontSize: 12,
                maxWidth: 180,
              }}
            >
              <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {att.name ?? att.kind}
              </Box>
              <IconButton size="small" onClick={() => onRemoveAttachment(att.id)} aria-label={t('common.delete')}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}
        </Stack>
      ) : null}

      {/*
        ★★ 触控目标统一提到 44px（2026-10-04 修）。
        实测（自动化量出来的）：`IconButton size="small"` 的实际点击区只有 **37×37px**，
        而本项目在别处（`SettingRow` 的 `minHeight: 48`、`MobileTabs` 的 `minHeight: 44`、
        `SettingRow` 注释里"所有触控目标 ≥44px"）都遵守 44px 这条无障碍底线 ——
        **只有聊天输入区这一行漏了**。
        ★ 为什么这一行更该守这条线：输入区是**拇指高频操作区**，
          37px 在移动端属于"要瞄一下才能点准"，而这里恰恰是用户最想盲操的地方。
        ★ 为什么整行一起改、不只改新加的相机按钮：
          只改一个会让那一行按钮**大小参差**（视觉上像坏了），
          而且 44px 对同排的其它按钮同样是真实改进。
        ★ 用 `minWidth/minHeight` 而不是加大 `padding`：padding 会同时撑大图标间距，
          而我们要的是"点击区变大、图标不变"。
      */}
      <Stack direction="row" spacing={0.5} alignItems="flex-end">
        <Tooltip title={t('chat.sticker')}>
          <IconButton
            size="small"
            disabled={disabled}
            onClick={() => setPickerOpen(true)}
            aria-label={t('chat.sticker')}
            sx={{ minWidth: 44, minHeight: 44 }}
          >
            <SentimentSatisfiedIcon />
          </IconButton>
        </Tooltip>

        <CapabilityGate featureId="FN-25">
          <Tooltip title={t('chat.attachImage')}>
            <IconButton
              size="small"
              disabled={disabled}
              onClick={pickImage}
              aria-label={t('chat.attachImage')}
              sx={{ minWidth: 44, minHeight: 44 }}
            >
              <ImageIcon />
            </IconButton>
          </Tooltip>
        </CapabilityGate>

        {/*
          ★★ 相机按钮（2026-10-04 加）。
          位置：紧挨「发图」之后 —— 两者都是"产出图片"的入口，
                放一起用户一眼就知道"想发图就在这一块"，不必在工具栏里找。
          ★ 不套 `<CapabilityGate>`：本项目的 PL-03（CAMERA）在能力表里是 `full`，
            也就是说"这个平台能不能拍照"已经在能力表层面判过了；
            真正的不可用（用户拒绝权限 / 设备没摄像头）是**运行时**才知道的，
            由 `CameraDialog` 按错误分类就地说明 —— 那种情况在按钮上无法预判，
            置灰反而会让用户在不知道原因时无法触发"去授权"的引导。
        */}
        <Tooltip title={t('chat.camera')}>
          <IconButton
            size="small"
            disabled={disabled}
            onClick={() => setCameraOpen(true)}
            aria-label={t('chat.camera')}
            sx={{ minWidth: 44, minHeight: 44 }}
          >
            <PhotoCameraIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('chat.pat')}>
          <IconButton
            size="small"
            disabled={disabled}
            onClick={onPat}
            aria-label={t('chat.pat')}
            sx={{ minWidth: 44, minHeight: 44 }}
          >
            <BackHandIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('chat.merge')}>
          <IconButton
            size="small"
            disabled={disabled}
            onClick={onMerge}
            aria-label={t('chat.merge')}
            sx={{ minWidth: 44, minHeight: 44 }}
          >
            <CallMergeIcon />
          </IconButton>
        </Tooltip>

        <TextField
          multiline
          maxRows={5}
          size="small"
          fullWidth
          value={value}
          disabled={disabled}
          placeholder={t('chat.placeholder')}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            const handled = onKeyDown(e);
            if (handled) e.preventDefault();
          }}
          inputProps={{ 'aria-label': t('chat.placeholder') }}
        />

        {sending ? (
          <Tooltip title={t('chat.stop')}>
            <IconButton color="primary" onClick={onStop} aria-label={t('chat.stop')}>
              <StopIcon />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title={t('chat.send')}>
            <IconButton
              color="primary"
              disabled={!canSend || disabled}
              onClick={() => void onSend()}
              aria-label={t('chat.send')}
            >
              <SendIcon />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void onFilePicked(e.target.files);
          e.target.value = '';
        }}
      />

      <CameraDialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={onCameraCapture}
      />

      <StickerPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPickSticker={onSticker}
        onPickText={(text) => onChange(`${value}${text}`)}
      />
    </Box>
  );
}

/** 多选模式下的批量操作条（删除 / 合并 / 退出） */
export function SelectionBar({
  count,
  onDelete,
  onMerge,
  onExit,
}: {
  count: number;
  onDelete: () => void;
  onMerge: () => void;
  onExit: () => void;
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.5, py: 0.75 }}>
      <Box sx={{ flex: 1, fontSize: 13, opacity: 0.75 }}>{t('chat.selectedCount', { count })}</Box>
      <IconButton size="small" onClick={onMerge} aria-label={t('chat.merge')}>
        <CallMergeIcon />
      </IconButton>
      <IconButton size="small" onClick={onDelete} aria-label={t('common.delete')}>
        <DeleteOutlineIcon />
      </IconButton>
      <IconButton size="small" onClick={onExit} aria-label={t('chat.exitSelect')}>
        <CloseIcon />
      </IconButton>
    </Stack>
  );
}

export default Composer;
