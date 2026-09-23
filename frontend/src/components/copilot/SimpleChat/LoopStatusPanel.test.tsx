// LoopStatusPanel 契约 — UI-437 v5.17
// completed 态不渲染（与时间线运行摘要行/回答正文三重冗余，用户裁决取消）；
// 运行/阻断态保留（实时反馈与失败可见性是本面板的真实价值）。
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LoopStatusPanel } from './LoopStatusPanel';
import type { ConversationLoopState } from '../conversationRunStore/types';

function mkLoop(overrides: Partial<ConversationLoopState>): ConversationLoopState {
  return {
    loopRunId: 'loop-1',
    phase: 'completed',
    recoveryRequired: false,
    iterations: [],
    ...overrides,
  };
}

describe('LoopStatusPanel（UI-437 v5.17）', () => {
  it('completed 态不渲染：无「已完成」条', () => {
    const { container } = render(
      <LoopStatusPanel
        loop={mkLoop({
          lastDecision: 'complete',
          latestConclusion: '已根据真实工具与产物状态完成本轮交付。',
        })}
        pending={false}
      />
    );
    expect(container.querySelector('.sc-loop-panel')).toBeNull();
    expect(screen.queryByText('已完成')).toBeNull();
  });

  it('running 态保留：执行中 + 轮数实时可见', () => {
    render(
      <LoopStatusPanel
        loop={mkLoop({
          phase: 'started',
          lastDecision: 'continue',
          latestConclusion: '工具执行中（1 个运行中）。继续监控。',
        })}
        pending={false}
      />
    );
    expect(screen.getByText('执行中')).toBeTruthy();
    expect(screen.getByLabelText('任务循环状态')).toBeTruthy();
  });

  it('blocked 态保留：失败可见（已阻断 + 结论）', () => {
    render(
      <LoopStatusPanel
        loop={mkLoop({
          phase: 'blocked',
          lastDecision: 'block',
          latestConclusion: '检测到假成功：任务失败但产生了文件（1 个）。',
          iterations: [{
            iterationId: 'it-1', sequence: 1, decision: 'block', status: 'blocked',
            publicConclusion: '检测到假成功：任务失败但产生了文件（1 个）。',
          }],
        } as Partial<ConversationLoopState>)}
        pending={false}
      />
    );
    expect(screen.getByText('已阻断')).toBeTruthy();
  });
});
