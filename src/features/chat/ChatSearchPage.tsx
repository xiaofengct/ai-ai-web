import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState';
import { SearchBar } from '@/components/SearchBar';
import { messageRepo } from '@/db/repo/messageRepo';
import { highlightSnippets } from '@/lib/text';
import { formatClock, formatDate } from '@/lib/time';
import { to } from '@/router/paths';
import { t } from '@/copy';
import type { Message } from '@/types/chat';

/**
 * 聊天内搜索（PG-03，验收要点⑦）：全文检索 + 跳转定位。
 *
 * ★ 命中片段用 `lib/text.highlightSnippets()`：
 *   只截取关键词前后各 N 字，长消息不会把整屏撑满，用户一眼能扫过去。
 *
 * ★ 跳转为什么传 `state.highlight` 而不是 URL query：
 *   高亮是**一次性视觉反馈**，不该进 URL——否则刷新、分享链接都会带着一个
 *   早就不在上下文里的高亮目标。走 history state 就没有这个问题。
 */

/** 单次最多展示的命中条数（再多用户也扫不完，先给最近的） */
const RESULT_LIMIT = 100;

/** 片段半径（关键词前后各取多少字） */
const SNIPPET_RADIUS = 40;

export function ChatSearchPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [keyword, setKeyword] = useState('');
  // SearchBar 内部已做防抖上报（delay=250），这里直接用它吐出来的值，避免二次延迟
  const debounced = keyword;
  const [results, setResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!id || !debounced.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    let alive = true;
    setSearching(true);
    void (async () => {
      const res = await messageRepo.search(debounced, { sessionId: id, limit: RESULT_LIMIT });
      if (!alive) return;
      // ★ 最近的排前面：搜「那天说的那句话」时用户想看的是靠后的
      const hits = (res.ok ? res.value : []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setResults(hits);
      setSearching(false);
      setSearched(true);
    })();
    return () => {
      alive = false;
    };
  }, [id, debounced]);

  const snippets = useMemo(() => {
    const kw = debounced.trim();
    if (!kw) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const m of results) {
      map.set(m.id, highlightSnippets(m.content, kw, SNIPPET_RADIUS).join(' … '));
    }
    return map;
  }, [results, debounced]);

  const jump = (messageId: string): void => {
    if (!id) return;
    navigate(to.chat(id), { state: { highlight: messageId } });
  };

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 720, mx: 'auto' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
        {t('chat.searchInChat')}
      </Typography>

      <SearchBar
        value={keyword}
        onChange={setKeyword}
        placeholder={t('common.search')}
        autoFocus
        delay={250}
      />

      <Typography variant="caption" sx={{ display: 'block', opacity: 0.55, mt: 0.5, mb: 1 }}>
        {searching ? t('loading.default') : t('chat.hitCount', { count: results.length })}
      </Typography>

      <Divider sx={{ mb: 1 }} />

      {results.length === 0 ? (
        <Box sx={{ py: 4 }}>
          <EmptyState descKey={searched ? 'chat.searchEmpty' : 'empty.search'} />
        </Box>
      ) : (
        <Stack spacing={1}>
          {results.map((m) => (
            <Paper
              key={m.id}
              variant="outlined"
              sx={{ p: 1.25, cursor: 'pointer' }}
              onClick={() => jump(m.id)}
            >
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {snippets.get(m.id) ?? m.content}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.55 }}>
                    {`${formatDate(m.createdAt)} ${formatClock(m.createdAt)}`}
                  </Typography>
                </Box>
                <Button size="small" variant="text" onClick={() => jump(m.id)}>
                  {t('chat.jump')}
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
}

export default ChatSearchPage;
