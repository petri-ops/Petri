import React from 'react';

/**
 * item88 计量卡（设计稿 §4.5）：子任务粒度 tok / 费用 / 时长 / 轮数。
 * 纯加视图——数据来自 ai_usage 聚合与 loop/iteration 事件，不新账本、不碰会话卡区。
 */
interface WorkbenchTaskUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostCny: number;
  latencyMs: number;
}

export interface WorkbenchMetricsCardProps {
  taskId: string;
  usage: WorkbenchTaskUsage;
  rounds: number;
}

export function WorkbenchMetricsCard({ taskId, usage, rounds }: WorkbenchMetricsCardProps): React.ReactElement {
  const totalTokens = (usage.inputTokens || 0) + (usage.outputTokens || 0);
  return (
    <div
      data-testid="workbench-metrics-card"
      data-task-id={taskId}
      style={{
        display: 'flex', gap: 12, padding: 6, marginTop: 4,
        border: '1px solid var(--petri-border-card, var(--petri-border))',
        borderRadius: 6, background: 'var(--petri-bg-subtle)',
        fontSize: 'var(--petri-font-size-xs)', color: 'var(--petri-text-secondary)',
      }}
    >
      <span data-testid="wb-metrics-tokens">{`tok ${totalTokens.toLocaleString('en-US')}`}</span>
      <span data-testid="wb-metrics-cost">{`¥${(usage.estimatedCostCny || 0).toFixed(2)}`}</span>
      <span data-testid="wb-metrics-duration">{`${((usage.latencyMs || 0) / 1000).toFixed(1)}s`}</span>
      <span data-testid="wb-metrics-rounds">{`${rounds} 轮`}</span>
    </div>
  );
}
