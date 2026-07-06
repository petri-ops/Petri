// ============================================================
// PlanInlineCard — render the active Copilot plan inside chat.
//
// Why: backend has full plan support (create / update_step / list) and the
// LLM creates plans via the `plan` tool, but until now they only showed up
// in MemoryPanel. Production data: 7 plans created, 0/33 steps completed —
// users never saw their progress, never marked steps done, plan was a dead
// letter.
//
// This card:
//   - Auto-detects the active plan for the current conversation
//   - Renders steps with status icons (○ ▶ ✓ ⊘ ✗) and result text
//   - Provides "完成此步" / "跳过" buttons next to the next pending step
//   - On click, PATCHes step status and optimistically updates UI
//   - On all-done, marks plan completed and shows congratulations
//
// Mounted by CopilotChat above the message stream.
// ============================================================

import React, { useEffect, useState, useCallback } from 'react';
import type { PlanDetail, PlanStep } from './copilotPlansClient';
import { getPlan, updateStepStatus } from './copilotPlansClient';

interface PlanInlineCardProps {
  /** Plan id to render. When undefined, card is hidden. */
  planId: string | null;
  /** Re-fetch trigger (bump on plan tool calls / SSE plan_updated events). */
  refreshKey?: number;
  /** Notify parent that a step changed (so it can re-prompt the LLM).
   * When allDone is true, the whole plan just finished — caller should ask LLM
   * to call verify_understanding to close the learning loop. */
  onStepChanged?: (planId: string, stepN: number, status: string, allDone?: boolean) => void;
}

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  running: '▶',
  done: '✓',
  failed: '✗',
  skipped: '⊘',
};

const STATUS_COLOR: Record<string, string> = {
  pending: '#94a3b8',
  running: '#0ea5e9',
  done: '#10b981',
  failed: '#ef4444',
  skipped: '#a3a3a3',
};

export default function PlanInlineCard({
  planId,
  refreshKey,
  onStepChanged,
}: PlanInlineCardProps): React.ReactElement | null {
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Fetch plan when id or refreshKey changes
  useEffect(() => {
    if (!planId) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    getPlan(planId).then((p) => {
      if (!cancelled) setPlan(p);
    });
    return () => {
      cancelled = true;
    };
  }, [planId, refreshKey]);

  const handleStepUpdate = useCallback(
    async (step: PlanStep, status: 'done' | 'skipped') => {
      if (!plan) return;
      setUpdating(step.n);
      // Optimistic update
      setPlan((prev) =>
        prev
          ? {
              ...prev,
              steps: prev.steps.map((s) => (s.n === step.n ? { ...s, status } : s)),
            }
          : null
      );
      const r = await updateStepStatus(plan.id, step.n, status);
      setUpdating(null);
      if (r.ok) {
        onStepChanged?.(plan.id, step.n, status, !!r.allDone);
        if (r.allDone) {
          setPlan((prev) => (prev ? { ...prev, status: 'completed' as const } : null));
        }
      } else {
        // Revert on failure
        setPlan((prev) =>
          prev
            ? {
                ...prev,
                steps: prev.steps.map((s) => (s.n === step.n ? { ...s, status: step.status } : s)),
              }
            : null
        );
      }
    },
    [plan, onStepChanged]
  );

  if (!planId || !plan) return null;

  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.status === 'done').length;
  const isCompleted = plan.status === 'completed';
  const nextPending = plan.steps.find((s) => s.status === 'pending' || s.status === 'running');

  return (
    <div className="cp-plan-card" data-status={plan.status}>
      <div className="cp-plan-card-header" onClick={() => setCollapsed((c) => !c)}>
        <span className="cp-plan-card-icon">{isCompleted ? '🎯' : '📋'}</span>
        <div className="cp-plan-card-title">
          <strong>{plan.title}</strong>
          {plan.goal && <span className="cp-plan-card-goal">{plan.goal}</span>}
        </div>
        <div className="cp-plan-card-progress">
          <span className="cp-plan-card-count">
            {done}/{total}
          </span>
          <div className="cp-plan-card-bar">
            <span style={{ width: total > 0 ? `${(done / total) * 100}%` : '0' }} />
          </div>
        </div>
        <button
          type="button"
          className="cp-plan-card-toggle"
          aria-label={collapsed ? '展开计划' : '折叠计划'}
        >
          {collapsed ? '▾' : '▴'}
        </button>
      </div>
      {!collapsed && (
        <ol className="cp-plan-card-steps">
          {plan.steps.map((step) => {
            const isNext = step === nextPending;
            const isDone = step.status === 'done';
            const isSkipped = step.status === 'skipped';
            const canAct = !isDone && !isSkipped && plan.status === 'active';
            return (
              <li
                key={step.n}
                className={`cp-plan-step cp-plan-step-${step.status}${isNext ? ' is-next' : ''}`}
              >
                <span
                  className="cp-plan-step-icon"
                  style={{ color: STATUS_COLOR[step.status] || '#94a3b8' }}
                  aria-label={step.status}
                >
                  {STATUS_ICON[step.status] || '○'}
                </span>
                <div className="cp-plan-step-body">
                  <span className="cp-plan-step-title">{step.title}</span>
                  {step.hint && <span className="cp-plan-step-hint">{step.hint}</span>}
                  {step.result && <span className="cp-plan-step-result">→ {step.result}</span>}
                </div>
                {canAct && (
                  <div className="cp-plan-step-actions">
                    <button
                      type="button"
                      className="cp-plan-step-btn cp-plan-step-btn-done"
                      disabled={updating === step.n}
                      onClick={() => handleStepUpdate(step, 'done')}
                    >
                      {updating === step.n ? '...' : '完成'}
                    </button>
                    <button
                      type="button"
                      className="cp-plan-step-btn cp-plan-step-btn-skip"
                      disabled={updating === step.n}
                      onClick={() => handleStepUpdate(step, 'skipped')}
                    >
                      跳过
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {isCompleted && !collapsed && <div className="cp-plan-card-done-banner">🎉 全部步骤完成</div>}
    </div>
  );
}
