/**
 * activity-control.ts — 退出摘要逐项停止的唯一映射面（BLOCK-261 / Q9 K3）。
 *
 * 只做「把活动项映射到后端既有停止端点」这一件事：不新增端点、不新建执行器，
 * 也不复制审批决策面（拒绝/放行仍归审批卡）。409 一类「没能停成」的原因必须
 * 如实回传，弹窗里不许出现假定的「已停止」。
 */

import { getPlatformApiPrefix } from '@/lib/env';
import { getToken } from '@/lib/authClient';

type ActivityItemKind = 'toolJob' | 'task' | 'subagentTask' | 'approval';

export interface ActivityControlItem {
  kind: ActivityItemKind;
  id: string;
  taskId?: string | null;
}

interface ActivityActionDescriptor {
  /** 按钮文案；无可用动作时为空串。 */
  label: string;
  /** 无可用动作的原因（渲染禁用态，而不是渲染死按钮）。 */
  unavailable?: string;
}

export interface ActivityActionOutcome {
  ok: boolean;
  /** 面向人的结果文案。 */
  message: string;
  /** 机器可读原因（already_finished / 后端 error 码 / network）。 */
  reason?: string;
}

const STOP_LABEL = '停止';

/** 审批项只能在知道所属任务时停止；「拒绝」是审批卡的语义，不在这里复制第二套。 */
export function describeActivityAction(item: ActivityControlItem): ActivityActionDescriptor {
  if (item.kind === 'approval') {
    return item.taskId
      ? { label: '停止该任务' }
      : { label: '', unavailable: '该审批没有可定位的所属任务，请在审批卡里处理' };
  }
  return { label: item.kind === 'toolJob' ? '取消' : STOP_LABEL };
}

function buildRequest(item: ActivityControlItem, prefix: string): { url: string; body?: string } {
  const id = encodeURIComponent(item.id);
  if (item.kind === 'toolJob') return { url: `${prefix}/tools/cancel/${id}` };
  if (item.kind === 'approval') {
    const taskId = encodeURIComponent(String(item.taskId));
    return { url: `${prefix}/ai/agent/task/${taskId}/cancel` };
  }
  return { url: `${prefix}/ai/agent/task/${id}/cancel` };
}

const REASON_MESSAGES = new Map<string, string>([
  ['not_found', '对象已不存在，可能刚刚结束。'],
  ['forbidden', '无权停止该对象。'],
  ['unauthorized', '未登录，无法停止。'],
  ['execution_owner_unavailable', '后端未能证明该作业的进程归属，已拒绝强制终止。'],
  ['termination_unconfirmed', '终止未确认，作业可能仍在运行。'],
  ['job_no_longer_cancellable', '作业状态已变化，请重新查看。'],
]);

function outcomeOf(status: number, body: Record<string, unknown>): ActivityActionOutcome {
  const error = typeof body.error === 'string' ? body.error : '';
  if (status >= 400 || error) {
    return {
      ok: false,
      reason: error || `http_${status}`,
      message: REASON_MESSAGES.get(error) || `未能停止（${error || `HTTP ${status}`}）。`,
    };
  }
  if (body.alreadyTerminal === true || body.message === 'already_finished') {
    return { ok: true, reason: 'already_finished', message: '本就已结束。' };
  }
  const statusText = typeof body.status === 'string' ? body.status : '';
  if (statusText === 'cancelled') return { ok: true, reason: 'cancelled', message: '已取消。' };
  if (statusText === 'cancel_requested') return { ok: true, reason: 'cancel_requested', message: '已请求停止。' };
  return { ok: true, reason: statusText || 'ok', message: statusText ? `已受理（${statusText}）。` : '已受理。' };
}

export async function requestActivityStop(
  item: ActivityControlItem,
  options: { fetchImpl?: typeof fetch; apiPrefix?: string; token?: string } = {},
): Promise<ActivityActionOutcome> {
  const descriptor = describeActivityAction(item);
  if (!descriptor.label) {
    return { ok: false, reason: 'no_action', message: descriptor.unavailable || '没有可用动作。' };
  }
  const { url } = buildRequest(item, options.apiPrefix ?? getPlatformApiPrefix());
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.token ?? getToken()}`,
      },
    });
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await response.json();
      body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    return outcomeOf(response.status, body);
  } catch {
    return { ok: false, reason: 'network_unavailable', message: '未能连到本地后端。' };
  }
}
