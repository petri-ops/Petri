import { useMemo, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { CopilotMarkdown } from '../copilotMarkdown';

// BLOCK-55 P1/P2 — 计划模式批准卡：draft 计划的 spec 正文 + 步骤表 +
// 批准三选一（批准并执行 / 批准并清上下文执行 / 继续留在计划模式）。
// 对齐 codex plan_implementation 的「计划完成三选一」，轻门不重流程。

export interface PlanApprovalCardPlan {
  id: string;
  title: string;
  goal?: string | null;
  specMd?: string | null;
  steps?: { n: number; title: string; hint?: string | null; assignee?: string | null }[];
}

export type PlanApprovalAction = 'execute' | 'execute-fresh' | 'keep-planning';

interface PlanApprovalCardProps {
  plan: PlanApprovalCardPlan;
  busy?: boolean;
  /** BLOCK-246 B2 — 「继续讨论」可携带计划调整意见（feedback 非空时主机发给 Agent）。 */
  onApprove: (action: PlanApprovalAction, options?: { feedback?: string }) => void;
  onDismiss: () => void;
  /** BLOCK-216 Q5 — 在右栏计划面中查看（保留批准动作不变）。 */
  onOpenInTab?: (planId: string) => void;
}

export function PlanApprovalCard({ plan, busy = false, onApprove, onDismiss, onOpenInTab }: PlanApprovalCardProps) {
  const [specExpanded, setSpecExpanded] = useState(true);
  // BLOCK-246 B2 — 计划调整意见（空串 = 只是收起卡片，保持计划不变）
  const [feedback, setFeedback] = useState('');
  const steps = plan.steps || [];
  const subagentCount = useMemo(
    () => steps.filter((s) => s.assignee === 'subagent').length,
    [steps]
  );

  return (
    <div className="sc-plan-approval" role="dialog" aria-label="计划批准">
      <div className="sc-plan-approval-head">
        <Icon name="list-details" size={16} />
        <span className="sc-plan-approval-title">计划待批准</span>
        <span className="sc-plan-approval-plan-title">{plan.title}</span>
        <button
          type="button"
          className="sc-plan-approval-close"
          aria-label="收起批准卡（继续留在计划模式）"
          onClick={onDismiss}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      {plan.goal ? <div className="sc-plan-approval-goal">{plan.goal}</div> : null}
      {steps.length > 0 && (
        <ol className="sc-plan-approval-steps">
          {steps.map((s) => (
            <li key={s.n} className="sc-plan-approval-step">
              <span className="sc-plan-approval-step-title">{s.title}</span>
              {s.assignee === 'subagent' && (
                <span className="sc-plan-approval-assignee" title="该步骤将派子智能体独立执行">
                  子智能体
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {plan.specMd ? (
        <div className="sc-plan-approval-spec">
          <button
            type="button"
            className="sc-plan-approval-spec-toggle"
            onClick={() => setSpecExpanded((v) => !v)}
          >
            <Icon name={specExpanded ? 'chevron-down' : 'chevron-right'} size={12} />
            计划正文（spec）
          </button>
          {specExpanded && (
            <div className="sc-plan-approval-spec-body">
              <CopilotMarkdown text={plan.specMd} />
            </div>
          )}
        </div>
      ) : null}
      <div className="sc-plan-approval-actions">
        {onOpenInTab ? (
          <button
            type="button"
            className="sc-plan-approval-btn"
            onClick={() => onOpenInTab(plan.id)}
            title="在右栏计划面中查看版本、步骤与正文"
          >
            在计划面查看
          </button>
        ) : null}
        <button
          type="button"
          className="sc-plan-approval-btn sc-plan-approval-btn-primary"
          disabled={busy}
          onClick={() => onApprove('execute')}
        >
          批准并执行
        </button>
        <button
          type="button"
          className="sc-plan-approval-btn"
          disabled={busy}
          title="批准后以全新上下文执行：仅携带计划正文与步骤表，讨论期长上下文不进入执行期"
          onClick={() => onApprove('execute-fresh')}
        >
          批准并清上下文执行
        </button>
        <button
          type="button"
          className="sc-plan-approval-btn"
          disabled={busy}
          title="保持在计划档：写一句调整意见，Agent 会按意见重排步骤表（留空则只收起这张卡）"
          data-testid="plan-keep-planning"
          onClick={() => onApprove('keep-planning', { feedback })}
        >
          继续讨论{subagentCount > 0 ? `（含 ${subagentCount} 个子智能体步骤）` : ''}
        </button>
      </div>
      {/* BLOCK-246 B2 — 计划反馈输入：Qoder 的「告诉它计划需要如何调整」，
          此前 keep-planning 直接 return，用户意见无处可去。 */}
      <div className="sc-plan-feedback">
        <textarea
          className="sc-plan-feedback-input"
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="告诉 Agent 计划需要如何调整（例如：第二步拆成两步、先跑质控再降维）"
          aria-label="计划调整意见"
          data-testid="plan-feedback-input"
          rows={2}
        />
        <span className="sc-plan-feedback-hint">
          写在这里再点上面的讨论按钮，Agent 会按意见重排步骤表；留空则只是收起这张卡。
        </span>
      </div>
    </div>
  );
}
