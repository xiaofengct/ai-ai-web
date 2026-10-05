import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import SendIcon from '@mui/icons-material/Send';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useSnack } from '@/hooks/useSnack';
import { momentRepo } from '@/db/repo/momentRepo';
import { blobRepo } from '@/db/repo/blobRepo';
import { newId } from '@/lib/id';
import { log } from '@/store/logStore';
import { t } from '@/copy';
import { MOMENT_SELF_ID, type Moment } from '@/types/moment';
import { mo } from './momentsCopy';

/**
 * ★★ 朋友圈（2026-10-04 新增）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 做什么
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户原话：「新增一个"朋友圈"功能，支持发布与浏览动态」。
 * ⇒ 两件事：**发**（文字 + 可选配图 + 可选心情）与**看**（时间线，可筛全部 / 我的 / 她的）。
 *
 * ── 四条设计取舍（每条都对应一个"很容易顺手做错"的写法）─────────────────
 *
 * **① 动态不进对话上下文。**
 *   技术上很容易顺手把动态写进 `messages` 表（都是文本嘛），但那是错的：
 *   动态是**广播**、聊天是**对话**。混在一起，模型会把"她今天发了条动态"
 *   读成"她刚才对我说了这句话" —— 明显的人格错误。
 *   ⇒ 独立表 + 独立类型，且 `Moment` **刻意没有 `sessionId`**，
 *     让"动态不属于任何会话"成为类型层面的事实。
 *   （完整理由见 `types/moment.ts` 文件头。）
 *
 * **② 配图存 blob 逻辑路径，不存 base64、也不存 blob id。**
 *   base64 会让单条动态膨胀数百 KB，而 Dexie 是**整条记录读出来**的，
 *   列表一查就慢；blob id 则与 `blobRepo` 的 `path` 唯一索引对不上，
 *   同一张图重复引用会产生多份数据。⇒ 统一存 `moments/<随机>/<文件名>`。
 *
 * **③ 点赞用乐观更新。**
 *   点赞是高频低风险操作，等一次 IndexedDB 往返再变心形会有明显延迟感。
 *   先改本地、失败回滚并提示 —— 既不是"只改本地不落库"（刷新就没了），
 *   也不是"只落库不等"（那就不叫乐观了）。
 *
 * **④ "她的动态"这一版只能**浏览**，不能自动生成。**
 *   ★ 这里必须说实话：**没有**"她会自己发动态"的能力。
 *     真正的角色动态需要一次 LLM 调用（按人格 + 世界设定生成），属于**新功能**，
 *     而这轮的交付边界是用户说的"支持发布与浏览动态"。
 *   ⇒ 「她的」筛选在无数据时**就是空的**，界面如实说"她还没发过动态"，
 *     不假装有内容。将来接自动生成时，写入端只用 `authorKind: 'persona'`
 *     + `authorId: <personaId>`，**本页不需要改** ——
 *     这也是把 `authorKind` 单独做成字段、而不是从 `authorId` 猜的原因。
 */
type MomentFilter = 'all' | 'mine' | 'hers';

