import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { CAPABILITIES, EXPECTED_FEATURE_COUNT, auditCapabilities } from '@/constants/capabilities';
import { ALL_FEATURE_IDS } from '@/constants/featureIds';
import { featureName } from './featureNames';
import { cl, clv, type CapabilityTextKey } from './capabilitiesCopy';
import { t } from '@/copy';
import type { CapabilityMeta } from '@/constants/capabilities';
import type { CapabilityLevel } from '@/types/common';

/**
 * ★ 能力总览页（PM 验收 §8 缺口的统一出口）。
 *
 * ============ 为什么要有这一页 ============
 * 141 项能力表此前**没有任何页面整体消费它**：`CapabilityGate` 只做单项置灰，
 * 于是 PL-07 / PL-19 / PL-21 / SV-09 / SV-10 / SV-11 这 6 项「判了不可实现、
 * 但 UI 上找不到置灰与原因」变成**静默缺失**，违反 PRD §11。
 * 本页把 141 项整体摊开，一次性给全部功能项（尤其不可实现项）一个可见出口。
 *
 * ★★ 数据源唯一：`constants/capabilities.ts` 的 `CAPABILITIES`（141 项）。
 * **不要**换成 `ModulePermissionPage` 的 `MODULE_CAPABILITIES`——那份只有 17 项，
 * 是「模块授权」视角的子集，拿它当数据源会渲染不全、还会造出第二份真相。
 *
 * ★ 名称列取 `FEATURE_NAMES`（PRD §6 导出，仅展示用），
 *   level / reason / alternative 一律以 `CAPABILITIES` 为准。
 *
 * ★★ 为什么部分项不显示「我拿什么补」：
 *   能力表里 `full` 项**普遍带** `alternative: 'alt.notNeeded'`（历史遗留的占位值），
 *   无条件渲染的话，「能完整实现」的行下面也会挂一行「无需替代方案」——是纯噪音，
 *   还会把真正需要看替代方案的 `partial` / `alternative` / `unavailable` 淹掉。
 *
 *   但隐藏条件**必须是合取**（两条同时成立才隐藏）：
 *     `level === 'full' && alternative === 'alt.notNeeded'`
 *   不能只写 `level === 'full'`。原因是有反例：PG-04 / FN-55 / FN-59
 *   等级已升为 `full`，但替代方案挂的是 `alt.ttsFallback` / `alt.webSpeech`——
 *   那不是占位，是「默认关闭时走什么兜底」的真实信息，隐藏掉等于删内容。
 *   ★ 判据原则：**宁可多显示一条噪音，也不可隐藏一条有信息量的内容。**
 */

/** 分组展示顺序（与 PRD §6 的分节一致） */
const GROUP_ORDER: readonly CapabilityMeta['group'][] = [
  '页面',
  '后台能力',
  '设置项',
  '平台能力',
  '蒸馏',
  '欣然人格',
];

/**
 * 分组标识（`CapabilityMeta.group`，是数据里的事实值）→ 显示名文案 key。
 * 写成 `Record<...>` 而不是 `switch`，是为了让「新增第 7 个分组」直接编译报错，
 * 而不是渲染出一个没人管的空标题。
 */
const GROUP_LABEL: Readonly<Record<CapabilityMeta['group'], CapabilityTextKey>> = {
  页面: 'ui.group.page',
  后台能力: 'ui.group.backend',
  设置项: 'ui.group.settings',
  平台能力: 'ui.group.platform',
  蒸馏: 'ui.group.distill',
  欣然人格: 'ui.group.xinran',
};

/** 筛选档位：all + 四档 level */
type LevelFilter = 'all' | CapabilityLevel;

const LEVEL_FILTERS: readonly LevelFilter[] = ['all', 'full', 'partial', 'alternative', 'unavailable'];

/** 四档视觉：full 正常 / partial 黄标 / alternative 橙标 / unavailable 置灰 */
function levelChip(level: CapabilityLevel): { label: string; color: 'default' | 'warning'; sx?: Record<string, string> } {
  switch (level) {
    case 'full':
      return { label: cl('level.full'), color: 'default' };
    case 'partial':
      return { label: cl('level.partial'), color: 'warning' };
    case 'alternative':
      // MUI 没有橙色语义色，这里用 warning 的深色调（#ed6c02）做橙标
      return { label: cl('level.alternative'), color: 'warning', sx: { color: '#ed6c02', borderColor: '#ed6c02' } };
    case 'unavailable':
      return { label: cl('level.unavailable'), color: 'default' };
    default:
      return { label: level, color: 'default' };
  }
}

