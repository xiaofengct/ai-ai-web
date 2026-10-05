import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useSettingsStore } from '@/store/settingsStore';
import { useVisibility } from '@/hooks/useVisibility';

/**
 * 桌宠生命值（FN-41）。
 *
 * ★ 定位：**本地数值模拟，只影响桌宠的表情与状态条，不参与人格、不进提示词。**
 *   真正的情绪状态由 jiwen 的五轴驱动（`src/proactive/`），这里不另起一套数值系统
 *   （`docs/04-开源复用评估.md` §7：情绪/生命值不自研第二套）。
 *
 * 规则：
 * - 互动（点击 / 聊天 / 收到主动消息）→ 涨；
 * - 晾着不动 → 按时间衰减；
 * - 页面隐藏 → **完全暂停**（SV-04 降级约定：后台不跑动画、不跑计时）。
 *
 * 文案纪律：本文件在 `src/features/` 下，受 `npm run lint:copy` 扫描，
 * 因此**不出现中文字符串字面量**；需要中文的地方一律走 `t(CopyKey)`。
 */

/** 生命值上限 */
export const PET_LIFE_MAX = 100;
/** 生命值下限 */
export const PET_LIFE_MIN = 0;
/** 晾着每分钟掉多少（约 33 小时从满值掉到 0，够温和） */
export const PET_LIFE_DECAY_PER_MIN = 0.05;
/** 一次最多补多少（防止狂点刷满） */
export const PET_LIFE_MAX_GAIN_PER_INTERACTION = 6;

/** 互动类型 → 生命值增减 */
export const PET_INTERACTION_DELTA: Readonly<Record<PetInteractionKind, number>> = {
  /** 戳一下桌宠 */
  tap: 1.5,
  /** 在聊天里发一条消息 */
  chat: 0.8,
  /** 收到她的一条主动消息 */
  proactive: 0.5,
  /** 长时间不理她（由调用方按分钟数传负 delta） */
  neglect: -1,
};

export type PetInteractionKind = 'tap' | 'chat' | 'proactive' | 'neglect';

export type PetLifeStage = 'great' | 'ok' | 'low' | 'bad';

/** 生命值 → 阶段（只影响桌宠表情，不涉及人格） */
export function petLifeStage(life: number): PetLifeStage {
  const v = clampLife(life);
  if (v >= 75) return 'great';
  if (v >= 45) return 'ok';
  if (v >= 20) return 'low';
  return 'bad';
}

/** ASCII 表情（不用 emoji：多平台字形不一致，且本项目不引入表情依赖） */
export const PET_FACE: Readonly<Record<PetLifeStage, string>> = {
  great: '^w^',
  ok: '-w-',
  low: '._.',
  bad: 'T_T',
};

export function clampLife(life: number): number {
  if (!Number.isFinite(life)) return PET_LIFE_MAX;
  return Math.max(PET_LIFE_MIN, Math.min(PET_LIFE_MAX, life));
}

/** 生命值条的颜色（走 MUI 语义色，不写死色值） */
function stageColor(stage: PetLifeStage): 'success' | 'info' | 'warning' | 'error' {
  switch (stage) {
    case 'great':
      return 'success';
    case 'ok':
      return 'info';
    case 'low':
      return 'warning';
    default:
      return 'error';
  }
}

/**
 * 生命值状态机 Hook。
 * - 衰减只在页面可见时进行（隐藏即暂停）；
 * - 写库**节流**：累计变化 ≥1 才落一次，避免每次互动都触发 settings 持久化；
 * - `managed=false`：只读模式（不跑衰减计时、不写库），
 *   供「已经有人在管数值」的地方复用展示（如桌宠里嵌的 `<PetLife value=... />`），
 *   避免两个组件各跑一个计时器导致衰减翻倍。
 */
