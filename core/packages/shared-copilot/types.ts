/**
 * copilotTypes.ts — Shared types and constants for Copilot components.
 */

/** act 工具执行的副作用记录（ActResultCard 渲染数据源）。从 ActResultCard 提到共享层。 */
export interface ActExecution {
  actType: string;
  message?: string;
  undoToken?: string;
  undoableUntil?: number;
  error?: string;
  analysisId?: string;
}

export interface UIMessage {
  role: 'user' | 'assistant';
  content: string;
  /** MULTIMODAL_v1 — attached image URLs (OSS) shown in the bubble + sent to a
   *  multimodal model when one is configured. */
  images?: string[];
  /** While true, message is still streaming. */
  pending?: boolean;
  /** Error text if the request failed. */
  error?: string;
  /** Agent steps captured during this turn (tool calls + results) */
  steps?: AgentStep[];
  /** Write operations executed during this turn */
  acts?: ActExecution[];
  /** True once auto-exec actions have been fired (prevents re-firing on reload). */
  autoActionsFired?: boolean;
  /** Metadata captured at the moment this message was produced. */
  meta?: {
    page?: string;
    pageTitle?: string;
    datasetId?: string;
    datasetName?: string;
    analysisId?: string;
    analysisName?: string;
    plotName?: string;
    /** ISO timestamp */
    ts?: string;
  };
}

export interface AgentStep {
  kind: 'tool_call' | 'tool_result';
  name: string;
  /** For tool_call: stringified args; for tool_result: summary text */
  detail: string;
  ts: number;
}

export const THREAD_KEY = 'biof3_copilot_thread';
export const LEGACY_PREFIX = 'biof3_copilot_history_';
export const OPEN_KEY = 'biof3_copilot_open';
export const MAX_HISTORY_MESSAGES = 40;