export function MomentsPage(): JSX.Element {
  const snack = useSnack();

  const [items, setItems] = useState<Moment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<MomentFilter>('all');

  /** 发布区 */
  const [expanded, setExpanded] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>('');
  const [mood, setMood] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [showEmptyHint, setShowEmptyHint] = useState<boolean>(false);
  const [rejectedImage, setRejectedImage] = useState<boolean>(false);
  /** 待删除的动态（非空即弹确认框） */
  const [pendingDelete, setPendingDelete] = useState<Moment | null>(null);

  /**
   * 已上传、尚未发布的配图（blob 路径）。
   * ★ 为什么"先传后发"而不是"点发布时才传"：
   *   图片写入 blob 是一次异步 IO，若等点"发出去"才做，用户会遇到
   *   "按钮转圈好几秒还以为卡死了"。先传 ⇒ 发布时只是把已有路径写进记录，秒回。
   *   代价是"传了图但没发"会留下孤儿 blob —— 场景极少（用户自己取消），
   *   接受这个代价，**不做自动回收**（误删用户资产的代价比留几个孤儿大得多）。
   */
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  /** 预览用的 objectURL：key = blob 路径。组件卸载时统一释放 */
  const previewsRef = useRef<Map<string, string>>(new Map());
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const res = await momentRepo.listRecent();
    if (!res.ok) {
      snack.error('err.dbFailed');
      setItems([]);
    } else {
      setItems(res.value);
    }
    setLoading(false);
  }, [snack]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 卸载时释放所有预览 URL（否则整页图片的内存一直挂着） */
  useEffect(() => {
    const previews = previewsRef.current;
    return () => {
      for (const url of previews.values()) URL.revokeObjectURL(url);
      previews.clear();
    };
  }, []);

  /**
   * 选图 → 写入 blob → 记住路径。
   *
   * ★ 只收图片、单张上限 5 MB：超限的图在 WebView 里解码会明显卡顿，
   *   而且会让 IndexedDB 迅速膨胀。
   * ★ 被拒时**必须给可见反馈**（`rejectedImage`）—— 静默跳过会让用户
   *   以为"选了没反应，是不是坏了"。
   */
  const handlePickImages = useCallback(async (files: FileList): Promise<void> => {
    const MAX_BYTES = 5 * 1024 * 1024;
    let rejected = false;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/') || file.size > MAX_BYTES) {
        rejected = true;
        continue;
      }
      const path = `moments/${newId()}/${file.name}`;
      const putRes = await blobRepo.put(path, file, file.type);
      if (!putRes.ok) {
        rejected = true;
        continue;
      }
      const urlRes = await blobRepo.getObjectURL(putRes.value);
      if (urlRes.ok && urlRes.value) previewsRef.current.set(path, urlRes.value);
      setPendingImages((prev) => [...prev, path]);
    }
    setRejectedImage(rejected);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const removeImage = useCallback((path: string): void => {
    const url = previewsRef.current.get(path);
    if (url) {
      URL.revokeObjectURL(url);
      previewsRef.current.delete(path);
    }
    setPendingImages((prev) => prev.filter((p) => p !== path));
  }, []);

  const handlePublish = useCallback(async (): Promise<void> => {
    if (draft.trim() === '') {
      // ★ 空内容**不走 snack**、走输入框自己的 error 提示（贴在哪错哪，不用找）
      setShowEmptyHint(true);
      return;
    }
    setBusy(true);
    const res = await momentRepo.create({
      content: draft,
      images: pendingImages,
      mood,
      authorId: MOMENT_SELF_ID,
      authorKind: 'user',
      authorName: '',
    });
    setBusy(false);
    if (!res.ok) {
      snack.error('err.dbFailed');
      log.warn('app', '发布动态失败', String(res.error));
      return;
    }
    // 成功后清空输入区：图片路径已随记录落库，预览 URL 可以释放了
    for (const p of pendingImages) removeImage(p);
    setDraft('');
    setMood('');
    setPendingImages([]);
    setShowEmptyHint(false);
    setRejectedImage(false);
    setExpanded(false);
    snack.success('ok.saved');
    await load();
  }, [draft, mood, pendingImages, removeImage, load, snack]);

  /**
   * 点赞 —— **乐观更新**（理由见文件头 ③）。
   * 失败时把 `likedBy` 回滚到操作前的快照，而不是"再取一次"：
   * 再取一次会引入一个新的失败点，而且中间那段时间界面是错的。
   */
  const handleToggleLike = useCallback(
    async (moment: Moment): Promise<void> => {
      const before = moment.likedBy;
      const liked = before.includes(MOMENT_SELF_ID);
      const after = liked ? before.filter((x) => x !== MOMENT_SELF_ID) : [...before, MOMENT_SELF_ID];
      setItems((prev) => prev.map((m) => (m.id === moment.id ? { ...m, likedBy: after } : m)));
      const res = await momentRepo.toggleLike(moment.id);
      if (!res.ok) {
        setItems((prev) => prev.map((m) => (m.id === moment.id ? { ...m, likedBy: before } : m)));
        snack.error('err.dbFailed');
      }
    },
    [snack],
  );

  const confirmDelete = useCallback(async (): Promise<void> => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    const res = await momentRepo.remove(target.id);
    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }
    snack.success('ok.deleted');
    await load();
  }, [pendingDelete, load, snack]);

  const filtered = useMemo(() => {
    if (filter === 'mine') return items.filter((m) => m.authorKind === 'user');
    if (filter === 'hers') return items.filter((m) => m.authorKind === 'persona');
    return items;
  }, [items, filter]);

  const emptyKey =
    filter === 'mine'
      ? 'moments.list.emptyMine'
      : filter === 'hers'
        ? 'moments.list.emptyHers'
        : 'moments.list.empty';

  /**
   * 时间线的相对时间。
   * ★ 不用绝对时间戳：时间线里满屏 `2026-10-04 20:56` 读起来很累，
   *   人判断"多久之前"本来也是靠相对量。
   * ★ 用 `getHours()` 等**本地**字段（不是 UTC）：这里表达的是
   *   "我看到这条时是几点"，与设备的墙上时间一致才对。
   *   （对比：世界设定的排班必须用北京时间的 UTC 字段，那是另一回事 —— 见 `world/schedule.ts`。）
   */
  const formatTime = useCallback((iso: string): string => {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffMin = Math.floor((Date.now() - then) / 60_000);
    if (diffMin < 1) return '刚刚';
    const d = new Date(then);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (diffMin < 60) return `${diffMin} 分钟前`;
    if (diffMin < 60 * 24) return `${hh}:${mm}`;
    if (diffMin < 60 * 48) return `昨天 ${hh}:${mm}`;
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hh}:${mm}`;
  }, []);

  return (
    <Box sx={{ width: '100%', maxWidth: 720, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {t('nav.moments')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {mo('moments.page.desc')}
        </Typography>
      </Stack>

      {/* ══════════════ 发布区 ══════════════ */}
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5, mb: 2 }}>
        {!expanded ? (
          <Button
            fullWidth
            variant="text"
            startIcon={<AddPhotoAlternateOutlinedIcon />}
            onClick={() => setExpanded(true)}
            sx={{ minHeight: 44, justifyContent: 'flex-start' }}
          >
            {mo('moments.compose.expand')}
          </Button>
        ) : (
          <Stack spacing={1.25}>
            <TextField
              multiline
              minRows={3}
              maxRows={8}
              fullWidth
              autoFocus
              placeholder={mo('moments.compose.placeholder')}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (showEmptyHint && e.target.value.trim() !== '') setShowEmptyHint(false);
              }}
              error={showEmptyHint}
              helperText={showEmptyHint ? mo('moments.err.empty') : ''}
            />

            {pendingImages.length > 0 ? (
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                {pendingImages.map((path) => {
                  const url = previewsRef.current.get(path);
                  return (
                    <Box key={path} sx={{ position: 'relative' }}>
                      <Box
                        component="img"
                        src={url ?? ''}
                        alt=""
                        sx={{
                          width: 72,
                          height: 72,
                          objectFit: 'cover',
                          borderRadius: 1.5,
                          border: 1,
                          borderColor: 'divider',
                          bgcolor: 'action.hover',
                        }}
                      />
                      <Tooltip title={mo('moments.compose.imageRemove')} arrow>
                        <IconButton
                          size="small"
                          onClick={() => removeImage(path)}
                          aria-label={mo('moments.compose.imageRemove')}
                          sx={{
                            position: 'absolute',
                            top: -8,
                            right: -8,
                            bgcolor: 'background.paper',
                            border: 1,
                            borderColor: 'divider',
                            minWidth: 24,
                            minHeight: 24,
                            '&:hover': { bgcolor: 'action.hover' },
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Stack>
            ) : null}

            {rejectedImage ? (
              <Typography variant="caption" sx={{ color: 'error.main', display: 'block' }}>
                {mo('moments.compose.imageRejected')}
              </Typography>
            ) : null}

            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <TextField
                size="small"
                label={mo('moments.compose.mood')}
                placeholder={mo('moments.compose.moodPlaceholder')}
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                sx={{ width: 150 }}
              />
              <Button
                size="small"
                variant="text"
                startIcon={<AddPhotoAlternateOutlinedIcon />}
                onClick={() => fileRef.current?.click()}
                sx={{ minHeight: 40 }}
              >
                {mo('moments.compose.imageAdd')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) void handlePickImages(files);
                }}
              />
              <Box sx={{ flex: 1, minWidth: 8 }} />
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  setExpanded(false);
                  setShowEmptyHint(false);
                  setRejectedImage(false);
                }}
                sx={{ minHeight: 40 }}
              >
                {mo('moments.compose.collapse')}
              </Button>
              <Button
                variant="contained"
                size="small"
                startIcon={<SendIcon />}
                disabled={busy}
                onClick={() => void handlePublish()}
                sx={{ minHeight: 40 }}
              >
                {busy ? mo('moments.compose.publishing') : mo('moments.compose.publish')}
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>

      {/* ══════════════ 筛选 ══════════════ */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter}
          onChange={(_e, next: MomentFilter | null) => {
            if (next) setFilter(next);
          }}
        >
          <ToggleButton value="all" sx={{ px: 1.5, minHeight: 36 }}>
            {mo('moments.filter.all')}
          </ToggleButton>
          <ToggleButton value="mine" sx={{ px: 1.5, minHeight: 36 }}>
            {mo('moments.filter.mine')}
          </ToggleButton>
          <ToggleButton value="hers" sx={{ px: 1.5, minHeight: 36 }}>
            {mo('moments.filter.hers')}
          </ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        {filtered.length > 0 ? (
          <Typography variant="caption" sx={{ opacity: 0.55 }}>
            {`${mo('moments.list.count')} ${filtered.length}`}
          </Typography>
        ) : null}
      </Stack>

      {/* ══════════════ 时间线 ══════════════ */}
      {!loading && filtered.length === 0 ? (
        <Typography variant="body2" sx={{ textAlign: 'center', opacity: 0.7, py: 6 }}>
          {mo(emptyKey)}
        </Typography>
      ) : null}

      <Stack divider={<Divider flexItem />}>
        {filtered.map((moment) => {
          const liked = moment.likedBy.includes(MOMENT_SELF_ID);
          const likeCount = moment.likedBy.length;
          const canDelete = moment.authorId === MOMENT_SELF_ID;
          return (
            <Box key={moment.id} sx={{ py: 1.5 }}>
              <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {moment.authorName || mo('moments.filter.mine')}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.55 }}>
                  {formatTime(moment.createdAt)}
                </Typography>
              </Stack>

              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  mb: moment.images.length > 0 || moment.mood ? 1 : 0,
                }}
              >
                {moment.content}
              </Typography>

              {moment.images.length > 0 ? (
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, mb: 1 }}>
                  {moment.images.map((path) => (
                    <MomentImage key={path} path={path} />
                  ))}
                </Stack>
              ) : null}

              {moment.mood ? (
                <Box sx={{ mb: 0.5 }}>
                  <Chip size="small" variant="outlined" label={moment.mood} />
                </Box>
              ) : null}

              <Stack direction="row" spacing={1} alignItems="center">
                <Tooltip title={liked ? mo('moments.action.unlike') : mo('moments.action.like')} arrow>
                  <Button
                    size="small"
                    variant="text"
                    color={liked ? 'primary' : 'inherit'}
                    startIcon={liked ? <FavoriteIcon /> : <FavoriteBorderIcon />}
                    onClick={() => void handleToggleLike(moment)}
                    sx={{ minHeight: 40, opacity: liked || likeCount > 0 ? 1 : 0.7 }}
                  >
                    {likeCount === 0
                      ? mo('moments.action.like')
                      : likeCount === 1 && liked
                        ? mo('moments.likedBy.onlyMe')
                        : `${likeCount} ${mo('moments.likedBy.count')}`}
                  </Button>
                </Tooltip>
                <Box sx={{ flex: 1 }} />
                {canDelete ? (
                  <Tooltip title={mo('moments.action.delete')} arrow>
                    <IconButton
                      size="small"
                      onClick={() => setPendingDelete(moment)}
                      aria-label={mo('moments.action.delete')}
                      sx={{ minWidth: 40, minHeight: 40 }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </Stack>
            </Box>
          );
        })}
      </Stack>

      <ConfirmDialog
        open={pendingDelete !== null}
        titleKey="confirm.deleteMoment"
        confirmKey="common.delete"
        cancelKey="common.cancel"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </Box>
  );
}

/**
 * 动态里的单张配图。
 *
 * ★ 为什么抽成组件：这样可以把 **objectURL 的生命周期绑到图片自身**
 *   （挂载时创建、卸载时 `revoke`）。
 *   在列表里内联写 `useEffect` 是不合法的（循环里不能有 hook），
 *   在父组件统一管理又记不住"哪张还在屏幕上" —— 要么泄漏、要么误释放。
 *   每个组件管自己那张，是唯一不会泄漏的写法。
 *
 * ★ 先 `getByPath` 再 `getObjectURL`：记录里存的是**路径**，
 *   而 objectURL 要的是 blob **id**，两步缺一不可。
 */
function MomentImage({ path }: { path: string }): JSX.Element | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    void (async () => {
      const rec = await blobRepo.getByPath(path);
      if (!rec.ok || !rec.value) return;
      const objUrl = await blobRepo.getObjectURL(rec.value.id);
      if (!alive || !objUrl.ok || !objUrl.value) return;
      created = objUrl.value;
      setUrl(objUrl.value);
    })();
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path]);

  if (!url) return null;
  return (
    <Box
      component="img"
      src={url}
      alt=""
      sx={{
        maxWidth: 168,
        maxHeight: 168,
        objectFit: 'cover',
        borderRadius: 1.5,
        border: 1,
        borderColor: 'divider',
      }}
    />
  );
}

export default MomentsPage;
