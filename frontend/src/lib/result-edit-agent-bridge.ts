import type { CopilotContext } from '@/lib/copilotContext';
import type { CopilotAskDetail } from '@/lib/events';

export interface ResultEditBridgeSubmission {
  origin: 'manual' | 'agent';
  requestedOutcome: string;
  parameterPatch: Record<string, unknown>;
  scientificConfirmed: boolean;
  contextToken?: string | null;
}

export function isResultStudioContextToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/**
 * 把结果焦点内的一次提交做成原子事件快照。
 *
 * token 与 Artifact 快照只进入请求 context，不进入可见 user message。提交
 * token 若已落后于当前投影则拒绝派发，后端仍会再次以 SQLite/Artifact 真相
 * 校验；前端检查只是避免一个已知陈旧请求进入队列。
 */
export function buildResultEditCopilotAsk({
  submission,
  activeArtifact,
  currentContextToken,
}: {
  submission: ResultEditBridgeSubmission;
  activeArtifact: NonNullable<CopilotContext['activeArtifact']> | null;
  currentContextToken: string | null | undefined;
}): CopilotAskDetail | null {
  const submittedToken = submission.contextToken ?? currentContextToken;
  if (
    !activeArtifact
    || !isResultStudioContextToken(submittedToken)
    || !isResultStudioContextToken(currentContextToken)
    || submittedToken !== currentContextToken
  ) {
    return null;
  }
  return {
    // Keep the durable user message honest: it is exactly the outcome the
    // user supplied, not an implementation prompt containing tool names.
    prompt: submission.requestedOutcome.trim(),
    resultContext: {
      contextToken: submittedToken,
      activeArtifact,
      editRequest: {
        origin: submission.origin,
        parameterPatch: { ...submission.parameterPatch },
        scientificConfirmed: submission.scientificConfirmed,
      },
    },
  };
}

/** Snapshot override consumed synchronously by SimpleChat before any async conversation creation. */
export function copilotContextOverrideForAsk(
  detail: CopilotAskDetail,
): Partial<CopilotContext> | undefined {
  if (!detail.resultContext || !isResultStudioContextToken(detail.resultContext.contextToken)) return undefined;
  return {
    activeArtifact: {
      ...detail.resultContext.activeArtifact,
      contextToken: detail.resultContext.contextToken,
    },
    resultEditRequest: {
      ...detail.resultContext.editRequest,
      parameterPatch: { ...detail.resultContext.editRequest.parameterPatch },
    },
  };
}
