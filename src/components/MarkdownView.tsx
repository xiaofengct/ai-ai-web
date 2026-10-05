import { memo } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown 渲染（FN-21 启用 Markdown）。
 *
 * - 关闭开关时退化为纯文本（`preserveWhitespace` 保留换行）；
 * - 链接一律 `target="_blank" rel="noopener noreferrer"`（安全）；
 * - 不启用 raw HTML（`react-markdown` 默认不渲染 HTML，避免 XSS）。
 */
export interface MarkdownViewProps {
  content: string;
  /** 是否启用 Markdown（对应 chat.enableMarkdown） */
  enabled?: boolean;
  /** 流式渲染中（可加光标等，由调用方处理） */
  streaming?: boolean;
  /** 紧凑排版（消息气泡内） */
  dense?: boolean;
}

function MarkdownViewInner({ content, enabled = true, dense = true }: MarkdownViewProps) {
  if (!enabled) {
    return (
      <Typography
        component="div"
        variant="body2"
        sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: dense ? 1.7 : 1.8 }}
      >
        {content}
      </Typography>
    );
  }

  return (
    <Box
      className="markdown-body"
      sx={{
        fontSize: dense ? '0.9rem' : '1rem',
        '& p': { my: dense ? 0.5 : 1 },
        '& p:first-of-type': { mt: 0 },
        '& p:last-of-type': { mb: 0 },
        '& ul, & ol': { pl: 2.5, my: 0.5 },
        '& blockquote': { m: 0, pl: 1.5, borderLeft: '3px solid', borderColor: 'divider', opacity: 0.85 },
        '& img': { maxWidth: '100%', borderRadius: 1 },
        '& pre': { bgcolor: 'action.hover', fontSize: 12.5 },
        '& code': { bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 },
        '& pre code': { bgcolor: 'transparent', p: 0 },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <Link href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </Link>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
}

export const MarkdownView = memo(MarkdownViewInner);
export default MarkdownView;
