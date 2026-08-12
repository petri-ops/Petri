/**
 * G0-RS-P4R-1 — what may and may not replace the displayed result body.
 *
 * Extracted from ResultArtifactShell, which is defined inline inside
 * project-workspace.tsx and owns ~30 hooks, so the rule was unreachable by any
 * test. Three unconditional clears lived there:
 *
 *   :3339-3344  setResult(null) on the DONE path BEFORE the refetch is issued,
 *               so re-observing the SAME job blanks a body that is still valid.
 *   :3367-3378  the not-done branch clears everything, so a stale 'running'
 *               arriving from the job-list fallback replaces a rendered result
 *               with a spinner.
 *   :3602-3612  the interaction-manifest effect clears manifest, backing table
 *               and selection before its request, with an empty catch, so a
 *               refetch failure permanently drops the interactive viewer.
 *
 * The rule is deliberately narrow: a SECONDARY failure degrades the secondary
 * feature and never the body. Losing an observation is not the same as
 * observing a change.
 *
 * `nextResultBodyState` returns `shown` BY REFERENCE whenever the body must
 * survive. Callers compare identity to decide whether to re-render, and the
 * invariant suite asserts with strict deepEqual, which rejects any extra own
 * key — including an undefined one. Degradation flags belong in a sibling
 * reducer, not here.
 */

/** What is currently rendered in the result body. */
export type ResultBodyState =
  | { kind: 'empty' }
  | { kind: 'loading'; jobId: string }
  | { kind: 'artifact'; jobId: string; artifactName: string }
  | { kind: 'error'; jobId: string; reason: string };

/**
 * Where a job-status observation came from.
 *
 * 'workflow' is the live harness poll. 'job-list' is the 15s project fetch,
 * which is never updated in place for an already-present job
 * (project-workspace.tsx:1117) and therefore carries a status that may be
 * arbitrarily stale.
 */
export type StatusSource = 'workflow' | 'job-list';

export type ResultBodyEvent =
  /** The interaction manifest could not be fetched or refetched. */
  | { type: 'interaction_manifest_failed' }
  /**
   * The harness workflow observation was lost — a poll error sets workflow to
   * null (useHarnessWorkflowStatus.ts:52-60). This is an absence of
   * information, not information about an absence.
   */
  | { type: 'workflow_status_lost' }
  /** A job status was observed, with its provenance. */
  | { type: 'job_status_observed'; jobId: string; status: string; source: StatusSource }
  /** A result fetch is about to be issued for this job. */
  | { type: 'result_fetch_started'; jobId: string }
  /** A result fetch completed and named the artifact to show. */
  | { type: 'result_fetch_succeeded'; jobId: string; artifactName: string }
  /** A result fetch failed. */
  | { type: 'result_fetch_failed'; jobId: string; reason: string };

/** A result response may commit only while it still belongs to the mounted Job. */
export function canCommitResultFetch(
  requestedJobId: string,
  activeJobId: string | null,
  cancelled: boolean,
): boolean {
  return !cancelled && requestedJobId === activeJobId;
}

/**
 * A Revision activated by adopt/restore may switch ResultView to the
 * candidate's Job in the same render. Keep that exact Revision identity while
 * the Job catches up; ordinary navigation to an unrelated Job still clears it.
 */
export function revisionAfterJobSelection<T extends { toolJobId?: string | null }>(
  revision: T | null,
  nextJobId: string | null,
): T | null {
  if (!revision) return null;
  return revision.toolJobId && revision.toolJobId === nextJobId ? revision : null;
}

function bodyJobId(shown: ResultBodyState): string | null {
  return shown.kind === 'empty' ? null : shown.jobId;
}

function showsContent(shown: ResultBodyState): boolean {
  return shown.kind === 'artifact';
}

/**
 * Decide the next body state.
 *
 * Pure and total: every event returns a state, and the identity of `shown` is
 * preserved whenever the body must not change.
 */
export function nextResultBodyState(
  shown: ResultBodyState,
  event: ResultBodyEvent,
): ResultBodyState {
  switch (event.type) {
    // A secondary feature failed. The body is unrelated to it.
    case 'interaction_manifest_failed':
      return shown;

    // Losing the observation tells us nothing about the job, so it cannot
    // justify replacing a body that is still correct.
    case 'workflow_status_lost':
      return shown;

    case 'job_status_observed': {
      // An observation about a different job never touches this body.
      if (bodyJobId(shown) !== null && event.jobId !== bodyJobId(shown)) return shown;
      // A job-list status may be arbitrarily stale, so it may never regress a
      // rendered artifact back to a spinner. A workflow observation may.
      if (showsContent(shown) && event.source === 'job-list') return shown;
      if (showsContent(shown) && event.status === 'done') return shown;
      if (event.status === 'done') return shown;
      if (showsContent(shown)) return { kind: 'loading', jobId: event.jobId };
      return shown.kind === 'empty' ? { kind: 'loading', jobId: event.jobId } : shown;
    }

    case 'result_fetch_started':
      // Re-fetching the SAME job keeps what is on screen: the old body stays
      // valid until the new one arrives. Clearing here was the largest blank in
      // the original component.
      if (bodyJobId(shown) === event.jobId) return shown;
      return { kind: 'loading', jobId: event.jobId };

    case 'result_fetch_succeeded':
      // A late reply for a job the user has navigated away from must be ignored.
      if (bodyJobId(shown) !== null && bodyJobId(shown) !== event.jobId) return shown;
      return { kind: 'artifact', jobId: event.jobId, artifactName: event.artifactName };

    case 'result_fetch_failed':
      if (bodyJobId(shown) !== null && bodyJobId(shown) !== event.jobId) return shown;
      // A failure replaces a spinner with an explanation, but never a body the
      // user can still read.
      if (showsContent(shown)) return shown;
      return { kind: 'error', jobId: event.jobId, reason: event.reason };

    default:
      return shown;
  }
}
