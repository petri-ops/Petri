// BLOCK-25 — Codex-parity AI code review types (renderer side).
// Mirrors the sanitized backend event shape from
// core/r-server/agent-review/review-output.js (camelCase).

export type ReviewTargetType = 'uncommitted_changes' | 'base_branch' | 'commit' | 'custom';

export type ReviewTarget =
  | { type: 'uncommitted_changes' }
  | { type: 'base_branch'; branch: string }
  | { type: 'commit'; sha: string; title?: string | null }
  | { type: 'custom'; instructions: string };

export interface ReviewCodeLocation {
  absoluteFilePath: string;
  lineRange: { start: number; end: number };
}

export interface ReviewFinding {
  title: string;
  body: string;
  confidenceScore: number | null;
  priority: number | null;
  codeLocation: ReviewCodeLocation;
}

export interface ReviewOutputEvent {
  findings: ReviewFinding[];
  droppedFindings: number;
  overallCorrectness: 'patch is correct' | 'patch is incorrect' | 'unknown';
  overallExplanation: string;
  overallConfidenceScore: number | null;
}

export interface ReviewLaunchResult {
  taskId: string;
  status: string;
  kind: 'review';
  target: ReviewTarget;
  userFacingHint: string;
}

export function reviewPriorityLabel(priority: number | null): string {
  if (priority === null || priority < 0 || priority > 3) return 'P?';
  return `P${priority}`;
}