/** 整行底色：做不了的要一眼看出来是灰的 */
function rowBg(level: CapabilityLevel): string {
  switch (level) {
    case 'partial':
      return 'rgba(255, 167, 38, 0.08)';
    case 'alternative':
      return 'rgba(237, 108, 2, 0.08)';
    case 'unavailable':
      return 'rgba(0, 0, 0, 0.06)';
    default:
      return 'transparent';
  }
}

export function CapabilityOverviewPage(): JSX.Element {
  const [level, setLevel] = useState<LevelFilter>('all');
  const [keyword, setKeyword] = useState<string>('');

  // 统计与全量行都只依赖常量，算一次就够
  const audit = useMemo(() => auditCapabilities(), []);

  /**
   * 全量行：按 `ALL_FEATURE_IDS` 的稳定顺序取，保证与 PRD 清单同序。
   * ★ 这里刻意遍历 ID 列表而不是 `Object.values(CAPABILITIES)`，
   *   万一能力表里混进了清单外的 ID，顺序也不会飘。
   */
  const allRows = useMemo<CapabilityMeta[]>(() => {
    const out: CapabilityMeta[] = [];
    for (const id of ALL_FEATURE_IDS) {
      // ★ `ALL_FEATURE_IDS` 本身就是 `readonly FeatureId[]`，这里的断言是多余的，直接去掉
      const meta = CAPABILITIES[id];
      if (meta) out.push(meta);
    }
    // 能力表里存在但未登记在 ID 清单里的（理论上不该有），兜底追加，避免漏渲染
    for (const meta of Object.values(CAPABILITIES)) {
      if (!out.some((m) => m.id === meta.id)) out.push(meta);
    }
    return out;
  }, []);

  /** ★ dev 断言：渲染条数应等于 141，不符只 warn 不 throw（验收要求） */
  useEffect(() => {
    if (!import.meta.env?.DEV) return;
    if (allRows.length !== EXPECTED_FEATURE_COUNT) {
      // eslint-disable-next-line no-console
      console.warn('[capabilities] 渲染条数与期望不符', {
        rendered: allRows.length,
        expected: EXPECTED_FEATURE_COUNT,
      });
    }
  }, [allRows.length]);

  /** 关键字命中：ID / 名称 / 原因 / 补充说明 / 替代文案 */
  const visible = useMemo<CapabilityMeta[]>(() => {
    const kw = keyword.trim().toLowerCase();
    return allRows.filter((meta) => {
      if (level !== 'all' && meta.level !== level) return false;
      if (!kw) return true;
      const haystack = [
        meta.id,
        featureName(meta.id),
        // ★ 分组名也要进检索，否则搜「蒸馏」搜不到整组（只能搜到名字里恰好带"蒸馏"的那几条）。
        //   ⚠️ 已知副作用：搜分组名会命中该分组下**所有**行（full / partial / unavailable 都算）。
        //   这是有意接受的——用户搜「蒸馏」就是要看这一组，命中全组正是他要的，不是 bug。
        cl(GROUP_LABEL[meta.group]),
        // ★ 搜索 haystack：reason / note 归口后是 CopyKey，**必须** t() 后再进检索，
        //   否则用户搜「悬浮窗」永远搜不到（不报错、不显示错，纯静默失效）。
        t(meta.reason),
        meta.note ? t(meta.note) : '',
        meta.alternative ? t(meta.alternative) : '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(kw);
    });
  }, [allRows, keyword, level]);

  /** 按 group 分组，组内保持清单顺序 */
  const grouped = useMemo<{ group: CapabilityMeta['group']; items: CapabilityMeta[] }[]>(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      items: visible.filter((m) => m.group === group),
    })).filter((g) => g.items.length > 0);
  }, [visible]);

  const filtered = level !== 'all' || keyword.trim().length > 0;

  return (
    <Box sx={{ width: '100%', maxWidth: 960, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Stack spacing={0.25} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {cl('page.capabilities.title')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {cl('page.capabilities.desc')}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.55 }}>
          {clv('page.capabilities.source', { n: EXPECTED_FEATURE_COUNT })}
        </Typography>
      </Stack>

      {/* ————— ① 顶部统计（auditCapabilities）————— */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
          <Chip size="small" variant="outlined" label={clv('ui.count', { n: audit.total })} />
          <Chip size="small" variant="outlined" label={`${cl('level.full')} ${audit.byLevel.full}`} />
          <Chip size="small" variant="outlined" color="warning" label={`${cl('level.partial')} ${audit.byLevel.partial}`} />
          <Chip
            size="small"
            variant="outlined"
            sx={{ color: '#ed6c02', borderColor: '#ed6c02' }}
            label={`${cl('level.alternative')} ${audit.byLevel.alternative}`}
          />
          <Chip size="small" variant="outlined" label={`${cl('level.unavailable')} ${audit.byLevel.unavailable}`} />
          {audit.missing.length > 0 ? (
            <Chip
              size="small"
              color="error"
              variant="outlined"
              label={clv('stat.missing', { n: audit.missing.length })}
            />
          ) : null}
        </Stack>

        {/* ————— ② 筛选 + 检索 ————— */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ sm: 'center' }}
          sx={{ mt: 1.5, flexWrap: 'wrap' }}
        >
          <ToggleButtonGroup
            size="small"
            exclusive
            value={level}
            onChange={(_e, v: LevelFilter | null) => {
              if (v) setLevel(v);
            }}
            sx={{ height: 44 }}
          >
            {LEVEL_FILTERS.map((f) => (
              <ToggleButton key={f} value={f} sx={{ px: 1.25, height: 44 }}>
                {f === 'all' ? cl('ui.all') : cl(`level.${f}` as 'level.full')}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <TextField
            size="small"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={cl('ui.searchPlaceholder')}
            // ★ 必须走 inputProps：直接写在 TextField 上的 aria-label 会被 MUI 挂到
            //   外层 FormControl（div）上，input 自身拿不到可访问名（读屏无标签）。
            inputProps={{ 'aria-label': cl('ui.search') }}
            sx={{ minWidth: 220, flex: 1 }}
          />

          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {clv('stat.shown', { n: visible.length })}
          </Typography>
          {filtered ? (
            <Chip
              size="small"
              variant="outlined"
              onDelete={() => {
                setLevel('all');
                setKeyword('');
              }}
              label={cl('ui.reset')}
              sx={{ height: 32 }}
            />
          ) : null}
        </Stack>
      </Paper>

      {/* ————— ③ 分组清单 ————— */}
      {grouped.length === 0 ? (
        <Box sx={{ py: 3, textAlign: 'center' }}>
          <Typography variant="body2" sx={{ opacity: 0.7 }}>
            {cl('empty.filtered')}
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.25} sx={{ mt: 1.5 }}>
          {grouped.map(({ group, items }) => (
            <Paper key={group} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>
                  {cl(GROUP_LABEL[group])}
                </Typography>
                <Chip size="small" variant="outlined" label={clv('ui.count', { n: items.length })} />
              </Stack>
              <Divider />
              <Stack divider={<Divider />}>
                {items.map((meta) => {
                  const chip = levelChip(meta.level);
                  const dim = meta.level === 'unavailable';
                  // ★ 隐藏条件：等级已是 full，且替代方案只是「无需替代」的占位。
                  //   两条必须同时成立——只写 level === 'full' 会把 PG-04 / FN-55 / FN-59
                  //   这种「full 但挂真实兜底文案」的项一起藏掉（见文件头注释）。
                  const hideAlternative = meta.level === 'full' && meta.alternative === 'alt.notNeeded';
                  return (
                    <Box
                      key={meta.id}
                      data-capability-id={meta.id}
                      data-capability-level={meta.level}
                      sx={{ px: 2, py: 1.25, bgcolor: rowBg(meta.level), opacity: dim ? 0.72 : 1 }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, flex: 1, minWidth: 140 }}>
                          {featureName(meta.id)}
                        </Typography>
                        <Chip
                          size="small"
                          label={meta.id}
                          variant="outlined"
                          sx={{ fontFamily: 'monospace', fontSize: 11, height: 24 }}
                        />
                        <Chip
                          size="small"
                          color={chip.color}
                          variant="outlined"
                          label={chip.label}
                          sx={{ height: 24, ...(chip.sx ?? {}) }}
                        />
                      </Stack>

                      <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.75 }}>
                        {`${cl('label.reason')}：${t(meta.reason)}`}
                      </Typography>

                      {/*
                        ★ 隐藏条件见上方 `hideAlternative`（合取，不是单看等级）。
                        `unavailable` 且没有替代文案时，显式渲染「无替代方案」——
                        留白会让人以为没加载出来。
                      */}
                      {meta.alternative && !hideAlternative ? (
                        <Typography variant="caption" sx={{ display: 'block', mt: 0.25, opacity: 0.75 }}>
                          {`${cl('label.alternative')}：${t(meta.alternative)}`}
                        </Typography>
                      ) : meta.level === 'unavailable' ? (
                        <Typography variant="caption" sx={{ display: 'block', mt: 0.25, opacity: 0.6 }}>
                          {cl('label.noAlternative')}
                        </Typography>
                      ) : null}

                      {meta.note ? (
                        <Typography variant="caption" sx={{ display: 'block', mt: 0.25, opacity: 0.6 }}>
                          {`${cl('label.note')}：${t(meta.note)}`}
                        </Typography>
                      ) : null}
                    </Box>
                  );
                })}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
}

export default CapabilityOverviewPage;
