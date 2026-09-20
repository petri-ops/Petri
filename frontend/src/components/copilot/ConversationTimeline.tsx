// ============================================================
// ConversationTimeline.tsx — BLOCK-107 P1b 会话信息流时间线渲染族。
//
// 把 `conversationSegments.buildConversationSegments` 产出的有序分段渲染成
// **沿时间轴分节**的交错序列：思考节点 → 工具簇 → 思考节点 → 工具簇 → ……，
// 取代现状「一个摘要条收编全部工具、正文另在末尾」的类型分组堆叠。
//
// 复用策略（零重复实现）：每个 tools 分段交回既有 `ToolActivityList` 渲染
// ——簇头一行（`已完成 N 项 · …`）+ 就地展开活动行/终端块；本组件**不传**
// `reasoningByIteration`，避免思考行在簇内二次渲染（思考已由本组件按
// iteration 独立成节点）。故 `ToolActivityList` 内部与既有测试保持不动。
//
// narrative（最终正文）**不由本组件渲染**——宿主在原位渲染 markdown。progress（阶段
// 进度）经 `renderProgress` 回调上轴（D5：作为独立分段插在对应工具簇之后）：本组件
// 只负责它在脊线上的位置与「首/末」判定，行内容与 UI-305 的省略、运行中语义归宿主。
// ============================================================

import { useState } from 'react';

import { Icon } from '@/components/icons/Icon';

import type { ConversationSegment, ReasoningSegment, ToolsSegment } from './conversationSegments';
import { UNGROUPED_ITERATION } from './conversationSegments';
import { ToolActivityList } from './ToolActivityList';

/**
 * 思考节点：折叠态为一行（标签 + 首行预览），点击展开全文。
 * 相比既有 `ReasoningRow`（UI-272）新增 `preview` 一行预览——折叠态即可看出
 * 这一轮在琢磨什么，不必逐条点开。
 */
function ReasoningSegmentRow({ segment }: { segment: ReasoningSegment }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const label = segment.iteration > UNGROUPED_ITERATION
    ? `思考 · 第 ${segment.iteration} 轮`
    : '思考';
  return (
    <div className="sc-tool-reasoning sc-timeline-reasoning" data-iteration={segment.iteration}>
      <button
        type="button"
        className="sc-tool-row-head sc-tool-reasoning-head"
        data-expanded={open || undefined}
        aria-expanded={open}
        aria-label={open ? `收起${label}` : `展开${label}`}
        title={open ? '收起思考' : '展开思考'}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sc-tool-reasoning-label">{label}</span>
        {!open && segment.preview && (
          <span className="sc-timeline-reasoning-preview">{segment.preview}</span>
        )}
        <span className="sc-tool-row-chevron" aria-hidden="true">
          <Icon name="chevron-right" size={12} />
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
 * 内部 `processingDurationMs ?? totalDurationMs` 的既有回退），比整轮耗时更贴近
 * 「这一批工具花了多久」。`data-state` 供样式与后续策略使用（running 展开 /
 * settled 自动收起由 `ToolActivityList` 既有行为承载）。
 */
function ToolsSegmentBlock({ segment }: { segment: ToolsSegment }): React.ReactElement {
  return (
    <div
      className="sc-timeline-cluster"
      data-state={segment.state}
      data-iteration={segment.iteration}
    >
      <ToolActivityList activities={segment.activities} collapseWhenSettled showRunningStopwatch />
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
      nodes.push(<ToolsSegmentBlock key={`tools:${segment.iteration}`} segment={segment} />);
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
      // 容器同时携带 .sc-agent-progress 的排版（色阶/字号由它给），
      // .sc-timeline-progress 只补轴节奏——避免为同一视觉再写一套 token。
      nodes.push(
        <div
          key={`progress:${segment.iteration}`}
          className="sc-timeline-progress sc-agent-progress"
        >
          {rendered}
        </div>
      );
    }
    // narrative 由宿主在原位渲染（见文件头说明），此处不产出节点。
  }
  if (nodes.length === 0) return null;
  return (
    <div className={className ? `sc-conversation-timeline ${className}` : 'sc-conversation-timeline'}>
      {nodes}
    </div>
  );
}

export default ConversationTimeline;
