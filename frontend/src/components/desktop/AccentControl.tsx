// ============================================================
// AccentControl — BLOCK-49 加映三：主题色（强调色）选择控件。
//
// 色板圆点网格（5 档），选中打勾。独立于明暗维度（light/dark 照旧由
// ThemeControl 承载），状态经 ThemeProvider（localStorage + data-accent）。
// ============================================================
import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { ACCENT_OPTIONS, type AccentId } from '@/themes/accents';
import { useTheme } from '@/themes/ThemeProvider';
import './accent-control.css';

export function AccentControl(): React.ReactElement {
  const { accent, setAccent } = useTheme();

  return (
    <div className="accent-control" role="radiogroup" aria-label="选择主题色">
      {ACCENT_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={accent === option.id}
          className={`accent-control__swatch${accent === option.id ? ' is-active' : ''}`}
          style={{ ['--swatch' as string]: option.swatch }}
          onClick={() => setAccent(option.id)}
          title={option.label}
          aria-label={option.label}
        >
          {accent === option.id && <Icon name="check" size={13} />}
        </button>
      ))}
    </div>
  );
}
