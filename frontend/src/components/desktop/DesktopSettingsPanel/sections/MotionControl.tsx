/**
 * MotionControl — 动效开关三档（BLOCK-208 / W7c）。
 *
 * 取值语义：`system`=跟随系统 `prefers-reduced-motion`（默认，零行为变化）；
 * `full`=显式要求完整动效（可覆盖系统设置）；`reduced`=精简。
 * 真值走既有 `useTheme().setMotion` → `/api/user/prefs`（与其它外观偏好同一条链，
 * 不新开 API），localStorage 只是启动缓存（`prefCache` 的 `petri-motion`）。
 *
 * BLOCK-425 — 排版统一到 `SettingsField`：说明由两行长句压成一句，图标与其它外观项同族。
 */
import { useTheme } from '@/themes/ThemeProvider';
import type { MotionMode } from '@/themes/prefCache';
import { SettingsField } from '../SettingsField';

const OPTIONS: ReadonlyArray<{ value: MotionMode; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'full', label: '完整动效' },
  { value: 'reduced', label: '精简（减少动画）' },
];

export function MotionControl(): React.ReactElement {
  const { motion, setMotion } = useTheme();
  return (
    <SettingsField
      icon="zap"
      label="动效"
      htmlFor="motion-mode-select"
      hint="跟随系统「减弱动态」，或固定完整 / 精简"
    >
      <select
        id="motion-mode-select"
        value={motion}
        onChange={(event) => setMotion(event.target.value as MotionMode)}
        style={{
          height: 32,
          minWidth: 180,
          padding: '0 8px',
          border: '1px solid var(--petri-border)',
          borderRadius: 6,
          background: 'var(--petri-bg-surface)',
          color: 'var(--petri-text)',
        }}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </SettingsField>
  );
}
