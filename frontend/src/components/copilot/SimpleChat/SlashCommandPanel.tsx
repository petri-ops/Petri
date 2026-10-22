// ============================================================
// SlashCommandPanel.tsx — 斜杠命令面板（从 SimpleChat.tsx 内联 JSX 原样平移）
//
// BLOCK-245 P4 平移：`@` 上下文菜单要落进同一处 composer 上方浮层，而
// SimpleChat.tsx 受 code-size 棘轮（2121 行只减不增）。平移**零行为变化**：
// class 名、DOM 结构、文案、ref 归属（panelRef 仍归宿主的 outside-click 判定）
// 一律照搬，`simple-chat.css` 不动。
// ============================================================
import type { RefObject } from 'react';
import type { SlashEntry } from './slashSources';

export interface SlashCommandPanelProps {
  open: boolean;
  query: string;
  /** 已过滤的命令条目（动作 + 技能 + 模板混排）。 */
  entries: SlashEntry[];
  focusedIndex: number;
  panelRef: RefObject<HTMLDivElement>;
  listRef: RefObject<HTMLDivElement>;
  onFocusIndex: (index: number) => void;
  /** 传回复合 id（`skill:` / `template:` 前缀由宿主分类）。 */
  onPick: (commandId: string) => void;
}

export function SlashCommandPanel({
  open,
  query,
  entries,
  focusedIndex,
  panelRef,
  listRef,
  onFocusIndex,
  onPick,
}: SlashCommandPanelProps) {
  if (!open) return null;
  return (
    <div className="sc-slash-panel" ref={panelRef}>
      <div className="sc-slash-header">
        <span className="sc-slash-title">命令</span>
        <span className="sc-slash-hint">↑↓ 导航 · Enter 执行 · Esc 关闭</span>
      </div>
      <div className="sc-slash-list" ref={listRef}>
        {entries.length === 0 ? (
          <div className="sc-slash-empty">未找到匹配命令</div>
        ) : (
          entries.map((cmd, index) => (
            <button
              key={`${cmd.kind}:${cmd.id}`}
              type="button"
              className={`sc-slash-item ${index === focusedIndex ? 'sc-slash-item-focused' : ''}`}
              onClick={() => onPick(cmd.kind === 'action' ? cmd.id : `${cmd.kind}:${cmd.id}`)}
              onMouseEnter={() => onFocusIndex(index)}
            >
              {cmd.kind !== 'action' && (
                <span
                  className="sc-slash-item-label"
                  style={{ marginRight: 6, fontSize: 'var(--petri-font-size-sm)', color: 'var(--petri-accent, #3b82f6)' }}
                >
                  {cmd.kind === 'skill' ? '技能' : '模板'}
                </span>
              )}
              <span className="sc-slash-item-label">{cmd.label}</span>
              <span className="sc-slash-item-desc">{cmd.description}</span>
            </button>
          ))
        )}
      </div>
      {query === '' && entries.length > 0 && (
        <div className="sc-slash-help-hint">输入 / 或命令名称搜索</div>
      )}
    </div>
  );
}
