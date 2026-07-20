import { describe, expect, it } from 'vitest';
import {
  formatToolDuration,
  formatToolSideEffects,
  mergeToolCallActivity,
  mergeToolResultActivity,
} from './toolActivity';

const structuredResult = {
  name: 'run_tool',
  summary: '错误: read_only',
  toolResult: {
    contractVersion: '1.0.0',
    traceId: 'trace_1',
    callId: 'call_1',
    tool: 'run_tool',
    status: 'denied' as const,
    terminationReason: 'read_only',
    durationMs: 12.4,
    truncated: true,
    sideEffects: {
      type: 'none' as const,
      riskTier: 'R0' as const,
      resources: [],
    },
  },
};

describe('tool activity projection', () => {
  it('updates by callId and does not downgrade a terminal replay', () => {
    const call = { name: 'run_tool', args: {}, traceId: 'trace_1', callId: 'call_1' };
    const running = mergeToolCallActivity([], call);
    expect(running).toHaveLength(1);
    expect(running[0].status).toBe('running');

    const denied = mergeToolResultActivity(running, structuredResult);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      key: 'call_1',
      status: 'denied',
      terminationReason: 'read_only',
      durationMs: 12.4,
      truncated: true,
    });

    expect(mergeToolCallActivity(denied, call)).toBe(denied);
    expect(mergeToolResultActivity(denied, structuredResult)).toHaveLength(1);
  });

  it('correlates legacy results with the newest same-name running call', () => {
    let activities = mergeToolCallActivity([], { name: 'query', args: {} });
    activities = mergeToolResultActivity(activities, { name: 'query', summary: 'ok' });
    activities = mergeToolCallActivity(activities, { name: 'query', args: {} });

    expect(activities).toHaveLength(2);
    expect(activities.map((item) => item.status)).toEqual(['success', 'running']);

    activities = mergeToolResultActivity(activities, {
      name: 'query',
      summary: '错误: handler_error',
    });
    expect(activities.map((item) => item.status)).toEqual(['success', 'error']);
  });

  it('keeps an approval-only result waiting instead of marking it completed', () => {
    const running = mergeToolCallActivity([], {
      name: 'run_tool',
      args: {},
      traceId: 'trace_approval',
      callId: 'call_approval',
    });
    const waiting = mergeToolResultActivity(running, {
      name: 'run_tool',
      summary: 'ok',
      needApproval: true,
      toolResult: {
        contractVersion: '1.0.0',
        traceId: 'trace_approval',
        callId: 'call_approval',
        tool: 'run_tool',
        status: 'success',
        terminationReason: 'approval_required',
        durationMs: 3,
        truncated: false,
        sideEffects: {
          type: 'state-write',
          riskTier: 'R1',
          resources: ['tool_job'],
        },
      },
    });

    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      status: 'awaiting_confirmation',
      terminationReason: 'approval_required',
      sideEffects: { type: 'state-write', resources: ['tool_job'] },
    });
  });

  it('formats duration and side-effect summaries for the activity card', () => {
    expect(formatToolDuration(42.4)).toBe('42 ms');
    expect(formatToolDuration(1450)).toBe('1.4 s');
    expect(formatToolDuration(undefined)).toBeNull();
    expect(formatToolSideEffects({
      type: 'state-write',
      riskTier: 'R1',
      resources: ['tool_job'],
    })).toBe('state-write · R1 · tool_job');
    expect(formatToolSideEffects(structuredResult.toolResult.sideEffects)).toBeNull();
    expect(formatToolSideEffects({ type: 'none', riskTier: 'R0', resources: [] }))
      .toBeNull();
  });
});
