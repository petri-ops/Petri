import React from 'react';
import { SegmentBoundary } from '@/components/shell/SegmentBoundary';

/**
 * BLOCK-248（Q3）— 轮次边界：一条消息（含时间线/工具行/正文）渲染崩了只坏这一条，
 * 其余对话照常。挂在消息行外层；无错误时不产生额外 DOM（SegmentBoundary 契约）。
 */
export function TurnBoundary({
  resetKey,
  children,
}: {
  resetKey: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <SegmentBoundary
      segment="turn"
      resetKey={resetKey}
      title="这一轮没能渲染出来"
      description="只是这一轮出错，其余对话不受影响。可以重试这一段，或复制诊断。"
    >
      {children}
    </SegmentBoundary>
  );
}

/**
 * BLOCK-248（Q3）— 工具行边界：一行工具记录渲染崩了只坏这一行（不连带整轮）。
 */
export function ToolRowBoundary({
  resetKey,
  children,
}: {
  resetKey: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <SegmentBoundary
      segment="tool-row"
      resetKey={resetKey}
      title="这一行工具记录没能渲染出来"
      description="只是这一行出错，本轮其他记录不受影响。可以重试这一段。"
    >
      {children}
    </SegmentBoundary>
  );
}
