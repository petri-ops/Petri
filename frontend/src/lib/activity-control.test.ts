// BLOCK-261 K3 — 逐项停止映射：kind→既有端点、结果文案、失败原因如实回传。
import { describe, expect, it, vi } from 'vitest';
import {
  describeActivityAction,
  requestActivityStop,
  type ActivityControlItem,
} from './activity-control';

const PREFIX = 'http://127.0.0.1:3001/api';

/** 替身 fetch：签名少参数即可赋给 typeof fetch，省掉断言。 */
function respond(status: number, body: unknown): typeof fetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function respondEmpty(status: number): typeof fetch {
  return () => Promise.resolve(new Response('', { status }));
}

function failing(): typeof fetch {
  return () => Promise.reject(new TypeError('fetch failed'));
}

function item(overrides: Partial<ActivityControlItem> & Pick<ActivityControlItem, 'kind'>): ActivityControlItem {
  return { id: 'x1', ...overrides };
}

describe('describeActivityAction', () => {
  it('按 kind 给动作标签：作业=取消 / 任务与子代理=停止 / 审批=停止该任务', () => {
    expect(describeActivityAction(item({ kind: 'toolJob' })).label).toBe('取消');
    expect(describeActivityAction(item({ kind: 'task' })).label).toBe('停止');
    expect(describeActivityAction(item({ kind: 'subagentTask' })).label).toBe('停止');
    expect(describeActivityAction(item({ kind: 'approval', taskId: 't9' })).label).toBe('停止该任务');
  });

  it('审批没有所属任务时不给动作，只给原因（不复制审批卡的决策面）', () => {
    const action = describeActivityAction(item({ kind: 'approval' }));
    expect(action.label).toBe('');
    expect(action.unavailable).toContain('审批卡');
  });
});

describe('requestActivityStop', () => {
  it('作业走 /tools/cancel/<id> 并带本机凭据；status=cancelled 报「已取消」', async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true, status: 'cancelled' }), { status: 200 })));
    const outcome = await requestActivityStop(item({ kind: 'toolJob', id: 'job_1' }), {
      fetchImpl,
      apiPrefix: PREFIX,
      token: 'desktop-local',
    });
    expect(fetchImpl).toHaveBeenCalledWith(`${PREFIX}/tools/cancel/job_1`, expect.objectContaining({ method: 'POST' }));
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer desktop-local' });
    expect(outcome).toEqual({ ok: true, reason: 'cancelled', message: '已取消。' });
  });

  it('任务走 /ai/agent/task/<id>/cancel；cancel_requested 报「已请求停止」', async () => {
    const fetchImpl = vi.fn(respond(200, { status: 'cancel_requested', taskId: 't1' }));
    const outcome = await requestActivityStop(item({ kind: 'task', id: 't1' }), {
      fetchImpl,
      apiPrefix: PREFIX,
    });
    expect(fetchImpl).toHaveBeenCalledWith(`${PREFIX}/ai/agent/task/t1/cancel`, expect.anything());
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toBe('已请求停止。');
  });

  it('终态幂等：already_finished / alreadyTerminal 都报「本就已结束」而不是假成功', async () => {
    const job = await requestActivityStop(item({ kind: 'toolJob' }), {
      fetchImpl: respond(200, { ok: true, message: 'already_finished' }),
      apiPrefix: PREFIX,
    });
    expect(job.reason).toBe('already_finished');
    expect(job.message).toBe('本就已结束。');

    const task = await requestActivityStop(item({ kind: 'subagentTask' }), {
      fetchImpl: respond(200, { status: 'done', alreadyTerminal: true }),
      apiPrefix: PREFIX,
    });
    expect(task.reason).toBe('already_finished');
  });

  it('409 归属未证明如实回显原因（不谎称已停）', async () => {
    const outcome = await requestActivityStop(item({ kind: 'toolJob', id: 'job_9' }), {
      fetchImpl: respond(409, { ok: false, status: 'running', error: 'execution_owner_unavailable' }),
      apiPrefix: PREFIX,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('execution_owner_unavailable');
    expect(outcome.message).toContain('拒绝强制终止');
  });

  it('未知错误码带出原始码，不静默吞掉', async () => {
    const outcome = await requestActivityStop(item({ kind: 'task' }), {
      fetchImpl: respond(500, { error: 'db_locked' }),
      apiPrefix: PREFIX,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('db_locked');
    expect(outcome.message).toContain('db_locked');
  });

  it('审批按所属任务取消；无所属任务时不发请求', async () => {
    const fetchImpl = vi.fn(respond(200, { status: 'cancel_requested' }));
    const withTask = await requestActivityStop(item({ kind: 'approval', id: 'ap_1', taskId: 't7' }), {
      fetchImpl,
      apiPrefix: PREFIX,
    });
    expect(withTask.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(`${PREFIX}/ai/agent/task/t7/cancel`, expect.anything());

    const bare = vi.fn(respond(200, {}));
    const withoutTask = await requestActivityStop(item({ kind: 'approval', id: 'ap_2' }), {
      fetchImpl: bare,
      apiPrefix: PREFIX,
    });
    expect(withoutTask.reason).toBe('no_action');
    expect(bare).not.toHaveBeenCalled();
  });

  it('网络失败与空响应体都不炸弹窗', async () => {
    const offline = await requestActivityStop(item({ kind: 'toolJob' }), {
      fetchImpl: failing(),
      apiPrefix: PREFIX,
    });
    expect(offline).toMatchObject({ ok: false, reason: 'network_unavailable' });

    const emptyBody = await requestActivityStop(item({ kind: 'task', id: 't2' }), {
      fetchImpl: respondEmpty(200),
      apiPrefix: PREFIX,
    });
    expect(emptyBody.ok).toBe(true);
  });
});
