/**
 * G0-RS-P4R-2 — what may occupy the space above the result body.
 *
 * The stage's charter is 主体首屏化. The decisions that determine whether the
 * body is actually first-screen live inside ResultArtifactShell, which is
 * defined inline in project-workspace.tsx and exported nowhere, so none of them
 * could be tested. They live here instead, as predicates.
 *
 * The rule they share: a block above the body must earn its place by being
 * actionable or by carrying information the user needs before the result.
 * A block that only explains why a feature is unavailable does neither — it
 * makes the user scroll past a disabled control to reach what they opened.
 */

/**
 * Should the final-report delivery card render?
 *
 * It sat unconditionally between the scientific-delivery section and the body
 * (project-workspace.tsx:4201). With no report artifact its 生成 button is
 * disabled, 查看 and 导出 do not render at all, and the copy reads
 * 「分析结果确认后按需生成」 — a card whose entire content is that the feature
 * cannot be used yet. Hiding it then costs nothing actionable.
 */
export function shouldShowDeliveryCard(input: {
  reportArtifact?: unknown;
  finalReportUrl?: string | null;
}): boolean {
  return Boolean(input.reportArtifact) || Boolean(input.finalReportUrl);
}

/**
 * Should the workflow bar precede the result?
 *
 * It earns the space when it says something the header cannot: a stage is
 * still running, or a recovery action is waiting. When the workflow is
 * finished and no action is pending it renders 「结果已校验 · N 项产物」 —
 * which restates the trust the header already shows via describeTruthStatus,
 * in different words, directly above the result the user opened. That is the
 * same duplication removed from the bar's raw 「truth valid」 line, in a
 * friendlier costume.
 */
export function shouldShowWorkflowBar(input: {
  hasWorkflow?: boolean;
  resumeFrom?: string | null;
  hasRecoveryAction?: boolean;
}): boolean {
  if (!input.hasWorkflow) return false;
  return Boolean(input.resumeFrom) || Boolean(input.hasRecoveryAction);
}
