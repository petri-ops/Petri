// ============================================================
// SelectionActionBar.tsx — BLOCK-246 C12 划词动作条（渲染面）
//
// 纯展示：位置由调用方按选区矩形算好（视口坐标），本组件只做「贴边翻转」——
// 靠右缘时向左展开，靠底部时向上翻，避免动作条被窗口切掉。
// 禁用项不隐藏（批注的"为什么不可用"必须看得见）。
// ============================================================
import type { SelectionActionSpec, SelectionActionId } from './selectionActions';

export interface SelectionActionBarProps {
  actions: SelectionActionSpec[];
  /** 选区矩形（视口坐标）。 */
  x: number;
  y: number;
  onPick: (id: SelectionActionId) => void;
}

const BAR_WIDTH = 340;
const BAR_HEIGHT = 36;

export function SelectionActionBar({ actions, x, y, onPick }: SelectionActionBarProps) {
  const viewportWidth = typeof window === 'undefined' ? BAR_WIDTH : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  const left = Math.max(8, Math.min(x, viewportWidth - BAR_WIDTH - 8));
  const top = y + BAR_HEIGHT + 12 > viewportHeight ? Math.max(8, y - BAR_HEIGHT - 8) : y + 8;

  return (
    <div
      className="sc-selection-bar"
      style={{ left, top, width: BAR_WIDTH }}
      role="toolbar"
      aria-label="选区动作"
      data-testid="sc-selection-bar"
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="sc-selection-action"
          disabled={action.disabled}
          title={action.hint}
          aria-label={`${action.label}：${action.hint}`}
          data-testid={`sc-selection-action-${action.id}`}
          // 用 mousedown preventDefault 保住页面选区（否则点按钮瞬间选区被清掉，
          // 后续 "加入对话" 就拿不到文字了——composer 菜单的同款纪律）。
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(action.id)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
