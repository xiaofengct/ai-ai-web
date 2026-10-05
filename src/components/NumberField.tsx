import { useCallback, useEffect, useState } from 'react';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

/**
 * 数字输入（带档位预设）。
 * 用于主动消息间隔（FN-08）、停用超时（FN-09）、上下文条数（FN-05）等。
 */
export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  /** 档位预设（点击直接套用） */
  presets?: readonly number[];
  suffix?: string;
  disabled?: boolean;
  size?: 'small' | 'medium';
  /** 宽度（px） */
  width?: number;
}

export function NumberField({
  value,
  onChange,
  label,
  min = 0,
  max = 1_000_000,
  step = 1,
  presets,
  suffix,
  disabled = false,
  size = 'small',
  width = 120,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string>(String(value));

  // 外部值变化（重置主题 / 切换会话）时同步输入框
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = useCallback(
    (raw: string) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        setDraft(String(value));
        return;
      }
      const clamped = Math.min(max, Math.max(min, n));
      setDraft(String(clamped));
      if (clamped !== value) onChange(clamped);
    },
    [max, min, onChange, value],
  );

  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
      <TextField
        label={label}
        value={draft}
        size={size}
        disabled={disabled}
        type="number"
        inputProps={{ min, max, step }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
        sx={{ width }}
        {...(suffix ? { helperText: suffix } : {})}
      />
      {presets && presets.length > 0 ? (
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
          {presets.map((p) => (
            <Chip
              key={p}
              label={String(p)}
              size="small"
              variant={Number(draft) === p ? 'filled' : 'outlined'}
              onClick={() => {
                setDraft(String(p));
                onChange(p);
              }}
              disabled={disabled}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

export default NumberField;
