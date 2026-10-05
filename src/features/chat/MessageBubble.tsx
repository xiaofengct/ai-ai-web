import { memo } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import FavoriteIcon from '@mui/icons-material/Favorite';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ForwardIcon from '@mui/icons-material/Forward';
import CallMergeIcon from '@mui/icons-material/CallMerge';
import { MarkdownView } from '@/components/MarkdownView';
import { StickerImage } from '@/components/StickerImage';
import { formatClock } from '@/lib/time';
import { t } from '@/copy';
import { to } from '@/router/paths';
import type { Message } from '@/types/chat';

/**
 * 单条消息气泡（架构文档 §2 `src/features/chat/MessageBubble.tsx`）。
 *
 * ★ 三条硬约束：
 * 1. **流式内容从 `streamingText` 取**，不从 `message.content`——
 *    库里为了节流只写了最后一次快照，逐字渲染必须读内存里的增量；
 * 2. `system` 角色的消息（拍一拍 / 总结锚点）渲染成**居中提示条**而不是气泡，
 *    否则用户会以为「她在说一句看不懂的话」；
 * 3. 昵称违规只**标注**（底部一行小字），绝不改写正文（nicknameGuard 的铁律）。
 */

export interface MessageBubbleProps {
  message: Message;
  /** 流式的实时文本（仅当 message.id === streamingId 时生效） */
  streamingText?: string;
  isStreaming?: boolean;
  markdown?: boolean;
  selectable?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  onToggleSelect?: (id: string) => void;
  onOpenActions?: (id: string) => void;
}

