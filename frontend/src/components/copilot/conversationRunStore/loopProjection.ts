import type { LoopIterationEvent, LoopPhaseEvent } from '@/lib/loop-client';
import type { ConversationLoopState } from './types';

/**
 * HLE-C4R: fold a loop_phase event into the durable-loop projection. Pure.
 * Never derives completion — it only records the phase the backend announced.
 */
export function mergeLoopPhase(
  current: ConversationLoopState | null | undefined,
  info: LoopPhaseEvent
): ConversationLoopState {
  const loopRunId = info.loopRunId || current?.loopRunId || '';
  return {
    loopRunId,
    phase: info.phase || current?.phase || 'running',
    automationMode: info.automationMode || current?.automationMode,
    executionIntent: info.executionIntent || current?.executionIntent,
    latestConclusion: info.publicConclusion || current?.latestConclusion,
    recoveryRequired: current?.recoveryRequired ?? false,
    iterations: current?.iterations || [],
    lastDecision: current?.lastDecision,
  };
}

/**
 * HLE-C4R: fold a loop_iteration event into the projection. Pure + idempotent:
 * iterations dedupe by iterationId and stay ordered by sequence ASC, so an SSE
 * event and a later API replay of the same iteration merge to one entry.
 */
export function mergeLoopIteration(
  current: ConversationLoopState | null | undefined,
  info: LoopIterationEvent
): ConversationLoopState {
  const loopRunId = info.loopRunId || current?.loopRunId || '';
  const prior = current?.iterations || [];
  const withoutDup = prior.filter((it) => it.iterationId !== info.iterationId);
  const iterations = [...withoutDup, info].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  return {
    loopRunId,
    phase: current?.phase || 'running',
    automationMode: current?.automationMode,
    executionIntent: current?.executionIntent,
    latestConclusion: info.publicConclusion || current?.latestConclusion,
    recoveryRequired: current?.recoveryRequired ?? false,
    iterations,
    lastDecision: info.decision || current?.lastDecision,
  };
}
