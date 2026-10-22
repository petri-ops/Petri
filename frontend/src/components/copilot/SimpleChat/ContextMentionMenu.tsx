// ============================================================
// ContextMentionMenu.tsx — BLOCK-245 P4 统一 `@` 上下文菜单（渲染面）
//
// 纯展示 + 鼠标回调：键盘导航状态（activeId）由宿主 hook（useContextMention）
// 持有并在 textarea 的 onKeyDown 里推进——菜单本身不抢焦点、不监听全局键盘
// （焦点必须留在 textarea，这是 composer 的既有纪律；故 item 用 onMouseDown
// preventDefault 保住选区）。
//
// 诚实性要求（P3 契约的 UI 兑现）：
//   · 空结果 → 说明「没有匹配」，不是空白面板；
//   · 源不可用 → 逐条列出原因（绝不静默吞掉）；
//   · 逐项上限截断 → 报「还有 N 条」，让用户知道被藏了东西；
//   · 源有界（如工作区树 500 条）→ 显示该源的 note。
//
// 形态：头部/提示/列表/空态/底部条复用 `.sc-slash-*`（同一浮层规格单源定义，
// 同时守住小字号棘轮）；分组长相与条目布局是本组件自有类。
// ============================================================
import {
  CONTEXT_SOURCE_CAPS,
  countContextCandidates,
  listUnavailableSources,
  type ContextCandidate,
  type ContextSourceResult,
} from './contextSources';

export interface ContextMentionMenuProps {
  /** 已按 query 过滤并在逐项上限内的七源结果（顺序 = CONTEXT_SOURCE_ORDER）。 */
  sources: ContextSourceResult[];
  /** 键盘高亮的候选 id（null = 无高亮，例如零候选）。 */
  activeId: string | null;
  loading: boolean;
  onPick: (candidate: ContextCandidate) => void;
  onHover: (candidate: ContextCandidate) => void;
}

export function ContextMentionMenu({
  sources,
  activeId,
  loading,
  onPick,
  onHover,
}: ContextMentionMenuProps) {
  const total = countContextCandidates(sources);
  const unavailable = listUnavailableSources(sources);
  const visible = sources.filter((source) => source.candidates.length > 0);

  return (
    <div className="sc-mention-panel" data-testid="sc-mention-panel" role="listbox" aria-label="上下文候选">
      <div className="sc-slash-header">
        <span className="sc-slash-title">上下文</span>
        <span className="sc-slash-hint">↑↓ 导航 · Enter 引用 · Esc 关闭</span>
      </div>
      <div className="sc-slash-list">
        {loading && total === 0 && (
          <div className="sc-slash-empty">正在加载上下文来源…</div>
        )}
        {!loading && total === 0 && (
          <div className="sc-slash-empty">没有匹配的上下文候选</div>
        )}
        {visible.map((source) => (
          <div className="sc-mention-group" key={source.sourceId}>
            <div className="sc-mention-group-head">
              <span className="sc-slash-title">{source.label}</span>
              <span className="sc-slash-hint">{source.candidates.length}</span>
            </div>
            {source.candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="option"
                aria-selected={candidate.id === activeId}
                className={`sc-mention-item${candidate.id === activeId ? ' sc-mention-item-focused' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHover(candidate)}
                onClick={() => onPick(candidate)}
              >
                <span className="sc-slash-item-label" title={candidate.label}>{candidate.label}</span>
                <span className="sc-slash-item-desc" title={candidate.detail}>{candidate.detail}</span>
                <span className="sc-mention-item-source">{source.label}</span>
              </button>
            ))}
            {source.note && <div className="sc-mention-note">{source.note}</div>}
            {source.truncated > 0 && (
              <div className="sc-mention-note">
                还有 {source.truncated} 条未显示（{source.label}每组最多 {CONTEXT_SOURCE_CAPS[source.sourceId]} 条，输入更精确的关键字可缩小范围）
              </div>
            )}
          </div>
        ))}
        {unavailable.length > 0 && (
          <div className="sc-mention-unavailable">
            {unavailable.map((source) => (
              <div key={source.sourceId} className="sc-mention-unavailable-row">
                <span className="sc-mention-unavailable-label">{source.label}不可用</span>
                <span>{source.unavailableReason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="sc-slash-help-hint">输入关键字筛选 · 选中项以引用块随下一条消息上行</div>
    </div>
  );
}
