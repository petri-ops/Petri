// ============================================================
// ConversationTimeline.tsx — BLOCK-107 P1b 会话信息流时间线渲染族；
// BLOCK-108 P2 按 Qoder 形态修订：过渡叙述（progress 分段）以正文式容器
// 上轴于对应簇之前（「模型说话 → 模型做事」），本迭代思考折入簇内
// （经 ToolsSegment.reasoning 传给 ToolActivityList），纯思考迭代仍独立
// 成思考节点。
//
// UI-437 v4 — 运行级折叠（ZCode 模型，用户裁决「多轮属于一个任务，增加
// 一层折叠；点开才是每轮思考和执行的细节」）：一次任务的多轮收敛为
// **一行运行摘要**（✓ 执行工具 N 次 · X 轮 · 耗时），完成后默认折叠；
// 点击展开后才渲染 过渡叙述 + 各轮思考/执行明细（内层簇由 forceOpen
// 托管为无簇头常驻行）。运行中不折叠（实时流式，最新事件可见）。
// ============================================================

import { useState } from 'react';

import { Icon } from '@/components/icons/Icon';

import { formatToolDuration } from './toolActivity';
import type { ConversationSegment, ReasoningSegment, ToolsSegment } from './conversationSegments';
import { ToolActivityList } from './ToolActivityList';

/**
 * 思考节点（UI-437 v4 加映 — 与工具行同款骨架：brain 图标 + 标签 + 箭头，
 * 去除旧的蓝色左界线/加粗标签差异样式；点击展开全文）。轮次号是内部
 * 实现细节，不在标签中暴露。
 */
function ReasoningSegmentRow({ segment }: { segment: ReasoningSegment }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="sc-tool-activity sc-tool-qoder-row sc-timeline-reasoning" data-iteration={segment.iteration}>
      <button
        type="button"
        className="sc-tool-row-head sc-tool-qoder-head"
        aria-expanded={open}
        aria-label={open ? '收起思考' : '展开思考'}
        title={open ? '收起思考' : '展开思考'}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sc-tool-qoder-glyph sc-tool-qoder-glyph-success" aria-hidden="true">✓</span>
        <span className="sc-tool-qoder-kind" aria-hidden="true">
          <Icon name="brain" size={12} />
        </span>
        <span className="sc-tool-qoder-label">思考</span>
        {!open && segment.preview && (
          <span className="sc-timeline-reasoning-preview">{segment.preview}</span>
        )}
        <span className="sc-tool-row-chevron" aria-hidden="true">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
      </button>
      {open && <p className="sc-tool-reasoning-text">{segment.text}</p>}
    </div>
  );
}

/**
 * 工具簇节点：交回 `ToolActivityList` 渲染。
 *
 * 不传 `processingDurationMs`——让簇头显示**本簇**活动耗时之和（`ToolActivityList`
 * 内部 `processingDurationMs ?? totalDurationMs` 的既有回退）。
 * UI-437 v4 — `forceOpen`：运行级展开后由外层托管折叠态，簇内无簇头、行常驻。
 */
function ToolsSegmentBlock({ segment, forceOpen }: { segment: ToolsSegment; forceOpen: boolean }): React.ReactElement {
  // BLOCK-108 P2 — 本迭代思考折入簇内（Qoder 形态：已思考单行在工具行之上）。
  const reasoningByIteration = segment.reasoning
    ? { [segment.iteration]: segment.reasoning }
    : undefined;
  return (
    <div
      className="sc-timeline-cluster"
      data-state={segment.state}
      data-iteration={segment.iteration}
    >
      <ToolActivityList
        activities={segment.activities}
        reasoningByIteration={reasoningByIteration}
        collapseWhenSettled
        showRunningStopwatch
        forceOpen={forceOpen}
      />
    </div>
  );
}

export interface ProgressSegmentMeta {
  /** 本轮首条阶段进度（= 意图而非结论，UI-305 ① 约定由宿主省略）。 */
  isFirst: boolean;
  /** 本轮末条阶段进度（宿主据此在 UI-305 ② 下补运行中标记）。 */
  isLast: boolean;
}

export interface ConversationTimelineProps {
  segments: ConversationSegment[];
  /**
   * 阶段进度上轴（D5 裁决：作为独立分段插在对应工具簇之后）。不传时 progress
   * 分段**被跳过**——宿主若仍在别处渲染阶段进度，保持不传以免重复展示。
   * 返回 null / false 时该分段不产出节点（首条意图与空结论走这条路径）。
   */
  renderProgress?: (
    segment: Extract<ConversationSegment, { kind: 'progress' }>,
    meta: ProgressSegmentMeta
  ) => React.ReactNode;
  /** 时间线容器附加类名。 */
  className?: string;
}

