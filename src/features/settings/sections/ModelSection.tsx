import { useCallback, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LaunchIcon from '@mui/icons-material/Launch';
import RefreshIcon from '@mui/icons-material/Refresh';
import { NumberField } from '@/components/NumberField';
import { SettingsField } from '../SettingsField';
import { sl, slv } from '../settingsCopy';
import { useAdvancedText } from '../useAdvancedFlags';
import { PROVIDER_PRESETS, WEB_SEARCH_PRESETS, presetToConfig } from '@/constants/providers';
import { newId } from '@/lib/id';
import { normalizeBaseUrl, previewChatUrl, baseIdentity, isSameChatTarget } from '@/llm/adapter/compat';
import { probeModelsOnly } from '@/llm/connectTest';
import { usePersonaStore } from '@/store/personaStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSnack } from '@/hooks/useSnack';
import { t } from '@/copy';
import type { LLMProviderConfig } from '@/types/settings';

/**
 * ★★ 红线原因 / 禁用原因的行内排版（2026-10-04 修，起因是真机截图）。
 *
 * ── 现象 ──
 * 用户给的设置页截图里，FN-33 / FN-50 两行的原因文字
 * （「欣然的图像不生成，这是硬规矩，谁来都不行。」）**冲出屏幕右边缘被硬截断**，
 * 手机上读不全。
 *
 * ── 根因 ──
 * 原因原先用 `<Chip label={...} />` 渲染。Chip 是**短标签**组件：
 * 单行不换行（`white-space: nowrap` 由内部实现保证）、带内边距与胶囊底纹。
 * 26 个字塞进去 ≈ 300+ px，而 `SettingRow` 的控件容器是 `flexShrink: 0`
 * （刻意不被压缩，见其注释）⇒ 控件不肯缩、文案又不肯换行 ⇒ 只能横向溢出。
 *
 * ★ 这不是第一次：同一个坑在「预设备注」上已经踩过并修过一遍
 *   （见下面 `preset.note` 处的注释）。那次只改了那一处，
 *   没有回头搜"还有谁用 Chip 装整句话"——**于是同一个 bug 在原地留了下来**。
 *   教训：修一个「某组件被误用」的 bug 时，要顺手把同类误用一起清掉，
 *   否则修的是**实例**而不是**模式**。
 *
 * ── 修法 ──
 * 换成 `Typography variant="caption"`：默认就是可换行的行内文本，无底纹、无内边距。
 * 再显式给 `sx` 三条约束，保证它在窄屏上一定换行而不是撑破父容器：
 *   · `whiteSpace: 'normal'` —— 明确允许换行（防被上游 `nowrap` 传染）；
 *   · `minWidth: 0`          —— flex 子项默认 `min-width: auto`，不置 0 时**不会**收缩换行；
 *   · `flex: '1 1 auto'`     —— 占满剩余宽度，并允许被压缩。
 *
 * 行本身也开 `flexWrap: 'wrap'`：万一原因特别长，让它整体换到开关下面一行，
 * 而不是去挤开关（开关是操作，必须始终可见可点）。
 */
const BLOCK_ROW_SX = { flexWrap: 'wrap', rowGap: 0.5, justifyContent: 'flex-end' } as const;

/**
 * ★★ 已知的退役 / 易错模型 ID（2026-10-04）。
 *
 * ★ 每条都写清「为什么错」与「该填什么」—— 只说"这个名字不对"，
 *   用户下一步还是不知道该填什么（他很可能就是从官方文档复制的）。
 *
 * ★ 用 `RegExp` 而不是字符串相等：要同时拦住 `deepseek-chat` 与
 *   `deepseek-chat-xxx`（部分中转站会加后缀），以及大小写差异。
 */
const DEPRECATED_MODELS: readonly { match: RegExp; message: string }[] = [
  {
    match: /^deepseek-(chat|reasoner)(-|$)/,
    message:
      '`deepseek-chat` / `deepseek-reasoner` 已在 2026-07-24 被 DeepSeek 正式退役，' +
      '现在调用会直接报错（官方没有留兼容别名）。换成 `deepseek-flash`。',
  },
  {
    match: /^v4\.1-flash$/,
    message:
      'API 的模型 ID 是 `deepseek-flash`，**不是** `v4.1-flash` —— ' +
      '「V4.1 Flash」是产品名，短 ID 里去掉了版本号。',
  },
  {
    match: /^deepseek-v4-flash$/,
    message:
      '`deepseek-v4-flash` 是兼容别名（官方说"暂时"路由到 V4.1-Flash），能用但建议改用 `deepseek-flash`。',
  },
];

/** 禁用原因（可换行，不再用 Chip —— 理由见 `BLOCK_ROW_SX`） */
function BlockedReason({ text }: { text: string }): JSX.Element {
  return (
    <Typography
      variant="caption"
      sx={{
        color: 'error.main',
        whiteSpace: 'normal',
        minWidth: 0,
        flex: '1 1 auto',
        textAlign: 'left',
      }}
    >
      {text}
    </Typography>
  );
}

/**
 * 模型分组（FN-11 / FN-25 / FN-33 / FN-45 / FN-49 / FN-50 / FN-51）。
 *
 * ★ 决策 A5：只内置 DeepSeek + 硅基流动两个预设（名称 / 默认 baseURL / 默认模型 / 注册链接），
 *   **绝不内置任何 API Key**；Key 只存本机，页面里一律 password 展示，日志里走 `redact()`。
 */
export function ModelSection(): JSX.Element {
  const snack = useSnack();

  const providers = useSettingsStore((s) => s.settings.providers);
  const activeProviderId = useSettingsStore((s) => s.settings.activeProviderId);
  const upsertProvider = useSettingsStore((s) => s.upsertProvider);
  const removeProvider = useSettingsStore((s) => s.removeProvider);
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider);
  const setChat = useSettingsStore((s) => s.setChat);
  const chat = useSettingsStore((s) => s.settings.chat);

  const personas = usePersonaStore((s) => s.personas);
  const currentPersonaId = usePersonaStore((s) => s.currentId);

  const [fetching, setFetching] = useState<boolean>(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  /** 当前生效的 Provider（找不到就取第一个，保证 UI 永不空白） */
  const current = useMemo<LLMProviderConfig | undefined>(
    () => providers.find((p) => p.id === activeProviderId) ?? providers[0],
    [providers, activeProviderId],
  );

  /** 当前角色是否为欣然（XR-06 隐私红线：欣然的文生图入口必须置灰） */
  const currentPersona = useMemo(
    () => personas.find((p) => p.id === currentPersonaId) ?? personas[0],
    [personas, currentPersonaId],
  );
  const isXinran = currentPersona?.origin === 'xinran' || currentPersona?.isBuiltin === true;
  const personaNoImage = currentPersona?.privacy?.noImage === true;
  /** 人设表是否已就绪（personas 为空 = 还没从 Dexie 加载完） */
  const personaReady = personas.length > 0;
  /**
   * 隐私红线命中：角色是欣然，或者卡片自己声明了禁止生图。
   *
   * ★★ 为什么这里多一个 `!personaReady`（software-engineer-2 抓到的启动竞态）：
   *   人设表没加载完时 `personas` 是空数组 → `currentPersona` 为 undefined →
   *   `isXinran` / `personaNoImage` 都是 false → `imageBlocked = false` → **生图开关可用**。
   *   这对 XR-06 是「失败即放行」（fail-open），方向是错的：隐私红线必须 fail-closed。
   *   欣然是内置、不可删、恒存在的默认角色，所以「没加载完」按「当前就是欣然」处理，
   *   语义上也正确。App 层已保证 bootstrap 先于 reloadPersonas，这里是页面级二次兜底。
   */
  const imageBlocked = !personaReady || isXinran || personaNoImage;
  /**
   * 红线原因文案：★ 只对欣然说「欣然的图不生成」。
   *
   * ★★ 三来源对三分流（`imageBlocked` 有三条来源，这里必须有三个分支）：
   *   1. `!personaReady` —— 人设表还没加载完，`personas` 是空的，
   *      **既没有"这个角色"，也没人勾过任何东西**，只能说"还没读出来"；
   *   2. `isXinran` —— 真的是欣然，走总表原文 `tip.privacyNoImage`（这条才点名欣然）；
   *   3. `personaNoImage` —— 自定义角色自己勾了 `privacy.noImage`，走中性文案。
   *
   * 早先这里只有两分支：1 和 3 共用 `label.imageGenBlocked`（"这个角色自己勾了"），
   * 于是启动竞态那一下会指着空气说"这个角色自己勾了"——换了个说法的张冠李戴。
   * 三条各有主体，合并任何两条都会让用户去找一个不存在的开关，故不合并。
   *
   * ★★ 分支 1 敢说「马上就好」的前提（software-engineer-4 查证，2026-10-04）：
   *   欣然的 `isBuiltin = true`，`personaRepo` **禁止删除内置卡**，
   *   且 `src/db/bootstrap.ts` 启动时必然种子这张卡
   *   ⇒ 库初始化完成后 `personas.length >= 1` 恒成立，
   *     `personas.length === 0` **只可能是"加载中"这个瞬时态**，不会是稳定态。
   *   ⚠ 若哪天给内置卡开了删除口子、或加了"清空数据"，
   *     本分支就可能长期命中，「马上就好」当场变成永不兑现的空头承诺——
   *     那时必须改文案，或改 `personaReady` 的判据。前提写在结论旁边，别让它只活在对话里。
   */
  const blockedReason = !personaReady
    ? sl('label.imageGenNoPersona')
    : isXinran
      ? t('tip.privacyNoImage')
      : sl('label.imageGenBlocked');

  /** 写回当前 Provider 的某个字段 */
  const patchProvider = useCallback(
    (partial: Partial<LLMProviderConfig>) => {
      if (!current) return;
      upsertProvider({ ...current, ...partial });
    },
    [current, upsertProvider],
  );

  /** FN-51 角色模型覆盖：值形如 `{providerId}::{model}`，空串表示跟随全局 */
  const [personaModelOverride, setPersonaModelOverride] = useAdvancedText('FN-51', '');

  /** 拉一次模型列表（只探测 /models，不花钱跑 chat） */
  const handleFetchModels = useCallback(async (): Promise<void> => {
    if (!current) return;
    setFetching(true);
    const res = await probeModelsOnly({ provider: current });
    setFetching(false);
    if (res.ok && res.models && res.models.length > 0) {
      setModelOptions(res.models);
      snack.success('ok.connectionOk');
      return;
    }
    // 失败时把错误码直接摆出来（连接测试页有更完整的视图）
    snack.error(res.errorCode === 'LLM_AUTH' ? 'err.llmAuth' : 'err.llmFailed');
  }, [current, snack]);

  const handleAddProvider = useCallback((): void => {
    const id = newId();
    const preset = presetToConfig('custom', id);
    upsertProvider({ ...preset, name: `${preset.name} ${providers.length + 1}` });
    setActiveProvider(id);
  }, [providers.length, upsertProvider, setActiveProvider]);

  const handleRemoveProvider = useCallback((): void => {
    if (!current || providers.length <= 1) return;
    removeProvider(current.id);
    setModelOptions([]);
  }, [current, providers.length, removeProvider]);

  if (!current) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {t('err.llmNoProvider')}
        </Typography>
        <Button startIcon={<AddIcon />} onClick={handleAddProvider} sx={{ mt: 1, minHeight: 44 }}>
          {sl('label.providerAdd')}
        </Button>
      </Box>
    );
  }

  /**
   * 找出当前配置对应哪个内置预设。
   *
   * ★ 2026-10-04 两次修正了匹配方式，这个过程本身值得记：
   *   ① 原来：`p.baseUrl === current.baseUrl`（**精确字符串比**）
   *      ⇒ 多打一个 `/`、或按文档粘完整端点，匹配立刻失败 ⇒ 引导全部消失。
   *   ② 一度改成：归一化后比 —— **仍然不够**。因为归一化只剥端点后缀、不剥版本段，
   *      `…/chat/completions` 归一化后是 `…/deepseek.com`（无 `/v1`），
   *      与预设 `…/deepseek.com/v1` 依然不等 ⇒ **恰恰在最需要引导的写法上不引导**。
   *   ③ 现在：`baseIdentity()` 忽略可选的版本段 —— 只要"是哪家"一致就认。
   *      ⚠️ 这个坑是自动化测试（`check-baseurl-ui.mjs`）抓出来的，不是读代码看出来的。
   */
  const preset = PROVIDER_PRESETS.find(
    (p) => baseIdentity(p.baseUrl) === baseIdentity(current.baseUrl),
  );

  /** 该预设的推荐地址（= 预设的 baseUrl，也就是"官方文档那一版"） */
  const recommendedBase = preset?.baseUrl ?? '';

  /** 实际会请求的聊天地址（与真实调用同一套拼接逻辑） */
  const resolvedChatUrl = previewChatUrl(current.baseUrl);

  /**
   * 是否已经在用推荐地址 —— 判据是**实际请求等价**，不是字符串相同。
   *
   * ★ 为什么不用字符串比：`https://api.deepseek.com` 与推荐值
   *   `https://api.deepseek.com/v1` 写法不同，但请求地址完全一致。
   *   对这种情况报"你偏离了推荐"是**误报** —— 用户关心的是能不能用，不是写法。
   *   只有"实际请求确实不同"时才算真偏离，那时才值得提醒。
   */
  const isEquivalentToRecommended =
    recommendedBase !== '' && isSameChatTarget(current.baseUrl, recommendedBase);

  /** 写法与推荐值完全一致（用于区分"就是推荐值"与"等价但写法不同"） */
  const isSameTextAsRecommended =
    recommendedBase !== '' && normalizeBaseUrl(current.baseUrl) === normalizeBaseUrl(recommendedBase);

  /** 真偏离：请求地址都不一样了 ⇒ 值得提醒 */
  const isOffRecommend = recommendedBase !== '' && !isEquivalentToRecommended;

  /**
   * ★★ 模型候选（下拉用）：**预设自带的 + `/models` 拉取到的**，去重合并。
   *
   * ★ 两条来源合并而不是"拉取到的覆盖预设"：
   *   - 预设是**离线可用的基线**（没配 Key / 拉取失败时下拉仍然有内容）；
   *   - 拉取的是**服务端真实在售**的（更准，但依赖网络与 Key）。
   *   只留后者 ⇒ 新用户拉不到就只有一个空下拉；只留前者 ⇒ 看不到服务端新增的型号。
   */
  const modelCandidates = useMemo(() => {
    const out: Array<{ value: string; tag?: string; tagKind?: 'default' | 'warn' }> = [];
    const seen = new Set<string>();
    const push = (value: string, tag?: string, tagKind?: 'default' | 'warn'): void => {
      const v = value.trim();
      if (v === '' || seen.has(v)) return;
      seen.add(v);
      out.push({ value: v, ...(tag ? { tag } : {}), ...(tagKind ? { tagKind } : {}) });
    };
    // 预设里的型号（带"预设"标记，让用户知道来源）
    for (const m of preset?.models ?? []) push(m, sl('ui.modelTagPreset'));
    // 服务端拉取到的（带"服务端"标记）
    for (const m of modelOptions) push(m, sl('ui.modelTagLive'));
    return out;
  }, [preset, modelOptions]);

  /** 下拉的当前值：当前模型不在候选里时，指向"自定义"提示项 */
  const modelPresetValue = useMemo(
    () => (modelCandidates.some((m) => m.value === current.model) ? current.model : '__custom__'),
    [modelCandidates, current.model],
  );

  /**
   * ★★ 退役 / 易错型号的就地提示（2026-10-04 加）。
   *
   * ── 为什么要做这个 ────────────────────────────────────────────────────
   *   `deepseek-chat` 与 `deepseek-reasoner` 于 2026-07-24 **正式退役**，
   *   现在调用**直接报错**且**没有兼容别名**。而这两个名字在网上教程、
   *   旧配置、各种"DeepSeek 接入指南"里出现的频率**远高于**正确的新名字。
   *   ⇒ 用户大概率会填这个，然后拿到一个 4xx，完全不知道是"名字过期了"。
   *
   * ★ 表里还包含"产品名 ≠ API ID"这一类的提醒 ——
   *   用户直觉上会填 `v4.1-flash`（因为产品就叫 V4.1 Flash），但真实 ID 是
   *   `deepseek-flash`。这个坑不提醒的话，用户永远猜不到。
   */
  const modelDeprecation = useMemo((): string => {
    const m = current.model.trim().toLowerCase();
    if (m === '') return '';
    const hit = DEPRECATED_MODELS.find((d) => d.match.test(m));
    return hit ? hit.message : '';
  }, [current.model]);

  return (
    <Box>
      {/* ——— 服务商选择 ——— */}
      <SettingsField labelKey="label.provider" hintKey="hint.provider" featureId="FN-51">
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            select
            size="small"
            value={current.id}
            onChange={(e) => setActiveProvider(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            {providers.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          <Tooltip title={sl('label.providerAdd')} arrow>
            <IconButton onClick={handleAddProvider} sx={{ minWidth: 44, minHeight: 44 }}>
              <AddIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={sl('label.providerRemove')} arrow>
            <IconButton
              onClick={handleRemoveProvider}
              disabled={providers.length <= 1}
              sx={{ minWidth: 44, minHeight: 44 }}
            >
              <DeleteOutlineIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </SettingsField>

      {/* ——— 预设注册链接（决策 A5：只给链接，绝不给 Key） ——— */}
      {/* ★ 这里不挂 hint.apiKey：那条说明是「Key 只存本地」，属于 Key 输入框，
             挂在「去它家看看」的外链行上会把隐私承诺和跳转按钮绑在一起，语义错位。 */}
      <SettingsField labelKey="label.providerDocs">
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
          {PROVIDER_PRESETS.filter((p) => p.docsUrl !== '').map((p) => (
            <Button
              key={p.key}
              size="small"
              variant="text"
              endIcon={<LaunchIcon fontSize="small" />}
              href={p.docsUrl}
              target="_blank"
              rel="noreferrer"
              sx={{ minHeight: 44 }}
            >
              {p.name}
            </Button>
          ))}
        </Stack>
      </SettingsField>

      {/*
        ★ 预设备注**不能**用 `<Chip>`（2026-10-04 修）：
          原先写的是 `<Chip label={t(preset.note)} />`，而这句话长达 30~40 字
          （如已被用户删掉的那条「原作者在教程里提醒：……」，真机截图可证）。
          Chip 是**短标签**组件：不换行、有内边距与胶囊底纹，塞整句话的结果是
          渲染成一个**溢出屏幕、被右边缘硬截断**的巨型胶囊，
          既读不全也难看。
          ⇒ 改用普通一行 caption 文本：能换行、能给完整句子、视觉负担最小，
            并且不必为了它单独占一个 `SettingsField` 行（去掉标签，直接作为说明）。

        ★★ 2026-10-04 起还要判 `preset.note` **存不存在**：
          用户要求删掉 DeepSeek 那条说明，`note` 字段随之改为可选。
          没有 note 的预设**整行不渲染** —— 不留空行、不留占位。
      */}
      {preset?.note ? (
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.62, pb: 1.5, mt: -0.5 }}>
          {t(preset.note)}
        </Typography>
      ) : null}

      {/* ——— 接口地址 ——— */}
      <SettingsField labelKey="label.baseUrl" hintKey="hint.baseUrlShape">
        <Stack spacing={0.75} sx={{ width: '100%', maxWidth: 420 }}>
          <TextField
            size="small"
            value={current.baseUrl}
            onChange={(e) => patchProvider({ baseUrl: e.target.value })}
            placeholder="https://api.xxx.com/v1"
            sx={{ minWidth: 240 }}
          />

          {/*
            ★★★ 推荐地址引导（2026-10-04 加，起因是一次真机 404）
            ------------------------------------------------
            问题不是"用户不会填"，而是**页面没有把推荐值摆出来**：
            字段只给了个 `https://api.xxx.com/v1` 的 placeholder，
            用户很容易把文档里的**完整端点**（`…/chat/completions`）整段粘进来，
            于是地址被拼了两遍 ⇒ 404（详见 `docs/14`）。

            所以这里补三件事，每件都对应一个具体的坑：
              ① **推荐地址 + 一键使用** —— 明确告诉用户"填这个"，而不是让他猜；
              ② **偏离提醒** —— 当前值不等于推荐值时点破，避免"以为填对了"；
              ③ **实际会请求的地址** —— 把拼接结果摊开。
                 这是本次排查里最缺的一条信息：用户当时不知道
                 "我填的地址会被怎么拼"。
          */}
          {recommendedBase ? (
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="caption" sx={{ opacity: 0.62 }}>
                {sl('label.baseUrlRecommended')}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', opacity: 0.9 }}>
                {recommendedBase}
              </Typography>
              {isSameTextAsRecommended ? (
                <Chip size="small" color="success" variant="outlined" label={sl('label.baseUrlUsingRecommended')} />
              ) : (
                /* 等价但写法不同时也给出「用它」—— 不是报错，只是让配置更规整、日后好排查 */
                <Button
                  size="small"
                  variant="outlined"
                  color={isOffRecommend ? 'warning' : 'primary'}
                  onClick={() => patchProvider({ baseUrl: recommendedBase })}
                  sx={{ minHeight: 32, py: 0 }}
                >
                  {sl('label.baseUrlUseRecommended')}
                </Button>
              )}
            </Stack>
          ) : null}

          {/*
            偏离提醒只在**实际请求地址确实不同**时才给。
            ★ 等价写法（如 `…/deepseek.com` 与推荐的 `…/deepseek.com/v1`）不报 ——
              那属于误报，会让用户去改一个本来就能正常工作的配置。
          */}
          {isOffRecommend ? (
            <Typography variant="caption" sx={{ color: 'warning.main' }}>
              {sl('hint.baseUrlOffRecommend')}
            </Typography>
          ) : null}

          {/*
            实际会请求的地址：用 `previewChatUrl()` 算，与实际调用**同一套**逻辑
            （`normalizeBaseUrl` + `chatPathCandidates` + `joinUrl`）。
            ★ 不在这里重写一遍拼接：一旦两处逻辑漂移，这个"预览"就会开始骗人 ——
              而它恰恰是排查时唯一可信的东西。
          */}
          <Stack direction="row" spacing={0.75} alignItems="baseline" flexWrap="wrap" useFlexGap>
            <Typography variant="caption" sx={{ opacity: 0.62, flexShrink: 0 }}>
              {sl('label.baseUrlResolved')}
            </Typography>
            <Typography
              variant="caption"
              sx={{ fontFamily: 'monospace', opacity: 0.9, wordBreak: 'break-all' }}
            >
              {resolvedChatUrl}
            </Typography>
          </Stack>
        </Stack>
      </SettingsField>

      {/* ——— Key（password 展示，绝不回显明文） ——— */}
      <SettingsField labelKey="label.apiKey" hintCopyKey="settings.hint.apiKey">
        <TextField
          size="small"
          type="password"
          autoComplete="off"
          value={current.apiKey ?? ''}
          onChange={(e) => patchProvider({ apiKey: e.target.value })}
          placeholder="sk-..."
          sx={{ minWidth: 240 }}
        />
      </SettingsField>

      {/* ——— 模型：预设下拉 + 手填 + 拉取 ——— */}
      <SettingsField labelKey="label.model" hintCopyKey="settings.hint.model">
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {/*
            ★★ 从"纯输入框"改成"下拉 + 输入框"（2026-10-04）。
            理由（用户要求「增加更多可选型号及其切换方式」）：
              纯输入框要求用户**自己知道型号 ID** 并手打 —— 而 ID 恰恰是最容易写错的东西
              （`deepseek-flash` vs `v4.1-flash` vs `deepseek-v4-flash` 三个名字
               只有一个是对的，且都不是产品名）。写错的报错是 4xx，
               对用户来说完全看不出"是我名字写错了"。
            ⇒ 下拉给出**能用的候选**（含预设自带的 + 拉取到的），
              同时**保留手填**：第三方中转站型号五花八门，写死清单必然过时。
              两条路并存 = 易用 + 不被清单限制。
          */}
          <TextField
            select
            size="small"
            value={modelPresetValue}
            onChange={(e) => {
              if (e.target.value === '__custom__') return; // 「自定义」只是提示项，不改变值
              patchProvider({ model: e.target.value });
            }}
            sx={{ minWidth: 190 }}
            SelectProps={{ displayEmpty: true }}
          >
            {/* 已知候选（去重；含预设与 /models 拉取结果） */}
            {modelCandidates.map((m) => (
              <MenuItem key={m.value} value={m.value}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ width: '100%' }}>
                  <span>{m.value}</span>
                  {m.tag ? (
                    <Chip
                      size="small"
                      label={m.tag}
                      color={m.tagKind === 'warn' ? 'warning' : 'default'}
                      variant="outlined"
                      sx={{ height: 18, fontSize: 10 }}
                    />
                  ) : null}
                </Stack>
              </MenuItem>
            ))}
            {/* 当前值不在候选里 ⇒ 加一项显示它（否则 select 会显示空白） */}
            {!modelCandidates.some((m) => m.value === current.model) ? (
              <MenuItem value={current.model}>{current.model}</MenuItem>
            ) : null}
          </TextField>

          <TextField
            size="small"
            value={current.model}
            onChange={(e) => patchProvider({ model: e.target.value })}
            placeholder={sl('ui.modelManual')}
            sx={{ minWidth: 150, flex: '1 1 150px' }}
          />

          <Tooltip title={sl('label.fetchModels')} arrow>
            <span>
              <IconButton
                onClick={() => void handleFetchModels()}
                disabled={fetching}
                aria-label={sl('label.fetchModels')}
                sx={{ minWidth: 44, minHeight: 44 }}
              >
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {/*
          ★★ 退役型号就地告警（2026-10-04 加）。
          为什么必须有：`deepseek-chat` 这类 ID 在**无数教程与旧配置里**出现，
          用户复制的很可能就是它。而它现在的报错是 4xx ——
          用户完全看不出"是这个名字过期了"。
          ⇒ 在输入框下面直接说清"这个名字退役了，改成 XXX"，
            把一次要花半小时的排查变成一眼可见。
        */}
        {modelDeprecation ? (
          <Alert severity="warning" sx={{ mt: 1, py: 0.25 }}>
            <Typography variant="caption">{modelDeprecation}</Typography>
          </Alert>
        ) : null}
      </SettingsField>

      {/* ——— ★ 实际请求地址（用户要求"切换后能直接显示对应的接口地址"）——— */}
      <SettingsField labelKey="label.modelEndpoint" hintKey="hint.modelEndpoint">
        <Stack spacing={0.5} sx={{ width: '100%', maxWidth: 460 }}>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {previewChatUrl(current.baseUrl)}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {slv('ui.modelEndpointNote', { model: current.model, base: current.baseUrl })}
          </Typography>
        </Stack>
      </SettingsField>

      {modelOptions.length > 0 ? (
        <SettingsField labelKey="label.modelList">
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', maxWidth: 320, justifyContent: 'flex-end' }}>
            {modelOptions.slice(0, 12).map((m) => (
              <Chip
                key={m}
                size="small"
                variant={m === current.model ? 'filled' : 'outlined'}
                label={m}
                onClick={() => patchProvider({ model: m })}
              />
            ))}
          </Stack>
        </SettingsField>
      ) : null}

      {/* ——— FN-11 兼容模式 ——— */}
      <SettingsField labelKey="label.compatMode" hintCopyKey="settings.hint.compatMode" featureId="FN-11">
        <Switch
          checked={current.compatMode}
          onChange={(e) => patchProvider({ compatMode: e.target.checked })}
        />
      </SettingsField>

      {/* ——— FN-25 多模态兼容模式 ——— */}
      <SettingsField
        labelKey="label.multimodalCompat"
        hintCopyKey="settings.hint.multimodalCompat"
        featureId="FN-25"
      >
        <Switch
          checked={current.multimodalCompatMode}
          onChange={(e) => patchProvider({ multimodalCompatMode: e.target.checked })}
        />
      </SettingsField>

      {/* ——— FN-45 联网搜索（alternative：CORS 限制） ——— */}
      <SettingsField labelKey="label.webSearch" hintCopyKey="settings.hint.webSearch" featureId="FN-45">
        <Switch
          checked={chat.webSearch.enabled}
          onChange={(e) => setChat({ webSearch: { enabled: e.target.checked } })}
        />
      </SettingsField>
      <SettingsField labelKey="label.webSearchProvider" hintKey="hint.webSearchCors" nested featureId="FN-45">
        {/*
          ★★ 这一行必须允许换行（2026-10-04 修，由自动化溢出检查发现）。
          
          它并排放了**三个固定最小宽度的控件**：
            · 服务商下拉 `minWidth: 140`
            · API Key 输入 `minWidth: 160`
            · 取几条结果 `width: 96`
          合计 `140 + 160 + 96 + 2×8(spacing) = 412px`。

          而 `SettingRow` 的控件容器是 `flexShrink: 0`（刻意不让控件被压扁，
          见其注释），且这一行还带 `nested` 的 `pl: 2`（16px）缩进。
          ⇒ 在 390px 宽的手机上，右侧那个「取几条结果」输入框
            **超出屏幕右边界 68px 被切掉**（实测数字，不是估算）。
            这正是用户说的"内容整体过长、手机上显示不全"。

          ★ 为什么用 `flexWrap` 而不是把 minWidth 改小：
            改小只是把溢出阈值往后推 —— 换个更窄的设备（320px）照样溢出，
            而且"多窄才够"是个猜不准的数。
            换行不猜宽度：放得下就一行，放不下就整体换到下一行，
            且**每个控件都保持自己的可读最小宽度**（输入框太窄没法用）。
        */}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <TextField
            select
            size="small"
            value={chat.webSearch.provider}
            onChange={(e) => setChat({ webSearch: { provider: e.target.value } })}
            sx={{ minWidth: 140 }}
          >
            {WEB_SEARCH_PRESETS.map((p) => (
              <MenuItem key={p.provider} value={p.provider}>
                {p.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="password"
            value={chat.webSearch.apiKey ?? ''}
            onChange={(e) => setChat({ webSearch: { apiKey: e.target.value } })}
            placeholder={sl('ui.optional')}
            sx={{ minWidth: 160 }}
          />
          <NumberField
            label={sl('label.webSearchTopK')}
            value={chat.webSearch.topK}
            onChange={(v) => setChat({ webSearch: { topK: v } })}
            min={1}
            max={20}
            width={96}
          />
        </Stack>
      </SettingsField>

      {/* ——— FN-33 文生图二次确认：★ XR-06 —— 红线命中时一并禁用，不留「能点但点不动」的入口 ——— */}
      <SettingsField labelKey="label.imageGenConfirm" hintKey="hint.imageGenConfirm" featureId="FN-33">
        <Stack direction="row" spacing={1} alignItems="center" sx={BLOCK_ROW_SX}>
          <Switch
            checked={!imageBlocked && chat.imageGen.confirmBeforeGen}
            disabled={imageBlocked}
            onChange={(e) => setChat({ imageGen: { confirmBeforeGen: e.target.checked } })}
          />
          {imageBlocked ? <BlockedReason text={blockedReason} /> : null}
        </Stack>
      </SettingsField>

      {/* ——— FN-50 角色级文生图参数：欣然的隐私红线 → 强制置灰 ——— */}
      <SettingsField labelKey="label.personaImageGen" hintKey="hint.personaImageGen" featureId="FN-50">
        <Stack direction="row" spacing={1} alignItems="center" sx={BLOCK_ROW_SX}>
          {imageBlocked ? <BlockedReason text={blockedReason} /> : null}
          <Switch
            checked={!imageBlocked && chat.imageGen.model !== ''}
            disabled={imageBlocked}
            onChange={(e) =>
              setChat({
                imageGen: {
                  model: e.target.checked ? chat.imageGen.model || 'Kwai-Kolors/Kolors' : '',
                },
              })
            }
          />
        </Stack>
      </SettingsField>

      {/* ——— FN-51 角色单独指定模型 ——— */}
      <SettingsField labelKey="label.personaModel" hintKey="hint.personaModel" featureId="FN-51">
        <TextField
          select
          size="small"
          value={personaModelOverride}
          onChange={(e) => setPersonaModelOverride(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{sl('ui.notSet')}</MenuItem>
          {providers.flatMap((p) =>
            (p.model ? [p.model] : []).map((m) => (
              <MenuItem key={`${p.id}::${m}`} value={`${p.id}::${m}`}>
                {`${p.name} / ${m}`}
              </MenuItem>
            )),
          )}
        </TextField>
      </SettingsField>

      {/* ——— FN-49 自定义参数 ——— */}
      <SettingsField labelKey="label.temperature" hintCopyKey="settings.hint.params" featureId="FN-49">
        <NumberField
          value={chat.params.temperature}
          onChange={(v) => setChat({ params: { temperature: v } })}
          min={0}
          max={2}
          step={0.05}
          presets={[0.3, 0.7, 0.9, 1.2]}
          width={110}
        />
      </SettingsField>
      <SettingsField labelKey="label.topP" nested featureId="FN-49">
        <NumberField
          value={chat.params.topP}
          onChange={(v) => setChat({ params: { topP: v } })}
          min={0}
          max={1}
          step={0.05}
          presets={[0.7, 0.9, 0.95, 1]}
          width={110}
        />
      </SettingsField>
      <SettingsField labelKey="label.maxTokens" nested featureId="FN-49">
        <NumberField
          value={chat.params.maxTokens}
          onChange={(v) => setChat({ params: { maxTokens: v } })}
          min={64}
          max={32768}
          step={128}
          presets={[512, 1024, 2048, 4096]}
          width={120}
        />
      </SettingsField>
      <SettingsField labelKey="label.presencePenalty" nested featureId="FN-49">
        <NumberField
          value={chat.params.presencePenalty}
          onChange={(v) => setChat({ params: { presencePenalty: v } })}
          min={-2}
          max={2}
          step={0.1}
          width={110}
        />
      </SettingsField>
      <SettingsField labelKey="label.frequencyPenalty" nested featureId="FN-49">
        <NumberField
          value={chat.params.frequencyPenalty}
          onChange={(v) => setChat({ params: { frequencyPenalty: v } })}
          min={-2}
          max={2}
          step={0.1}
          width={110}
        />
      </SettingsField>

      {/* 上下文窗口是 token 预算的分母，放模型分组便于对照 */}
      <SettingsField labelKey="label.contextWindow" hintKey="hint.contextWindow">
        <NumberField
          value={current.contextWindow}
          onChange={(v) => patchProvider({ contextWindow: v })}
          min={1024}
          max={2_000_000}
          step={1024}
          presets={[8192, 32768, 65536, 131072]}
          width={130}
        />
      </SettingsField>
    </Box>
  );
}

export default ModelSection;
