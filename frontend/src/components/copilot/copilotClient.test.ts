import { describe, expect, it } from 'vitest';
import { parseResultEditProgressEvent, parseToolCallEvent, parseToolResultEvent } from './copilotClient';

describe('copilot SSE tool event projection', () => {
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
});
