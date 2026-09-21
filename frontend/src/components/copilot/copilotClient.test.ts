import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ackRunTool,
  fetchInFlightPrimaryTasks,
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

  // BLOCK-109-CORE-ARCH P1.2 — localStorage 扫描器（findResumableAgentTask/
  // findResumableSubAgentTasks）已随双轨退役；恢复改问后端 inflight 端点。
  it('fetchInFlightPrimaryTasks 查询后端在途清单并透传 taskId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, tasks: [{ taskId: 't-1' }, { taskId: 't-2' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const ids = await fetchInFlightPrimaryTasks('c1');
    expect(ids).toEqual(['t-1', 't-2']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ai/agent/tasks/inflight?conversationId=c1');
  });

  it('fetchInFlightPrimaryTasks 非 2xx 抛错（由恢复入口静默降级）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchInFlightPrimaryTasks('c1')).rejects.toThrow('HTTP 500');
  });
});
