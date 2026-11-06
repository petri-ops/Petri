/**
 * 模型偏好控件（图 1 / 图 2 形态）：思考强度分段滑条 + 上下文窗口刻度滑条。
 * 模型菜单与设置页复用同一实现；档位词表来自 thinkingLevel.ts / context-window-options.ts，
 * 不在这里声明第二份档位或标签。
 */
import React from 'react';
import { THINKING_LEVEL_LABELS, type ThinkingLevel } from '@/components/copilot/thinkingLevel';
import { formatContextWindow } from '@/lib/format-context-window';
import {
  CONTEXT_WINDOW_OPTIONS,
  contextWindowScale,
} from '@/lib/context-window-options';
import styles from './ModelPreferenceControls.module.css';

function levelLabel(level: string): string {
  return THINKING_LEVEL_LABELS[level as ThinkingLevel] ?? level;
}

export function ThinkingEffortSlider({
  value,
  options,
  onChange,
  disabled = false,
  disabledReason,
  compact = false,
  testId = 'model-menu-thinking-level',
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  disabled?: boolean;
  disabledReason?: string;
  compact?: boolean;
  testId?: string;
}): React.ReactElement {
  const index = Math.max(0, options.indexOf(value));
  return (
    <div className={`${styles.field} ${compact ? styles.compact : ''}`} data-disabled={disabled ? 'true' : undefined}>
      <div className={styles.fieldHead}>
        <span className={styles.label}>思考强度</span>
        <span className={styles.value}>{levelLabel(value)}</span>
      </div>
      <input
        type="range"
        className={styles.slider}
        min={0}
        max={Math.max(0, options.length - 1)}
        step={1}
        value={index}
        disabled={disabled}
        aria-label="思考强度"
        data-testid={testId}
        data-level={value}
        onChange={(event) => {
          const next = options[Number(event.target.value)];
          if (next) onChange(next);
        }}
      />
      <div className={styles.ticks}>
        {options.map((level, i) => (
          <button
            key={level}
            type="button"
            className={`${styles.tick} ${i === index ? styles.tickActive : ''}`}
            disabled={disabled}
            aria-label={`思考强度：${levelLabel(level)}`}
            onClick={() => onChange(level)}
          >
            {levelLabel(level)}
          </button>
        ))}
      </div>
      {disabled && disabledReason && <div className={styles.reason}>{disabledReason}</div>}
    </div>
  );
}

export function ContextWindowScale({
  value,
  options = CONTEXT_WINDOW_OPTIONS,
  onChange,
  compact = false,
  testId = 'model-menu-context-window',
}: {
  value: number | undefined;
  options?: readonly number[];
  onChange: (next: number) => void;
  compact?: boolean;
  testId?: string;
}): React.ReactElement {
  const stops = contextWindowScale(value, options);
  const current = value && value > 0 ? Math.round(value) : stops[0];
  const index = Math.max(0, stops.indexOf(current));
  const shown = new Set([0, Math.floor((stops.length - 1) / 2), stops.length - 1]);
  return (
    <div className={`${styles.field} ${compact ? styles.compact : ''}`}>
      <div className={styles.fieldHead}>
        <span className={styles.label}>上下文窗口</span>
        <span className={styles.value}>{formatContextWindow(current)}</span>
      </div>
      <input
        type="range"
        className={styles.slider}
        min={0}
        max={Math.max(0, stops.length - 1)}
        step={1}
        value={index}
        aria-label="上下文窗口"
        data-testid={testId}
        data-value={current}
        onChange={(event) => {
          const next = stops[Number(event.target.value)];
          if (next) onChange(next);
        }}
      />
      <div className={styles.ticks}>
        {stops.map((stop, i) => (
          <span key={stop} className={i === index ? styles.tickActive : styles.tickStatic}>
            {shown.has(i) ? formatContextWindow(stop) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