export function usePetLife(managed = true): {
  life: number;
  stage: PetLifeStage;
  interact(kind: PetInteractionKind): void;
  setLife(next: number): void;
} {
  const petLife = useSettingsStore((s) => s.settings.appearance.petLife);
  const setAppearance = useSettingsStore((s) => s.setAppearance);
  const visible = useVisibility();

  const [life, setLifeState] = useState<number>(() => clampLife(petLife));
  /** 最近一次落库的值，用于节流 */
  const persistedRef = useRef<number>(life);

  // 外部（设置页）改了数值时同步进来
  useEffect(() => {
    if (!managed) return;
    setLifeState(clampLife(petLife));
    persistedRef.current = clampLife(petLife);
  }, [petLife, managed]);

  const persist = useCallback(
    (next: number) => {
      persistedRef.current = next;
      setAppearance({ petLife: Math.round(next * 100) / 100 });
    },
    [setAppearance],
  );

  const setLife = useCallback(
    (next: number) => {
      const value = clampLife(next);
      setLifeState(value);
      if (Math.abs(value - persistedRef.current) >= 1) persist(value);
    },
    [persist],
  );

  const interact = useCallback(
    (kind: PetInteractionKind) => {
      const delta = PET_INTERACTION_DELTA[kind] ?? 0;
      setLifeState((prev) => {
        const value = clampLife(prev + delta);
        if (Math.abs(value - persistedRef.current) >= 1) persist(value);
        return value;
      });
    },
    [persist],
  );

  // ★ 衰减：只在可见时跑；隐藏期间不累积（页面被冻结时计时本来也不可靠）
  useEffect(() => {
    if (!visible || !managed) return undefined;
    const timer = window.setInterval(() => {
      setLifeState((prev) => {
        const value = clampLife(prev - PET_LIFE_DECAY_PER_MIN);
        if (Math.abs(value - persistedRef.current) >= 1) persist(value);
        return value;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [visible, managed, persist]);

  // 卸载时把不足 1 的尾数补写一次，避免丢掉最后一次互动
  useEffect(
    () => () => {
      if (!managed) return;
      if (Math.abs(life - persistedRef.current) > 0.01) {
        setAppearance({ petLife: Math.round(life * 100) / 100 });
      }
    },
    // 只在卸载时执行：故意不依赖 life，避免每次变化都重挂
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setAppearance, managed],
  );

  const stage = useMemo(() => petLifeStage(life), [life]);
  return { life, stage, interact, setLife };
}

export interface PetLifeProps {
  /** 受控值；不传则用 Hook 自己维护的那份 */
  value?: number;
  /** 是否显示百分比数字 */
  showValue?: boolean;
  /** 紧凑模式（桌宠内嵌时用） */
  dense?: boolean;
  /** 提示气泡（走 CapabilityGate 的降级说明） */
  tooltip?: string;
}

/** 生命值条（设置页与桌宠共用） */
export function PetLife({ value, showValue = true, dense = false, tooltip }: PetLifeProps): JSX.Element {
  // 受控时只做展示（不跑衰减、不写库），避免与宿主各跑一个计时器
  const hook = usePetLife(value === undefined);
  const life = value ?? hook.life;
  const stage = petLifeStage(life);

  const bar = (
    <Box sx={{ width: '100%', minWidth: dense ? 72 : 180 }}>
      <LinearProgress
        variant="determinate"
        value={(clampLife(life) / PET_LIFE_MAX) * 100}
        color={stageColor(stage)}
        sx={{ height: dense ? 5 : 8, borderRadius: 999 }}
      />
      {showValue ? (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.7, lineHeight: 1.2 }}>
          {`${Math.round(clampLife(life))} / ${PET_LIFE_MAX}  ${PET_FACE[stage]}`}
        </Typography>
      ) : null}
    </Box>
  );

  if (!tooltip) return bar;
  return (
    <Tooltip title={tooltip} arrow>
      {bar}
    </Tooltip>
  );
}

export default PetLife;
