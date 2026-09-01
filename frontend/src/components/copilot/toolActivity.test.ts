import { describe, expect, it } from 'vitest';
import {
  formatToolDuration,
  formatToolSideEffects,
  mergeToolCallActivity,
  mergeToolResultActivity,
  restoreToolActivities,
  summarizeToolCall,
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
    const call = { name: 'run_tool', args: {}, traceId: 'trace_1', callId: 'call_1', iteration: 2 };
    const running = mergeToolCallActivity([], call);
    expect(running).toHaveLength(1);
    expect(running[0].status).toBe('running');

    const denied = mergeToolResultActivity(running, { ...structuredResult, iteration: 2 });
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      key: 'call_1',
      status: 'denied',
      terminationReason: 'read_only',
      durationMs: 12.4,
      truncated: true,
      iteration: 2,
    });

    expect(mergeToolCallActivity(denied, call)).toBe(denied);
    expect(mergeToolResultActivity(denied, structuredResult)).toHaveLength(1);
  });

  it('keeps successful bounded results distinct from tool failures', () => {
    const running = mergeToolCallActivity([], {
      name: 'workspace_list',
      args: { path: 'data' },
      traceId: 'trace_summary',
      callId: 'call_summary',
    });
    const summarized = mergeToolResultActivity(running, {
      name: 'workspace_list',
      summary: 'ok',
      toolResult: {
        contractVersion: '1.0.0',
        traceId: 'trace_summary',
        callId: 'call_summary',
        tool: 'workspace_list',
        status: 'success',
        terminationReason: 'success',
        durationMs: 5,
        sourceTruncated: true,
        previewTruncated: true,
        truncated: true,
        sideEffects: { type: 'none', riskTier: 'R0', resources: [] },
      },
    });

    expect(summarized[0]).toMatchObject({
      status: 'success',
      sourceTruncated: true,
      previewTruncated: true,
      truncated: true,
    });
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
    expect(formatToolDuration(329_000)).toBe('5m 29s');
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

  it('restores bounded activity metadata from conversation history', () => {
    expect(restoreToolActivities([{
      key: 'call_history',
      name: 'workspace_read',
      status: 'success',
      durationMs: 18,
      actionLabel: '已读取',
      actionDetail: 'README.md',
    }])).toEqual([expect.objectContaining({
      key: 'call_history',
      name: 'workspace_read',
      status: 'success',
      durationMs: 18,
      actionDetail: 'README.md',
    })]);
    expect(restoreToolActivities([{ name: 'workspace_read', status: 'unknown' }])).toEqual([]);
  });

  it('BLOCK-34 P2: restores the backend tool-activity recorder snapshot shape without drops', () => {
    // 后端 createToolActivityRecorder.recordResult 的持久化形状（summary +
    // actionLabel/actionDetail + callId/iteration + 截断标记）。恢复链路必须
    // 不丢项，否则历史会话的工具 chip 将整体消失（BLOCK-34 根因的展示面）。
    const persisted = [{
      key: 'call_bg',
      callId: 'call_bg',
      traceId: 'trace_bg',
      iteration: 2,
      name: 'workspace_exec_background',
      status: 'success',
      durationMs: 120,
      truncated: true,
      summary: '启动 node server.js（后台）',
      actionLabel: '已运行',
      actionDetail: 'node server.js',
      sideEffects: { type: 'none', riskTier: 'R0', resources: [] },
    }];
    expect(restoreToolActivities(persisted)).toEqual([expect.objectContaining({
      key: 'call_bg',
      callId: 'call_bg',
      iteration: 2,
      name: 'workspace_exec_background',
      status: 'success',
      durationMs: 120,
      truncated: true,
      summary: '启动 node server.js（后台）',
      actionLabel: '已运行',
      actionDetail: 'node server.js',
      sideEffects: { type: 'none', riskTier: 'R0', resources: [] },
    })]);
  });

  it('projects safe Codex-style activity details without exposing write content', () => {
    expect(summarizeToolCall('workspace_exec', { command: 'pwd' }))
      .toEqual({ actionLabel: '已运行', actionDetail: 'pwd' });
    expect(summarizeToolCall('workspace_read', { path: 'scripts/dev-electron.js', startLine: 1 }))
      .toEqual({ actionLabel: '已读取', actionDetail: 'scripts/dev-electron.js · 第 1 行起' });
    expect(summarizeToolCall('workspace_write', {
      path: 'notes.txt',
      content: 'Authorization: secret-value',
    })).toEqual({ actionLabel: '已修改', actionDetail: 'notes.txt' });
  });
});
