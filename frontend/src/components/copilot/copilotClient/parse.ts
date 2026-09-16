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
    changeSetId: String(obj.changeSetId || ''),
    stage: String(obj.stage || ''),
    status: String(obj.status || ''),
    publicPhase: obj.publicPhase ? String(obj.publicPhase) : undefined,
    publicPhaseLabel: obj.publicPhaseLabel ? String(obj.publicPhaseLabel) : undefined,
    reason: obj.reason ? String(obj.reason) : undefined,
    toolJobId: obj.toolJobId ? String(obj.toolJobId) : undefined,
    revisionId: obj.revisionId ? String(obj.revisionId) : undefined,
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
    name: String(obj.name || ''),
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
    name: String(obj.name || ''),
    traceId: typeof obj.traceId === 'string' ? obj.traceId : undefined,
    callId: typeof obj.callId === 'string' ? obj.callId : undefined,
    iteration: typeof obj.iteration === 'number' ? obj.iteration : undefined,
    text: typeof obj.text === 'string' ? obj.text : '',
    truncated: obj.truncated === true,
  };
}

export function parseToolResultEvent(obj: Record<string, unknown>): ToolResultEvent {
  return {
    name: String(obj.name || ''),
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
    scTab: obj.scTab as ToolResultEvent['scTab'],
    scCluster: obj.scCluster as string | undefined,
    scGene: obj.scGene as string | undefined,
    scColumnFilters: obj.scColumnFilters as Record<string, string> | undefined,
    scSubsetName: obj.scSubsetName as string | null | undefined,
    scLabelKey: obj.scLabelKey as string | undefined,
    scLabelValue: obj.scLabelValue as string | undefined,
    scDatasetIds: obj.scDatasetIds as string[] | undefined,
    scMergeName: obj.scMergeName as string | null | undefined,
    scOpenReplotForAnalysis: obj.scOpenReplotForAnalysis as string | undefined,
    scUploadHint: obj.scUploadHint as boolean | undefined,
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
