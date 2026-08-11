import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ackRunTool,
  findResumableAgentTask,
  findResumableSubAgentTasks,
  parseResultEditProgressEvent,
  parseToolCallEvent,
  parseToolResultEvent,
  restoreResultEditProgressEvents,
} from './copilotClient';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('copilot SSE tool event projection', () => {
  it('sends the active project and conversation as immutable approval expectations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(ackRunTool('ack_1', true, {
      projectId: 'project-1',
      conversationId: 'conversation-1',
    })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      approve: true,
      projectId: 'project-1',
      conversationId: 'conversation-1',
    });
  });

  it('preserves structured call correlation fields', () => {
    expect(parseToolCallEvent({
      event: 'tool_call',
      name: 'query',
      args: { scope: 'projects' },
      traceId: 'trace_1',
      callId: 'call_1',
    })).toEqual({
      name: 'query',
      args: { scope: 'projects' },
      traceId: 'trace_1',
      callId: 'call_1',
    });
  });

  it('preserves the structured result and legacy approval projection', () => {
    const toolResult = {
      contractVersion: '1.0.0',
      traceId: 'trace_1',
      callId: 'call_1',
      tool: 'run_tool',
      status: 'denied' as const,
      terminationReason: 'approval_required',
      durationMs: 8.5,
      truncated: false,
      sideEffects: {
        type: 'execution' as const,
        riskTier: 'R3' as const,
        resources: ['tool_job'],
      },
    };
    expect(parseToolResultEvent({
      event: 'tool_result',
      name: 'run_tool',
      summary: 'ok',
      toolResult,
      needApproval: true,
      ackToken: 'ack_1',
      toolJobId: 'job_1',
      toolId: 'deseq2',
      params: { alpha: 0.05 },
    })).toMatchObject({
      name: 'run_tool',
      summary: 'ok',
      toolResult,
      needApproval: true,
      ackToken: 'ack_1',
      toolJobId: 'job_1',
      toolId: 'deseq2',
      params: { alpha: 0.05 },
    });
  });

  it('keeps legacy events valid when toolResult is absent', () => {
    expect(parseToolResultEvent({
      event: 'tool_result',
      name: 'act',
      summary: 'ok',
      actType: 'switch_result_tab',
    })).toMatchObject({
      name: 'act',
      summary: 'ok',
      actType: 'switch_result_tab',
      toolResult: undefined,
    });
  });

  it('projects RS5 result edit progress without exposing unbounded payloads', () => {
    expect(parseResultEditProgressEvent({
      event: 'result_edit_progress', sequence: 3, changeSetId: 'cs_1',
      stage: 'job', status: 'completed', toolJobId: 'tj_1',
    })).toEqual({
      resultEditProgressVersion: 1,
      sequence: 3,
      changeSetId: 'cs_1',
      stage: 'job',
      status: 'completed',
      reason: undefined,
      toolJobId: 'tj_1',
      revisionId: undefined,
    });
  });

  it('restores persisted P4R-3 public edit stages in sequence order', () => {
    expect(restoreResultEditProgressEvents([
      {
        resultEditProgressVersion: 1, sequence: 2, changeSetId: 'cs_1',
        stage: 'job', status: 'completed', publicPhase: 'execute_or_recompute',
        publicPhaseLabel: '执行/重算',
      },
      {
        resultEditProgressVersion: 1, sequence: 1, changeSetId: '',
        stage: 'plan', status: 'running', publicPhase: 'assess_impact', publicPhaseLabel: '判断影响',
      },
    ]).map((item) => [item.sequence, item.publicPhaseLabel])).toEqual([
      [1, '判断影响'],
      [2, '执行/重算'],
    ]);
  });
});

describe('agent task localStorage 恢复 (AGENT-CONCURRENCY)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('findResumableAgentTask 只返回 primary（忽略 sub-agent，老 key 视为 primary）', () => {
    const now = Date.now();
    localStorage.setItem('biof3_agent_task_legacy', JSON.stringify({ taskId: 'legacy', ts: now - 3000 }));
    localStorage.setItem(
      'biof3_agent_task_sub',
      JSON.stringify({ taskId: 'sub1', ts: now - 2000, kind: 'subagent', parentTaskId: 'p1' })
    );
    localStorage.setItem('biof3_agent_task_primary', JSON.stringify({ taskId: 'p1', ts: now - 1000, kind: 'primary' }));
    expect(findResumableAgentTask()).toBe('p1');
  });

  it('findResumableAgentTask 按会话与项目隔离恢复归属', () => {
    const now = Date.now();
    localStorage.setItem(
      'biof3_agent_task_other',
      JSON.stringify({
        taskId: 'other',
        ts: now + 2,
        kind: 'primary',
        conversationId: 'c-other',
        projectId: 'p-other',
      })
    );
    localStorage.setItem(
      'biof3_agent_task_target',
      JSON.stringify({
        taskId: 'target',
        ts: now + 1,
        kind: 'primary',
        conversationId: 'c-target',
        projectId: 'p-target',
      })
    );
    localStorage.setItem(
      'biof3_agent_task_legacy',
      JSON.stringify({ taskId: 'legacy', ts: now + 3 })
    );

    expect(findResumableAgentTask('c-target', 'p-target')).toBe('target');
    expect(findResumableAgentTask('c-missing', 'p-missing')).toBeNull();
  });

  it('findResumableSubAgentTasks 仅返回 sub-agent（含 parentTaskId）', () => {
    const now = Date.now();
    localStorage.setItem('biof3_agent_task_legacy', JSON.stringify({ taskId: 'legacy', ts: now - 3000 }));
    localStorage.setItem(
      'biof3_agent_task_sub',
      JSON.stringify({ taskId: 'sub1', ts: now - 2000, kind: 'subagent', parentTaskId: 'p1' })
    );
    localStorage.setItem('biof3_agent_task_primary', JSON.stringify({ taskId: 'p1', ts: now - 1000, kind: 'primary' }));
    const subs = findResumableSubAgentTasks();
    expect(subs).toHaveLength(1);
    expect(subs[0]).toEqual({ taskId: 'sub1', parentTaskId: 'p1', ts: now - 2000 });
  });

  it('超过 1 小时的 primary 返回 null 并删除 key', () => {
    localStorage.setItem(
      'biof3_agent_task_old',
      JSON.stringify({ taskId: 'old', ts: Date.now() - 2 * 60 * 60 * 1000, kind: 'primary' })
    );
    expect(findResumableAgentTask()).toBeNull();
    expect(localStorage.getItem('biof3_agent_task_old')).toBeNull();
  });

  it('超过 1 小时的 sub-agent 不返回且删除 key', () => {
    localStorage.setItem(
      'biof3_agent_task_oldsub',
      JSON.stringify({ taskId: 'oldsub', ts: Date.now() - 2 * 60 * 60 * 1000, kind: 'subagent', parentTaskId: 'p1' })
    );
    expect(findResumableSubAgentTasks()).toHaveLength(0);
    expect(localStorage.getItem('biof3_agent_task_oldsub')).toBeNull();
  });
});
