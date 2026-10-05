import { useEffect, useState } from 'react';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import ClearIcon from '@mui/icons-material/Clear';
import SearchIcon from '@mui/icons-material/Search';
import { useDebounced } from '@/hooks/useDebounced';
import { DEFAULT_DEBOUNCE_MS } from '@/constants/limits';
import { t } from '@/copy';

/**
 * 搜索框（防抖）。用于聊天搜索（PG-03）、记忆库（PG-12）、人设列表。
 */
export interface SearchBarProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 防抖间隔（ms） */
  delay?: number;
  /** 受控模式下由外部提供 value，内部只做防抖上报 */
  fullWidth?: boolean;
  autoFocus?: boolean;
}

export function SearchBar({
  value,
  onChange,
  // ★ 默认占位符走文案总表（common.search = '搜一下'），
  //   不在组件里写中文字面量——否则改文案要翻组件代码。
  placeholder = t('common.search'),
  delay = DEFAULT_DEBOUNCE_MS,
  fullWidth = true,
  autoFocus = false,
}: SearchBarProps) {
  const [draft, setDraft] = useState(value ?? '');
  const debounced = useDebounced(draft, delay);

  useEffect(() => {
    if (value !== undefined && value !== draft) setDraft(value);
    // 仅在外部 value 变化时同步，避免输入过程中被回写
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <TextField
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      placeholder={placeholder}
      size="small"
      fullWidth={fullWidth}
      autoFocus={autoFocus}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" />
          </InputAdornment>
        ),
        endAdornment: draft ? (
          <InputAdornment position="end">
            <IconButton
              size="small"
              onClick={() => {
                setDraft('');
                onChange('');
              }}
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          </InputAdornment>
        ) : null,
      }}
    />
  );
}

export default SearchBar;
