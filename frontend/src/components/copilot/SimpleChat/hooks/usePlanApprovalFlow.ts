// BLOCK-92 Wave A-3 — 计划批准状态簇（自主组件平移，零行为变化）：
// pendingPlan / pendingRevision / planCardBusy + 待批准 draft/修订拉取 effect
// + 批准三选一与修订批准回调（BLOCK-55 P1/P3）。调用点在 useChatStream 之后
// （依赖 send/streaming）与 useModelAccessMenus 之后（计划档回退）。
import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { CopilotContext } from '@/lib/copilotContext';
import {
  approvePlan,
  approvePlanRevision,
  buildFreshPlanTurn,
  fetchDraftPlansForConversation,
  fetchPlansWithPendingRevision,
} from '@/components/copilot/planApprovals';
import type { PlanApprovalAction, PlanApprovalCardPlan } from '../PlanApprovalCard';
import type { AccessMode } from './useModelAccessMenus';

interface UsePlanApprovalFlowOptions {
  conversationId: string | null;
  streaming: boolean;
  send: (
    text: string,
    contextOverride?: Partial<CopilotContext>,
    opts?: { freshTurn?: boolean }
  ) => Promise<boolean>;
  // UI-303 — 批准执行即退出计划档：恢复进入计划模式前的档位
  setAccessMode: Dispatch<SetStateAction<AccessMode>>;
  prePlanAccessModeRef: MutableRefObject<'full' | 'workspace-write' | 'read' | null>;
}

export function usePlanApprovalFlow(options: UsePlanApprovalFlowOptions): {
  pendingPlan: PlanApprovalCardPlan | null;
  setPendingPlan: Dispatch<SetStateAction<PlanApprovalCardPlan | null>>;
  pendingRevision: { planId: string; title: string; revNo: number } | null;
  planCardBusy: boolean;
  handlePlanApprove: (action: PlanApprovalAction) => Promise<void>;
  handleRevisionApprove: () => Promise<void>;
} {
  const { conversationId, streaming, send, setAccessMode, prePlanAccessModeRef } = options;
  const [pendingPlan, setPendingPlan] = useState<PlanApprovalCardPlan | null>(null);
  const [pendingRevision, setPendingRevision] = useState<{ planId: string; title: string; revNo: number } | null>(null);
  const [planCardBusy, setPlanCardBusy] = useState(false);

  // BLOCK-55 P1/P3 — run 结束 / 会话切换后拉取待批准 draft 计划与待批准修订案。
  // 拉取失败静默降级（批准卡缺席不影响普通对话）。
  useEffect(() => {
    if (!conversationId || streaming) return;
    let cancelled = false;
    void (async () => {
      try {
        const drafts = await fetchDraftPlansForConversation(conversationId);
        if (!cancelled) setPendingPlan(drafts[0] ? { ...drafts[0] } : null);
      } catch {
        if (!cancelled) setPendingPlan(null);
      }
      try {
        const revPlans = await fetchPlansWithPendingRevision(conversationId);
        if (!cancelled) {
          const first = revPlans[0];
          setPendingRevision(
            first && typeof first.pending_revision_no === 'number'
              ? { planId: first.id, title: first.title, revNo: first.pending_revision_no }
              : null
          );
        }
      } catch {
        if (!cancelled) setPendingRevision(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, streaming]);

  // BLOCK-55 P1 — 批准三选一：批准执行 / 批准并清上下文执行 / 继续讨论
  const handlePlanApprove = useCallback(async (action: PlanApprovalAction) => {
    if (!pendingPlan || planCardBusy) return;
    setPlanCardBusy(true);
    try {
      await approvePlan(pendingPlan.id, action);
      const plan = pendingPlan;
      setPendingPlan(null);
      if (action === 'keep-planning') return;
      // UI-303 — 批准执行即退出计划档：恢复进入计划模式前的档位（缺省完全访问）
      setAccessMode(prePlanAccessModeRef.current ?? 'full');
      prePlanAccessModeRef.current = null;
      if (action === 'execute') {
        await send(
          `计划「${plan.title}」已批准（planId: ${plan.id}），请从第一个 pending 步骤开始执行，每完成一步用 plan(op="update_step") 写回状态。`,
          { approvedPlanId: plan.id }
        );
      } else {
        await send(
          buildFreshPlanTurn(plan),
          { approvedPlanId: plan.id, approvedPlanFresh: true },
          { freshTurn: true }
        );
      }
    } catch {
      // 批准失败：保留批准卡供用户重试
    } finally {
      setPlanCardBusy(false);
    }
  }, [pendingPlan, planCardBusy, send, setAccessMode, prePlanAccessModeRef]);

  // BLOCK-55 P3 — 修订案批准：替换步骤表后通知继续
  const handleRevisionApprove = useCallback(async () => {
    if (!pendingRevision || planCardBusy) return;
    setPlanCardBusy(true);
    try {
      await approvePlanRevision(pendingRevision.planId, pendingRevision.revNo);
      const rev = pendingRevision;
      setPendingRevision(null);
      await send(
        `计划「${rev.title}」修订案 #${rev.revNo} 已批准，请按修订后的步骤表继续执行。`,
        { approvedPlanId: rev.planId }
      );
    } catch {
      // 失败保留修订条
    } finally {
      setPlanCardBusy(false);
    }
  }, [pendingRevision, planCardBusy, send]);

  return {
    pendingPlan,
    setPendingPlan,
    pendingRevision,
    planCardBusy,
    handlePlanApprove,
    handleRevisionApprove,
  };
}
