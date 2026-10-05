import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { NumberField } from '@/components/NumberField';
import { SettingsField } from '../SettingsField';
import { TimelinePreview } from './TimelinePreview';
import { useSettingsStore } from '@/store/settingsStore';
import { sl } from '../settingsCopy';

/**
 * ★★ 「朋友圈」设置分区（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户要求：动态要「支持设定发布的时机与频率」
 * ═══════════════════════════════════════════════════════════════════════════
 * 拆成四个**正交**的旋钮，而不是一个笼统的"频率"档位 ——
 * 因为"发得勤不勤"和"什么时候能发"是两个独立问题：
 *
 * | 旋钮 | 回答的问题 |
 * |---|---|
 * | 总开关 | 要不要让她自己发 |
 * | `intervalMin` | **两条之间至少隔多久**（防连发） |
 * | `maxPerDay` | **一天最多几条**（硬上限，防刷屏 + 控成本） |
 * | `onlyActiveHours` | **要不要跟着她的作息**（夜班日的白天别发） |
 *
 * ★ `intervalMin` 与 `maxPerDay` 是**与**关系（都要满足）——
 *   只用间隔：设成 60 分钟就是一天最多 24 条；只用上限：3 条能在一小时内连发完。
 *   理由完整版见 `proactive/momentGate.ts` 文件头。
 *
 * ★ 定时器**不在本页**：发布时机由全局调度器在每次 tick 时判断
 *   （与主动消息共用同一个 tick），本页只负责改那几个判据的取值。
 *   如果这里放一个"每小时跑一次"的定时器，就会和调度器各跑一套，
 *   出现"页面开着才发、关了就不发"这种荒唐行为。
 */
export function MomentsSection(): JSX.Element {
  const chat = useSettingsStore((s) => s.settings.chat);
  const setChat = useSettingsStore((s) => s.setChat);
  const m = chat.moments;
  const [showPreview, setShowPreview] = useState(false);

  return (
    <Stack spacing={0}>
      <SettingsField labelKey="label.momentsAuto" hintKey="hint.momentsAuto">
        <Switch
          checked={m.enabled}
          onChange={(e) => setChat({ moments: { enabled: e.target.checked } })}
        />
      </SettingsField>

      {/*
        ★ 下面四项在总开关关闭时**仍然全部显示**（不 hide）——
          让用户能看到"打开之后会是什么样"，而不是先开开关才看得到选项。
          但整块加一个降透明度，明确"这些现在没生效"。
          （隐藏会让用户误以为那些选项不存在，从而不打开开关。）
      */}
      <Stack sx={{ opacity: m.enabled ? 1 : 0.5, pointerEvents: m.enabled ? 'auto' : 'none' }}>
        <SettingsField labelKey="label.momentsInterval" hintKey="hint.momentsInterval">
          <NumberField
            value={m.intervalMin}
            onChange={(v) => setChat({ moments: { intervalMin: v } })}
            min={30}
            max={24 * 60}
            step={30}
            presets={[120, 360, 720, 1440]}
            width={110}
          />
        </SettingsField>

        <SettingsField labelKey="label.momentsDaily" hintKey="hint.momentsDaily">
          <NumberField
            value={m.maxPerDay}
            onChange={(v) => setChat({ moments: { maxPerDay: v } })}
            min={1}
            max={12}
            step={1}
            presets={[1, 2, 3, 5]}
            width={90}
          />
        </SettingsField>

        <SettingsField labelKey="label.momentsActiveHours" hintKey="hint.momentsActiveHours">
          <Switch
            checked={m.onlyActiveHours}
            onChange={(e) => setChat({ moments: { onlyActiveHours: e.target.checked } })}
          />
        </SettingsField>

        <SettingsField labelKey="label.momentsWorldContext" hintKey="hint.momentsWorldContext">
          <Switch
            checked={m.useWorldContext}
            onChange={(e) => setChat({ moments: { useWorldContext: e.target.checked } })}
          />
        </SettingsField>

        <SettingsField labelKey="label.momentsSticker" hintKey="hint.momentsSticker">
          <Switch
            checked={m.allowSticker}
            onChange={(e) => setChat({ moments: { allowSticker: e.target.checked } })}
          />
        </SettingsField>
      </Stack>

      <SettingsField labelKey="label.momentsPreview">
        <Switch checked={showPreview} onChange={(e) => setShowPreview(e.target.checked)} />
      </SettingsField>

      {showPreview ? <TimelinePreview /> : null}

      {/*
        ★ 把"她发动态会花额度"写在设置页上，而不是只在文档里 ——
          这是用户真的会关心的事（每一次动态 = 一次 LLM 调用）。
          放在这里而不是弹窗提示：弹窗只在开关那一刻出现，之后用户就忘了。
      */}
      <Alert severity="info" sx={{ mt: 1, py: 0.25 }}>
        <Typography variant="caption">{sl('note.momentsCost')}</Typography>
      </Alert>
    </Stack>
  );
}

export default MomentsSection;