export function ConversationTimeline({
  segments,
  renderProgress,
  className,
}: ConversationTimelineProps): React.ReactElement | null {
  // UI-437 v4 — 运行级折叠：一次任务的多轮工具段收敛为一行运行摘要。
  const toolsSegments = segments.filter((segment): segment is ToolsSegment => segment.kind === 'tools');
  const hasTools = toolsSegments.length > 0;
  const runRunning = toolsSegments.some(
    (segment) => segment.state === 'running' || (segment.runningCount ?? 0) > 0
  );
  const [runExpanded, setRunExpanded] = useState(false);
  // 运行中（实时流式）或本段无工具时不折叠；完成后默认收起为运行摘要行。
  const runOpen = !hasTools || runRunning || runExpanded;

  const totalCalls = toolsSegments.reduce((n, s) => n + (s.totalCount ?? s.activities?.length ?? 0), 0);
  const totalFailed = toolsSegments.reduce((n, s) => n + (s.failedCount ?? 0), 0);
  const totalDurationMs = toolsSegments.reduce((n, s) => n + (s.durationMs ?? 0), 0);
  const totalDuration = totalDurationMs > 0 ? formatToolDuration(totalDurationMs) : null;

  const nodes: React.ReactNode[] = [];
  const progressTotal = segments.reduce(
    (count, segment) => (segment.kind === 'progress' ? count + 1 : count),
    0
  );
  let progressSeen = 0;
  for (const segment of segments) {
    if (segment.kind === 'reasoning') {
      nodes.push(<ReasoningSegmentRow key={`reasoning:${segment.iteration}`} segment={segment} />);
      continue;
    }
    if (segment.kind === 'tools') {
      nodes.push(
        <ToolsSegmentBlock
          key={`tools:${segment.iteration}`}
          segment={segment}
          forceOpen={runExpanded && !runRunning}
        />
      );
      continue;
    }
    if (segment.kind === 'progress') {
      if (!renderProgress) continue;
      progressSeen += 1;
      const rendered = renderProgress(segment, {
        isFirst: progressSeen === 1,
        isLast: progressSeen === progressTotal,
      });
      if (rendered == null || rendered === false) continue;
      // BLOCK-108 P2 — 过渡叙述容器：正文式段落（Qoder 形态「模型说话 → 模型做事」），
      // 不再沿用 .sc-agent-progress 的弱化进度排版；内容与行内语义归宿主回调。
      nodes.push(
        <div
          key={`progress:${segment.iteration}`}
          className="sc-timeline-transition"
          data-iteration={segment.iteration}
        >
          {rendered}
        </div>
      );
    }
    // narrative 由宿主在原位渲染（见文件头说明），此处不产出节点。
  }
  if (nodes.length === 0) return null;

  // UI-437 v4 — 完成后的折叠态：整段任务只剩一行运行摘要（点开才是细节）。
  if (hasTools && !runOpen) {
    return (
      <div className={className ? `sc-conversation-timeline ${className}` : 'sc-conversation-timeline'}>
        <div className="sc-tool-activity sc-tool-qoder-row sc-run-fold">
          <button
            type="button"
            className="sc-tool-row-head sc-tool-qoder-head sc-run-fold-line"
            aria-expanded={false}
            aria-label="展开执行过程"
            title="展开执行过程"
            onClick={() => setRunExpanded(true)}
          >
            <span className="sc-tool-qoder-glyph sc-tool-qoder-glyph-success" aria-hidden="true">✓</span>
            <span className="sc-tool-qoder-label">{`执行工具 ${totalCalls} 次 · ${toolsSegments.length} 轮`}</span>
            {totalFailed > 0 && (
              <span className="sc-tool-qoder-diffstat-del">{`${totalFailed} 项需注意`}</span>
            )}
            {totalDuration && <span className="sc-tool-activity-duration">{totalDuration}</span>}
            <span className="sc-tool-row-chevron" aria-hidden="true">
              <Icon name="chevron-right" size={12} />
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={className ? `sc-conversation-timeline ${className}` : 'sc-conversation-timeline'}>
      {runExpanded && hasTools && (
        <button
          type="button"
          className="sc-tool-row-head sc-tool-qoder-head sc-run-fold-line"
          aria-expanded={true}
          aria-label="收起执行过程"
          title="收起执行过程"
          onClick={() => setRunExpanded(false)}
        >
          <span className="sc-tool-qoder-glyph sc-tool-qoder-glyph-success" aria-hidden="true">✓</span>
          <span className="sc-tool-qoder-label">{`执行工具 ${totalCalls} 次 · ${toolsSegments.length} 轮`}</span>
          {totalFailed > 0 && (
            <span className="sc-tool-qoder-diffstat-del">{`${totalFailed} 项需注意`}</span>
          )}
          {totalDuration && <span className="sc-tool-activity-duration">{totalDuration}</span>}
          <span className="sc-tool-row-chevron" aria-hidden="true">
            <Icon name="chevron-down" size={12} />
          </span>
        </button>
      )}
      {nodes}
    </div>
  );
}

export default ConversationTimeline;
