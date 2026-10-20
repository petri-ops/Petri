import type {
  ResultEditProgressEvent,
  ToolCallEvent,
  ToolOutputEvent,
  ToolResultEvent,
  StructuredToolResult,
} from './types';

export function parseResultEditProgressEvent(obj: Record<string, unknown>): ResultEditProgressEvent {
  return {
    resultEditProgressVersion: 1,
    sequence: typeof obj.sequence === 'number' ? obj.sequence : 0,
    changeSetId: typeof obj.changeSetId === 'string' ? obj.changeSetId : '',
    stage: typeof obj.stage === 'string' ? obj.stage : '',
    status: typeof obj.status === 'string' ? obj.status : '',
    publicPhase: typeof obj.publicPhase === 'string' && obj.publicPhase ? obj.publicPhase : undefined,
    publicPhaseLabel: typeof obj.publicPhaseLabel === 'string' && obj.publicPhaseLabel ? obj.publicPhaseLabel : undefined,
    reason: typeof obj.reason === 'string' && obj.reason ? obj.reason : undefined,
    toolJobId: typeof obj.toolJobId === 'string' && obj.toolJobId ? obj.toolJobId : undefined,
    revisionId: typeof obj.revisionId === 'string' && obj.revisionId ? obj.revisionId : undefined,
  };
}

export function restoreResultEditProgressEvents(value: unknown): ResultEditProgressEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-30)
    .flatMap((item) => item && typeof item === 'object'
      ? [parseResultEditProgressEvent(item as Record<string, unknown>)]
      : [])
    // intent/plan and an early terminal failure legitimately precede any
    // ChangeSet, so an empty changeSetId is not evidence of a malformed event.
    .filter((item) => item.stage && item.status)
    .sort((a, b) => a.sequence - b.sequence);
}

export function parseToolCallEvent(obj: Record<string, unknown>): ToolCallEvent {
  return {
    name: typeof obj.name === 'string' ? obj.name : '',
    args: obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)
      ? obj.args as Record<string, unknown>
      : {},
    traceId: typeof obj.traceId === 'string' ? obj.traceId : undefined,
    callId: typeof obj.callId === 'string' ? obj.callId : undefined,
    iteration: typeof obj.iteration === 'number' ? obj.iteration : undefined,
  };
}

export function parseToolOutputEvent(obj: Record<string, unknown>): ToolOutputEvent {
  return {
    name: typeof obj.name === 'string' ? obj.name : '',
    traceId: typeof obj.traceId === 'string' ? obj.traceId : undefined,
    callId: typeof obj.callId === 'string' ? obj.callId : undefined,
    iteration: typeof obj.iteration === 'number' ? obj.iteration : undefined,
    text: typeof obj.text === 'string' ? obj.text : '',
    truncated: obj.truncated === true,
  };
}

export function parseToolResultEvent(obj: Record<string, unknown>): ToolResultEvent {
  return {
    name: typeof obj.name === 'string' ? obj.name : '',
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    iteration: typeof obj.iteration === 'number' ? obj.iteration : undefined,
    toolResult: obj.toolResult && typeof obj.toolResult === 'object'
      ? {
        ...(obj.toolResult as StructuredToolResult),
        sourceTruncated: typeof (obj.toolResult as Record<string, unknown>).sourceTruncated === 'boolean'
          ? (obj.toolResult as Record<string, unknown>).sourceTruncated as boolean
          : undefined,
        previewTruncated: typeof (obj.toolResult as Record<string, unknown>).previewTruncated === 'boolean'
          ? (obj.toolResult as Record<string, unknown>).previewTruncated as boolean
          : undefined,
      }
      : undefined,
    actType: obj.actType as string | undefined,
    message: obj.message as string | undefined,
    undoToken: obj.undoToken as string | undefined,
    undoableUntil: obj.undoableUntil as number | undefined,
    actError: obj.actError as string | undefined,
    analysisId: obj.analysisId as string | undefined,
    taskId: obj.taskId as string | undefined,
    uiAction: obj.uiAction && typeof obj.uiAction === 'object'
      ? obj.uiAction as ToolResultEvent['uiAction']
      : undefined,
    ackExpiresAt: typeof obj.ackExpiresAt === 'number' ? obj.ackExpiresAt : undefined,
    toolId: obj.toolId as string | undefined,
    autofillFromJobId: obj.autofillFromJobId as string | undefined,
    autofillSourceTool: obj.autofillSourceTool as string | undefined,
    planId: obj.planId as string | undefined,
    allDone: obj.allDone as boolean | undefined,
    ackToken: obj.ackToken as string | undefined,
    needApproval: obj.needApproval as boolean | undefined,
    toolJobId: obj.toolJobId as string | undefined,
    params: obj.params as Record<string, unknown> | undefined,
  };
}
