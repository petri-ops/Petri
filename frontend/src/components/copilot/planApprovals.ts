// BLOCK-55 — 计划模式批准链路的 REST 封装（ai-plans 路由）。
// 复用 llmTranscripts.ts 的 requestJson 形状：getApiPrefix + getAuthHeader。
import { getApiPrefix, getAuthHeader } from './copilotClient';
import type { PlanApprovalAction, PlanApprovalCardPlan } from './SimpleChat/PlanApprovalCard';

export interface PlanListEntry extends PlanApprovalCardPlan {
  status: string;
  conversation_id?: string | null;
  pending_revision_no?: number | null;
  total_steps?: number;
  done_steps?: number;
  updated_at?: string;
  created_at?: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: { ...getAuthHeader(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  let body: (T & { status?: string; error?: string }) | null = null;
  try {
    body = (await resp.json()) as T & { status?: string; error?: string };
  } catch {
    // 非 JSON 响应按 HTTP 状态处理
  }
  if (!resp.ok || !body) {
    throw new Error(body?.error || `HTTP ${resp.status}`);
  }
  return body;
}

/** 后端行（snake_case）→ 批准卡形状（PlanApprovalCardPlan，camelCase）。 */
type PlanRowPayload = PlanListEntry & { spec_md?: string | null; steps?: PlanApprovalCardPlan['steps'] };
function mapPlanRow(row: PlanRowPayload): PlanListEntry {
  return {
    ...row,
    specMd: row.specMd ?? row.spec_md ?? null,
    steps: Array.isArray(row.steps) ? row.steps : [],
  };
}

/** BLOCK-216 Q5 — 计划面：当前会话全部计划（可选状态过滤）。 */
export async function fetchPlansForConversation(
  conversationId: string,
  status?: string
): Promise<PlanListEntry[]> {
  const params = new URLSearchParams({ conversationId });
  if (status) params.set('status', status);
  const body = await requestJson<{ plans: PlanListEntry[] }>(
    `${getApiPrefix()}/ai/plans?${params.toString()}`
  );
  return (Array.isArray(body.plans) ? body.plans : []).map(mapPlanRow);
}

/** 拉取当前会话的 draft 计划（批准卡数据源）。 */
export async function fetchDraftPlansForConversation(conversationId: string): Promise<PlanListEntry[]> {
  const params = new URLSearchParams({ conversationId, status: 'draft' });
  const body = await requestJson<{ plans: PlanListEntry[] }>(
    `${getApiPrefix()}/ai/plans?${params.toString()}`
  );
  return (Array.isArray(body.plans) ? body.plans : []).map(mapPlanRow);
}

/** 拉取当前会话有待批准修订案的 active 计划（P3 replan 批准条数据源）。 */
export async function fetchPlansWithPendingRevision(conversationId: string): Promise<PlanListEntry[]> {
  const params = new URLSearchParams({ conversationId, status: 'active' });
  const body = await requestJson<{ plans: PlanListEntry[] }>(
    `${getApiPrefix()}/ai/plans?${params.toString()}`
  );
  const plans = Array.isArray(body.plans) ? body.plans : [];
  return plans.map(mapPlanRow).filter((p) => typeof p.pending_revision_no === 'number');
}

/** 批准三选一。 */
export async function approvePlan(
  planId: string,
  action: PlanApprovalAction
): Promise<{ ok: boolean }> {
  await requestJson<{ status: string }>(`${getApiPrefix()}/ai/plans/${encodeURIComponent(planId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
  return { ok: true };
}

export interface PlanRevisionEntry {
  id: string;
  revNo: number;
  reason: string | null;
  status: string;
  steps: NonNullable<PlanApprovalCardPlan['steps']>;
  createdAt: string | null;
  appliedAt: string | null;
}

/** BLOCK-253 B3/H4 — 计划修订版本列表（proposed_json → 步骤表，坏 JSON 如实留空）。 */
export async function fetchPlanRevisions(planId: string): Promise<PlanRevisionEntry[]> {
  const body = await requestJson<{ revisions: Array<Record<string, unknown>> }>(
    `${getApiPrefix()}/ai/plans/${encodeURIComponent(planId)}/revisions`
  );
  const rows = Array.isArray(body.revisions) ? body.revisions : [];
  return rows.map((row) => {
    let steps: PlanRevisionEntry['steps'] = [];
    const proposedJson = typeof row.proposed_json === 'string' ? row.proposed_json : '[]';
    try {
      const parsed: unknown = JSON.parse(proposedJson);
      if (Array.isArray(parsed)) steps = parsed as PlanRevisionEntry['steps'];
    } catch { /* 坏 JSON 不伪造步骤 */ }
    return {
      id: typeof row.id === 'string' ? row.id : '',
      revNo: typeof row.rev_no === 'number' ? row.rev_no : Number(row.rev_no) || 0,
      reason: typeof row.reason === 'string' ? row.reason : null,
      status: typeof row.status === 'string' ? row.status : 'proposed',
      steps,
      createdAt: typeof row.created_at === 'string' ? row.created_at : null,
      appliedAt: typeof row.applied_at === 'string' ? row.applied_at : null,
    };
  }).filter((entry) => entry.revNo > 0);
}

/** 批准修订案（P3：applied → 步骤表替换）。 */
export async function approvePlanRevision(planId: string, revNo: number): Promise<{ ok: boolean }> {
  await requestJson<{ status: string }>(
    `${getApiPrefix()}/ai/plans/${encodeURIComponent(planId)}/revisions/${revNo}/approve`,
    { method: 'POST' }
  );
  return { ok: true };
}

/** 「批准并清上下文执行」的首 turn 文案：仅凭 spec + 步骤表自包含。 */
export function buildFreshPlanTurn(plan: PlanApprovalCardPlan): string {
  const stepsText = (plan.steps || [])
    .map((s) => {
      const assignee = s.assignee === 'subagent' ? '（派子智能体执行）' : '';
      const hint = s.hint ? ` — ${s.hint}` : '';
      return `${s.n}. ${s.title}${assignee}${hint}`;
    })
    .join('\n');
  return [
    `计划「${plan.title}」已批准（planId: ${plan.id}）。以下是完整计划，请仅依据它执行，不要依赖之前的对话内容。`,
    plan.specMd ? `\n## 计划正文\n\n${plan.specMd}` : '',
    stepsText ? `\n## 步骤\n\n${stepsText}` : '',
    '\n请从第一个 pending 步骤开始执行；完成后用 plan(op="update_step") 写回状态。',
  ]
    .filter(Boolean)
    .join('\n');
}
