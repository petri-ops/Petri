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
// narrative（最终正文）与 progress（阶段进度）**不由本组件渲染**：
// 前者由宿主在原位渲染 markdown；后者实测全库仅 1 条（plan §0.6⑤），
// 继续由宿主既有 `AgentProgressList` 渲染，本组件仅提供可选回调以免重复。
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
      <ToolActivityList activities={segment.activities} />
    </div>
  );
}

export interface ConversationTimelineProps {
  segments: ConversationSegment[];
  /**
   * 可选：阶段进度分段的渲染回调。不传时 progress 分段**被跳过**——宿主若已
   * 用 `AgentProgressList` 渲染阶段进度，必须保持不传以免重复展示（D5 的
   * 「插在对应工具簇之后」由宿主在传入回调后自然成立）。
   */
  renderProgress?: (segment: Extract<ConversationSegment, { kind: 'progress' }>) => React.ReactNode;
  /** 时间线容器附加类名。 */
  className?: string;
}

export function ConversationTimeline({
  segments,
  renderProgress,
  className,
}: ConversationTimelineProps): React.ReactElement | null {
  const nodes: React.ReactNode[] = [];
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
      nodes.push(
        <div key={`progress:${segment.iteration}`} className="sc-timeline-progress">
          {renderProgress(segment)}
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
