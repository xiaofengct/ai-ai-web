import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { NumberField } from '@/components/NumberField';
import { TokenBadge } from '@/components/TokenBadge';
import { SettingsField } from '../SettingsField';
import { sl } from '../settingsCopy';
import { useAdvancedNumber } from '../useAdvancedFlags';
import { DEFAULT_CONTEXT_WINDOW } from '@/constants/limits';
import { SEGMENT_CONTROL_KEY, SEGMENT_LABELS, SEGMENT_ORDER } from '@/persona/promptTypes';
import { contextBudget } from '@/lib/token';
import { usePersonaStore } from '@/store/personaStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useActiveProvider } from '@/hooks/useSettings';
import { t, type CopyKey } from '@/copy';
import type { ChatSettings } from '@/types/settings';
import type { PromptSegmentId } from '@/types/prompt';

/**
 * 上下文分组（FN-04 / FN-05 / FN-13 / FN-15 / FN-30 / FN-31 / FN-34 / FN-36）。
 *
 * ★ FN-30 提示词注入控制：12 段按 `injectControl` 的四个主开关 + `extras` 四个逐段开关表达，
 *   开发者页（PG-19）能看到逐段内容与 token 占用。
 */

/**
 * 12 段的顺序、名称、开关来源**全部取自 `src/persona/promptTypes.ts`
 * （`SEGMENT_ORDER` / `SEGMENT_LABELS` / `SEGMENT_CONTROL_KEY`）。
 *
 * ★ 本页不维护任何一份「段 → 开关」的映射表：
 *   否则和 `PersonaCompiler` 的 `isSegmentEnabled()` 就是两套逻辑，迟早漂移。
 */
/**
 * 4 个「注入控制大类」的中文名 —— 走文案总表的 `settings.inject.*`，
 * 与聊天内上下文页（PG-10）共用同一套 key，避免两处各写一份。
 */
const OWNER_LABEL: Partial<Record<string, CopyKey>> = {
  system: 'settings.inject.system',
  worldBook: 'settings.inject.worldBook',
  memory: 'settings.inject.memory',
  jailbreak: 'settings.inject.jailbreak',
};

/** 某段当前是否被注入（与 `isSegmentEnabled()` 同一套判定） */
function segmentEnabled(
  inject: ChatSettings['injectControl'],
  id: PromptSegmentId,
  isXinran: boolean,
): boolean {
  // ★ 欣然的硬约束段恒为 true（不可关），与 promptTypes.isSegmentEnabled 一致
  if (id === 'constraints' && isXinran) return true;
  const key = SEGMENT_CONTROL_KEY[id];
  if (key === 'always' || key === 'extras') return inject.extras[id] ?? true;
  const base: boolean = inject[key];
  const override = inject.extras[id];
  return override ?? base;
}

