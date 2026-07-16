import React, { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { type ThemePreference, useTheme } from '@/themes/ThemeProvider';
import './theme-control.css';

const options: Array<{ value: ThemePreference; label: string; icon: IconName }> = [
  { value: 'system', label: '跟随系统', icon: 'cpu' },
  { value: 'light', label: '日间模式', icon: 'sun' },
  { value: 'dark', label: '夜间模式', icon: 'moon' },
];

export function ThemeControl({
  compact = false,
  menuPlacement = 'top',
}: {
  compact?: boolean;
  menuPlacement?: 'top' | 'bottom';
}): React.ReactElement {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === preference) || options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div
      className={`biof3-theme-control ${compact ? 'biof3-theme-control--compact' : ''} ${menuPlacement === 'bottom' ? 'biof3-theme-control--menu-bottom' : ''}`}
      ref={rootRef}
    >
      {open && (
        <div className="biof3-theme-control__menu" role="menu" aria-label="选择外观主题">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={preference === option.value}
              className="biof3-theme-control__option"
              onClick={() => {
                setPreference(option.value);
                setOpen(false);
              }}
            >
              <Icon name={option.icon} size={15} />
              <span>{option.label}</span>
              {preference === option.value && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="biof3-theme-control__trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${current.label}（当前${resolvedTheme === 'dark' ? '夜间' : '日间'}）`}
      >
        <Icon name={current.icon} size={16} />
        {!compact && <span>{current.label}</span>}
        {!compact && <Icon name="chevron-up" size={13} />}
      </button>
    </div>
  );
}
