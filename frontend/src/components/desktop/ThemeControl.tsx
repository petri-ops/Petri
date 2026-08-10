import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = options.find((option) => option.value === preference) || options[0];

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  // Move focus into the menu on open (to the active/checked option).
  useEffect(() => {
    if (!open) return;
    const activeIndex = options.findIndex((option) => option.value === preference);
    optionRefs.current[activeIndex === -1 ? 0 : activeIndex]?.focus();
  }, [open, preference]);

  const moveFocus = (offset: number) => {
    const count = options.length;
    const currentIndex = optionRefs.current.findIndex((node) => node === document.activeElement);
    const base = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (base + offset + count) % count;
    optionRefs.current[nextIndex]?.focus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      optionRefs.current[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      optionRefs.current[options.length - 1]?.focus();
    }
  };

  return (
    <div
      className={`biof3-theme-control ${compact ? 'biof3-theme-control--compact' : ''} ${menuPlacement === 'bottom' ? 'biof3-theme-control--menu-bottom' : ''}`}
      ref={rootRef}
    >
      {open && (
        <div
          className="biof3-theme-control__menu"
          role="menu"
          aria-label="选择外观主题"
          onKeyDown={onMenuKeyDown}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={preference === option.value}
              tabIndex={preference === option.value ? 0 : -1}
              className="biof3-theme-control__option"
              onClick={() => {
                setPreference(option.value);
                close();
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
        ref={triggerRef}
        className="biof3-theme-control__trigger"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
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
