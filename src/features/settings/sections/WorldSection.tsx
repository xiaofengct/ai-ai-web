import { useCallback, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import { SettingsField } from '../SettingsField';
import { sl } from '../settingsCopy';
import { useSnack } from '@/hooks/useSnack';
import { usePersonaStore } from '@/store/personaStore';
import { personaRepo } from '@/db/repo/personaRepo';
import { activeWorldCard, activeWorldPack } from '@/world/activeWorld';
import { applyWorldToCard, describeWorldPack } from '@/world/cardWorld';
import { loadWorldFromText } from '@/world/parseWorldDoc';
import { describeShift } from '@/world/schedule';
import { readText } from '@/lib/file';
import { log } from '@/store/logStore';

/**
 * ★★ 「世界设定」分区 —— **不内置版的导入窗口**（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么需要它
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户明确：**排班与世界逻辑只在内置欣然版有；不内置版要留导入窗口**，
 * 而且要"确保导入后能被**正确识别和加载**"。
 *
 * ⇒ 本分区做四件事（每件都对应一个具体的坑）：
 *   ① **导入**：接受 `.md`（用户手写的世界文档）与 `.json`（导出包）；
 *   ② **识别报告**：把"识别到了什么 / 哪些只当文本 / 有什么疑问"摊开 ——
 *      导入最怕的是"看起来成功了但什么都没生效"；
 *   ③ **生效确认**：显示按世界设定算出的**今天是什么班次** ——
 *      这是"真的加载了"最直接的证据（不是"有字段"而是"算得出结果"）；
 *   ④ **清空**：让用户能退回"没有世界"的状态（否则导错了只能卸载重装）。
 *
 * ── 内置版与不内置版的**同一个界面、不同权限** ──────────────────────
 *   - 内置版：显示内置世界（`source.kind === 'builtin'`）⇒ **只读**，不给删除按钮。
 *     理由：它是"欣然"这个角色的一部分，删掉就不是欣然了。
 *     但**允许覆盖导入**（用户想换一套世界观也该允许），导入后变成 imported。
 *   - 不内置版：初始没有世界 ⇒ 引导导入。
 *
 * ★ 为什么用 `readText`（`@/lib/file`）而不是 `File.text()`：
 *   该工具带 **GBK 编码探测**（Windows 上记事本存的 .md 常是 GBK）。
 *   直接 `.text()` 会把中文读成乱码，而乱码文档的解析结果是"识别不到任何东西" ——
 *   用户会以为"格式不对"，实际是编码问题。这是本项目已经踩过并修过的坑。
 */
export function WorldSection(): JSX.Element {
  const snack = useSnack();
  const personas = usePersonaStore((s) => s.personas);
  const reload = usePersonaStore((s) => s.reload);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * 当前角色 + 其世界包。
   * ★ 用 `activeWorldCard()` / `activeWorldPack()`（非 hook 的一次性读），
   *   因为它们是**主动消息也用的同一份取数逻辑** ——
   *   两处若各写一份，"界面显示有世界、主动消息却读不到"这种不一致迟早发生。
   *   `personas` 只用于让本组件在该刷新时重渲染。
   */
  const card = useMemo(() => activeWorldCard(), [personas]);
  const world = useMemo(() => activeWorldPack(), [personas]);

  const isBuiltin = world?.source.kind === 'builtin';
  const todayShift = useMemo(() => describeShift(world), [world]);

  /** 把新的世界包写进当前角色卡 */
  const persistWorld = useCallback(
    async (pack: ReturnType<typeof loadWorldFromText> | null): Promise<void> => {
      const target = activeWorldCard();
      if (!target) {
        snack.error('err.llmNoProvider');
        return;
      }
      setBusy(true);
      try {
        await personaRepo.upsert(applyWorldToCard(target, pack));
        await reload();
        log.info('persona', '世界设定已更新', { kind: pack?.source.kind ?? 'cleared' }, 'XR-08');
      } catch (e) {
        snack.error('err.unknown');
        log.warn('persona', '世界设定写入失败', String(e));
      } finally {
        setBusy(false);
      }
    },
    [reload, snack],
  );

  /** 导入文件（.md / .json） */
  const handlePick = useCallback(
    async (file: File): Promise<void> => {
      setBusy(true);
      try {
        // ★ 走带编码探测的读取（见组件头注释：GBK 的 .md 直接 .text() 会乱码）
        const text = await readText(file);
        const pack = loadWorldFromText(text, file.name);
        await persistWorld(pack);
        const w = pack.report.warnings.length;
        if (w > 0) snack.warn('err.worldNotRecognized');
        else snack.success('ok.worldImported');
        log.info('persona', '世界设定已导入', {
          file: file.name,
          entries: pack.entries.length,
          hasSchedule: Boolean(pack.schedule),
          warnings: w,
        }, 'XR-08');
      } catch (e) {
        snack.error('err.unknown');
        log.warn('persona', '世界设定导入失败', String(e));
      } finally {
        setBusy(false);
        // 清掉 input.value，否则选同一个文件不会再触发 change
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [persistWorld, snack],
  );

  return (
    <Box>
      {/* ——— 当前世界 ——— */}
      <SettingsField labelKey="label.worldCurrent" hintKey="hint.worldCurrent">
        <Stack spacing={0.75} sx={{ width: '100%', maxWidth: 460 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {world ? (world.source.name || '（无名）') : sl('ui.worldNone')}
            </Typography>
            {world ? (
              <Chip
                size="small"
                variant="outlined"
                color={isBuiltin ? 'default' : 'primary'}
                label={isBuiltin ? sl('ui.worldBadgeBuiltin') : sl('ui.worldBadgeImported')}
              />
            ) : null}
          </Stack>

          {world ? (
            <Typography variant="caption" sx={{ fontFamily: 'monospace', opacity: 0.75 }}>
              {describeWorldPack(world)}
            </Typography>
          ) : null}

          {/*
            ★ 这一行是「真的加载了」最直接的证据：
              它不是"有某个字段"，而是**按世界设定算出来的结果**。
              排班写错/没生效时，这里会显示不出来或显示错误 —— 一眼可见。
          */}
          {todayShift ? (
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              {sl('ui.worldTodayShift')}：{todayShift}
            </Typography>
          ) : null}
        </Stack>
      </SettingsField>

      {/* ——— 识别报告 ——— */}
      {world ? (
        <SettingsField labelKey="label.worldReport">
          <Stack spacing={0.5} sx={{ width: '100%', maxWidth: 460 }}>
            {world.report.recognized.map((r) => (
              <Typography key={`ok-${r}`} variant="caption" sx={{ color: 'success.main', display: 'block' }}>
                ✓ {r}
              </Typography>
            ))}
            {world.report.textOnly.map((r) => (
              <Typography key={`txt-${r}`} variant="caption" sx={{ opacity: 0.7, display: 'block' }}>
                · {r}
              </Typography>
            ))}
            {world.report.warnings.map((r) => (
              <Alert key={`w-${r}`} severity="warning" sx={{ py: 0, fontSize: 12 }}>
                {r}
              </Alert>
            ))}
            {world.report.recognized.length === 0 && world.report.warnings.length === 0 ? (
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                {sl('ui.worldReportEmpty')}
              </Typography>
            ) : null}
          </Stack>
        </SettingsField>
      ) : null}

      <Divider sx={{ my: 1 }} />

      {/* ——— 操作 ——— */}
      <SettingsField labelKey="label.worldImport" hintKey="hint.worldImport">
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            size="small"
            startIcon={<FileUploadOutlinedIcon />}
            disabled={busy || !card}
            onClick={() => inputRef.current?.click()}
            sx={{ minHeight: 40 }}
          >
            {sl('ui.worldPickFile')}
          </Button>
          {/*
            ★ 内置世界**不给删除按钮**：它是"欣然"的一部分，删掉就不是欣然了。
              但允许**覆盖导入**（用户想换一套世界观是合理需求）。
              非内置（用户导入的）才给删除。
          */}
          {world && !isBuiltin ? (
            <Tooltip title={sl('ui.worldClear')} arrow>
              <span>
                <IconButton
                  disabled={busy}
                  onClick={() => void persistWorld(null)}
                  sx={{ minWidth: 40, minHeight: 40 }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept=".md,.markdown,.txt,.json,text/markdown,application/json,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handlePick(f);
            }}
          />
        </Stack>
      </SettingsField>
    </Box>
  );
}

export default WorldSection;