function MessageBubbleInner({
  message,
  streamingText,
  isStreaming = false,
  markdown = true,
  selectable = false,
  selected = false,
  highlighted = false,
  onToggleSelect,
  onOpenActions,
}: MessageBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const body = isStreaming ? (streamingText ?? message.content) : message.content;

  /* —— 系统提示条：拍一拍 / 总结锚点 —— */
  if (isSystem) {
    if (!body.trim()) return <Box />;
    return (
      <Stack alignItems="center" sx={{ py: 0.5 }}>
        <Chip size="small" variant="outlined" label={body} sx={{ maxWidth: '84%', height: 'auto', py: 0.5 }} />
      </Stack>
    );
  }

  return (
    <Stack
      direction="row"
      justifyContent={isUser ? 'flex-end' : 'flex-start'}
      sx={{ px: 1.5, py: 0.5 }}
    >
      <Box
        // ★ 锚点 id：长按/点击后 ChatPage 用它把操作菜单挂到这条消息上（而不是挂到 body）
        id={`msg-anchor-${message.id}`}
        onClick={() => (selectable ? onToggleSelect?.(message.id) : onOpenActions?.(message.id))}
        sx={{
          maxWidth: '82%',
          cursor: 'pointer',
          // ★ 高亮：从搜索结果跳转过来时，让用户一眼看到「是这条」
          outline: highlighted ? '2px solid' : 'none',
          outlineColor: 'primary.main',
          borderRadius: 3,
        }}
      >
        <Paper
          elevation={selected ? 3 : 0}
          variant={selected ? 'elevation' : 'outlined'}
          sx={{
            px: 1.5,
            py: 1,
            borderRadius: 3,
            bgcolor: isUser ? 'primary.main' : 'background.paper',
            color: isUser ? 'primary.contrastText' : 'text.primary',
            borderColor: selected ? 'primary.main' : 'divider',
          }}
        >
          {/* —— 标签行：主动消息 / 转发 / 合并 —— */}
          {(message.proactive || message.forwardedFrom || message.mergedFrom) && (
            <Stack direction="row" spacing={0.75} sx={{ mb: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
              {message.proactive ? (
                <Chip
                  size="small"
                  icon={<AutoAwesomeIcon />}
                  label={t('chat.proactiveTag')}
                  sx={{ height: 20, fontSize: 11 }}
                />
              ) : null}
              {message.forwardedFrom ? (
                <Chip
                  size="small"
                  icon={<ForwardIcon />}
                  label={t('chat.forwardFrom')}
                  sx={{ height: 20, fontSize: 11 }}
                />
              ) : null}
              {message.mergedFrom && message.mergedFrom.length > 0 ? (
                <Chip
                  size="small"
                  icon={<CallMergeIcon />}
                  label={t('chat.mergedCount', { count: message.mergedFrom.length })}
                  sx={{ height: 20, fontSize: 11 }}
                />
              ) : null}
            </Stack>
          )}

          {/* —— 正文 —— */}
          {isUser || !markdown ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {body}
              {isStreaming ? '▌' : ''}
            </Typography>
          ) : (
            <Box sx={{ wordBreak: 'break-word' }}>
              <MarkdownView content={body} enabled streaming={isStreaming} dense />
            </Box>
          )}

          {/* —— 附件 —— */}
          {/*
            ★★ 表情附件走**图片**，其余附件仍走 Chip（2026-10-04 改）。
            改之前所有附件一律渲染成一行 Chip（`label={att.name ?? att.kind}`）——
            对 pdf/zip 这类文件是对的，但**表情包渲染成文字就等于没发**：
            用户发一张"生气"的表情，屏幕上出现的是"生气"两个字。
            那正是旧版的问题（`StickerPicker` 也只有文字）。
            ⇒ 表情走 `StickerImage`（大图、可点），其余保持 Chip 不变。
              最小改动：只分流 `kind === 'sticker'` 这一支。
          */}
          {message.attachments && message.attachments.length > 0 ? (
            <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.75 }}>
              {message.attachments.map((att) => {
                if (att.kind === 'sticker') return (
                  <Box
                    key={att.id}
                    component="a"
                    href={to.preview(att.assetId)}
                    sx={{ display: 'block', cursor: 'pointer' }}
                  >
                    <StickerImage
                      item={{ description: att.name ?? '表情', fileName: att.name ?? 'sticker', assetId: att.assetId }}
                      size={96}
                    />
                  </Box>
                );
                /**
                 * ★★ 照片渲染成**缩略图**（2026-10-04 改）。
                 *
                 * 改之前，照片和 pdf/zip 一样只是一个小 Chip（写文件名）——
                 * 聊天气泡里看到的是「photo-1759600000.jpg」这样一串字，
                 * **用户根本看不到自己发了什么**。对"发照片给 AI"这个场景来说，
                 * 那等于没显示。
                 * ⇒ 照片走缩略图（180px，点击进大图预览），其余附件保持 Chip。
                 *   180px 是权衡：手机上两列并排刚好，太大的话一张图就占满整屏。
                 */
                if (att.kind === 'image') return (
                  <Box
                    key={att.id}
                    component="a"
                    href={to.preview(att.assetId)}
                    sx={{ display: 'block', cursor: 'pointer' }}
                  >
                    <StickerImage
                      item={{ description: att.name ?? '图片', fileName: att.name ?? 'photo', assetId: att.assetId }}
                      size={180}
                    />
                  </Box>
                );
                return (
                  <Chip
                    key={att.id}
                    size="small"
                    label={att.name ?? att.kind}
                    component="a"
                    href={undefined}
                    sx={{ height: 22, fontSize: 11 }}
                  />
                );
              })}
            </Stack>
          ) : null}

          {/* —— 脚注：时间 / 收藏 / 昵称标注 —— */}
          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            sx={{ mt: 0.5, opacity: 0.65, flexWrap: 'wrap', gap: 0.5 }}
          >
            <Typography variant="caption" sx={{ fontSize: 11 }}>
              {formatClock(message.createdAt)}
            </Typography>
            {message.favorite ? <FavoriteIcon sx={{ fontSize: 12, color: 'primary.main' }} /> : null}
            {message.status === 'failed' ? (
              <Typography variant="caption" sx={{ fontSize: 11, color: 'error.main' }}>
                {t('common.retry')}
              </Typography>
            ) : null}
            {message.nicknameWarnings && message.nicknameWarnings.length > 0 ? (
              <Typography
                variant="caption"
                sx={{ fontSize: 11, color: 'warning.main' }}
                title={message.nicknameWarnings.join('；')}
              >
                {t('chat.nicknameWarn')}
              </Typography>
            ) : null}
          </Stack>
        </Paper>
      </Box>
    </Stack>
  );
}

export const MessageBubble = memo(MessageBubbleInner);
export default MessageBubble;
