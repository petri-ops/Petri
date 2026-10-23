// BLOCK-246 B2 — keep-planning 带意见时把意见发回同一计划；空意见保持原行为。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const approvePlan = vi.fn();
const fetchDraftPlansForConversation = vi.fn();
const fetchPlansWithPendingRevision = vi.fn();

vi.mock('@/components/copilot/planApprovals', () => ({
  approvePlan: (...args: unknown[]) => approvePlan(...args),
  approvePlanRevision: vi.fn(),
  buildFreshPlanTurn: () => 'fresh-plan-turn',
  fetchDraftPlansForConversation: (...args: unknown[]) => fetchDraftPlansForConversation(...args),
  fetchPlansWithPendingRevision: (...args: unknown[]) => fetchPlansWithPendingRevision(...args),
}));

import { usePlanApprovalFlow } from './usePlanApprovalFlow';

afterEach(() => {
  cleanup();
  approvePlan.mockReset();
  fetchDraftPlansForConversation.mockReset();
  fetchPlansWithPendingRevision.mockReset();
});

const plan = { id: 'plan_1', title: '单细胞预处理', steps: [{ n: 1, title: '读数据' }] };

async function setup(pendingPlan: typeof plan | null = plan) {
  fetchDraftPlansForConversation.mockResolvedValue(pendingPlan ? [pendingPlan] : []);
  fetchPlansWithPendingRevision.mockResolvedValue([]);
  approvePlan.mockResolvedValue(undefined);
  const send = vi.fn().mockResolvedValue(true);
  const hook = renderHook(() => usePlanApprovalFlow({
    conversationId: 'conv_1',
    streaming: false,
    send,
    setAccessMode: vi.fn(),
    prePlanAccessModeRef: { current: null },
  }));
  // 等 draft 拉取落地
  await act(async () => { await Promise.resolve(); });
  return { send, hook };
}

describe('usePlanApprovalFlow — keep-planning with feedback', () => {
  it('sends the user feedback back into the same plan without approving it', async () => {
    const { send, hook } = await setup();
    await act(async () => {
      await hook.result.current.handlePlanApprove('keep-planning', { feedback: '  第二步拆成两步  ' });
    });
    expect(approvePlan).toHaveBeenCalledWith('plan_1', 'keep-planning');
    expect(send).toHaveBeenCalledTimes(1);
    const [text] = send.mock.calls[0] as [string];
    expect(text).toContain('计划「单细胞预处理」需要调整：第二步拆成两步');
    expect(text).toContain('planId: plan_1');
    expect(text).toContain('暂不执行');
    // 关键：没有走批准执行分支（不改变档位、不携带 approvedPlanId）
    expect(send.mock.calls[0][1]).toBeUndefined();
  });

  it('keeps the old behavior (no message) when feedback is blank', async () => {
    const { send, hook } = await setup();
    await act(async () => {
      await hook.result.current.handlePlanApprove('keep-planning', { feedback: '   ' });
    });
    expect(approvePlan).toHaveBeenCalledWith('plan_1', 'keep-planning');
    expect(send).not.toHaveBeenCalled();
  });

  it('still approves-and-executes unchanged for the execute action', async () => {
    const { send, hook } = await setup();
    await act(async () => {
      await hook.result.current.handlePlanApprove('execute');
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as [string])[0]).toContain('已批准');
    expect((send.mock.calls[0] as [unknown, { approvedPlanId?: string }])[1]).toEqual({ approvedPlanId: 'plan_1' });
  });
});