export function ContextSection(): JSX.Element {
  const chat = useSettingsStore((s) => s.settings.chat);
  const setChat = useSettingsStore((s) => s.setChat);
  const provider = useActiveProvider();
  const personas = usePersonaStore((s) => s.personas);
  const currentPersonaId = usePersonaStore((s) => s.currentId);

  /** FN-36 会话消息上限（超出归档，不删除） */
  const [maxPerSession, setMaxPerSession] = useAdvancedNumber('FN-36', 20_000);

  const contextWindow = provider?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const budget = useMemo(
    () => contextBudget(contextWindow, chat.params.maxTokens),
    [contextWindow, chat.params.maxTokens],
  );

  /** 当前角色（默认回落到第一张卡） */
  const currentPersona = useMemo(
    () => personas.find((p) => p.id === currentPersonaId) ?? personas[0],
    [personas, currentPersonaId],
  );
  /**
   * 当前角色是不是欣然（欣然的硬约束段不可关）。
   *
   * ★ 多一个 `!personaReady`（与 ModelSection 同源的启动竞态兜底）：
   *   人设表没加载完时 `personas` 为空 → `currentPersona` undefined → isXinran=false
   *   → 欣然的 `constraints` 段变成「可以关掉」，硬约束有被绕过的窗口。
   *   同样按 fail-closed 处理：没加载完就按默认角色（欣然）算。
   */
  const personaReady = personas.length > 0;
  const isXinran =
    !personaReady || currentPersona?.origin === 'xinran' || currentPersona?.isBuiltin === true;

  /**
   * 点击某一段 → 写回它**真正归属的那个开关**。
   * ★ 归属由 `SEGMENT_CONTROL_KEY` 决定，本页不硬编码。
   */
  const setSegment = (id: PromptSegmentId, value: boolean): void => {
    const key = SEGMENT_CONTROL_KEY[id];
    switch (key) {
      case 'system':
        setChat({ injectControl: { system: value } });
        break;
      case 'worldBook':
        setChat({ injectControl: { worldBook: value } });
        break;
      case 'memory':
        setChat({ injectControl: { memory: value } });
        break;
      case 'jailbreak':
        setChat({ injectControl: { jailbreak: value } });
        break;
      // 'always' / 'extras' → 逐段覆写落在 injectControl.extras[id]
      default:
        setChat({ injectControl: { extras: { [id]: value } } });
        break;
    }
  };

  return (
    <Box>
      {/* —— FN-05 上下文条数 —— */}
      <SettingsField labelKey="label.contextCount" hintCopyKey="settings.hint.contextCount" featureId="FN-05">
        <NumberField
          value={chat.contextCount}
          onChange={(v) => setChat({ contextCount: v })}
          min={0}
          max={500}
          step={2}
          presets={[10, 20, 40, 80]}
          width={110}
        />
      </SettingsField>

      {/* —— 预算（窗口 - 最长回复 - 预留） —— */}
      <SettingsField labelKey="label.budget" hintKey="hint.budget">
        <Stack direction="row" spacing={1} alignItems="center">
          <TokenBadge value={budget} label={sl('label.budget')} />
          <Typography variant="caption" sx={{ opacity: 0.6, fontFamily: 'monospace' }}>
            {`${contextWindow} - ${chat.params.maxTokens} - 512`}
          </Typography>
        </Stack>
      </SettingsField>

      {/* —— FN-15 单次最大条数 —— */}
      <SettingsField labelKey="label.maxMessages" hintCopyKey="settings.hint.maxMessages" featureId="FN-15">
        <NumberField
          value={chat.maxMessages}
          onChange={(v) => setChat({ maxMessages: v })}
          min={1}
          max={1000}
          step={1}
          presets={[20, 40, 80, 160]}
          width={110}
        />
      </SettingsField>

      {/* —— FN-13 加载范围 —— */}
      <SettingsField labelKey="label.loadRange" hintCopyKey="settings.hint.loadRange" featureId="FN-13">
        <NumberField
          value={chat.loadRange}
          onChange={(v) => setChat({ loadRange: v })}
          min={5}
          max={500}
          step={5}
          presets={[20, 30, 50, 100]}
          width={110}
        />
      </SettingsField>

      {/* —— FN-36 单会话消息上限 —— */}
      <SettingsField labelKey="label.maxPerSession" hintKey="hint.maxPerSession" featureId="FN-36">
        <NumberField
          value={maxPerSession}
          onChange={setMaxPerSession}
          min={100}
          max={200_000}
          step={1000}
          presets={[5000, 10_000, 20_000, 50_000]}
          width={130}
        />
      </SettingsField>

      {/* —— FN-04 上下文清洗 —— */}
      {/* 4 个清洗子项：标签统一走文案总表的 settings.clean.*（与聊天内上下文页同一套 key） */}
      <SettingsField labelCopyKey="settings.clean.removeEmpty" hintCopyKey="settings.hint.contextClean" featureId="FN-04">
        <Switch
          checked={chat.contextClean.removeEmpty}
          onChange={(e) => setChat({ contextClean: { removeEmpty: e.target.checked } })}
        />
      </SettingsField>
      <SettingsField labelCopyKey="settings.clean.dedupe" nested featureId="FN-04">
        <Switch
          checked={chat.contextClean.dedupe}
          onChange={(e) => setChat({ contextClean: { dedupe: e.target.checked } })}
        />
      </SettingsField>
      <SettingsField labelCopyKey="settings.clean.trimSystem" nested featureId="FN-04">
        <Switch
          checked={chat.contextClean.trimSystem}
          onChange={(e) => setChat({ contextClean: { trimSystem: e.target.checked } })}
        />
      </SettingsField>
      <SettingsField labelCopyKey="settings.clean.mergeConsecutive" nested featureId="FN-04">
        <Switch
          checked={chat.contextClean.mergeConsecutive}
          onChange={(e) => setChat({ contextClean: { mergeConsecutive: e.target.checked } })}
        />
      </SettingsField>

      {/* —— FN-30 提示词注入控制：12 段逐段勾选 —— */}
      <SettingsField labelKey="label.injectControl" hintCopyKey="settings.hint.injectControl" featureId="FN-30">
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 380 }}>
          {SEGMENT_ORDER.map((id) => {
            const on = segmentEnabled(chat.injectControl, id, isXinran);
            const owner = SEGMENT_CONTROL_KEY[id];
            // 归属大类有官方文案就显示中文（「角色设定」），否则显示段 id（逐段独立开关）
            const ownerText = OWNER_LABEL[owner] ? t(OWNER_LABEL[owner] as CopyKey) : owner;
            return (
              <Tooltip key={id} title={`${id} ← ${ownerText}`} arrow>
                <Chip
                  size="small"
                  variant={on ? 'filled' : 'outlined'}
                  color={on ? 'primary' : 'default'}
                  label={SEGMENT_LABELS[id]}
                  onClick={() => setSegment(id, !on)}
                />
              </Tooltip>
            );
          })}
        </Stack>
      </SettingsField>

      {/* —— FN-31 提示词约束 —— */}
      <SettingsField labelKey="label.promptConstraints" hintCopyKey="settings.hint.promptConstraints" featureId="FN-31">
        <TextField
          size="small"
          multiline
          minRows={2}
          maxRows={6}
          value={chat.promptConstraints}
          onChange={(e) => setChat({ promptConstraints: e.target.value })}
          sx={{ width: 260 }}
        />
      </SettingsField>

      {/* —— FN-34 时间感知 —— */}
      <SettingsField labelKey="label.timeAware" hintCopyKey="settings.hint.timeAware" featureId="FN-34">
        <Switch checked={chat.timeAware} onChange={(e) => setChat({ timeAware: e.target.checked })} />
      </SettingsField>
    </Box>
  );
}

export default ContextSection;
