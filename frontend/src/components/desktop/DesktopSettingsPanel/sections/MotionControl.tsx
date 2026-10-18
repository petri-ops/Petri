/**
 * MotionControl — 动效开关三档（BLOCK-208 / W7c）。
 *
 * 取值语义：`system`=跟随系统 `prefers-reduced-motion`（默认，零行为变化）；
 * `full`=显式要求完整动效（可覆盖系统设置）；`reduced`=精简。
 * 真值走既有 `useTheme().setMotion` → `/api/user/prefs`（与其它外观偏好同一条链，
 * 不新开 API），localStorage 只是启动缓存（`prefCache` 的 `petri-motion`）。
 */
import { useTheme } from '@/themes/ThemeProvider';
import type { MotionMode } from '@/themes/prefCache';

const OPTIONS: ReadonlyArray<{ value: MotionMode; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'full', label: '完整动效' },
  { value: 'reduced', label: '精简（减少动画）' },
];

export function MotionControl(): React.ReactElement {
  const { motion, setMotion } = useTheme();
  return (
    <div className="petri-field">
      <label className="petri-field__label" htmlFor="motion-mode-select">动效</label>
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
      <p className="petri-field__hint">
        跟随系统时读取 macOS 的「减弱动态效果」；选「精简」会关闭本应用界面的过渡与动画（不影响模型输出内容）。
      </p>
    </div>
  );
}
