/**
 * G0-RS-P4R-1 — the body-state rule, tested where it can actually be tested.
 *
 * Each case names the site in project-workspace.tsx it protects, so a future
 * refactor that reintroduces the clear has something to fail against. Nothing
 * else covers this path: CenterPanel.test.tsx mocks the whole module.
 */

import { describe, expect, it } from 'vitest';
import { nextResultBodyState } from './resultBodyState';
import type { ResultBodyState } from './resultBodyState';

const SHOWN: ResultBodyState = { kind: 'artifact', jobId: 'job_1', artifactName: 'volcano.png' };

describe('nextResultBodyState', () => {
  it('keeps the body when the interaction manifest fails (project-workspace.tsx:3602-3612)', () => {
    // The original cleared manifest, backing table and selection BEFORE the
    // request, with an empty catch at :3639-3641, so a refetch failure
    // permanently dropped the interactive viewer.
    const next = nextResultBodyState(SHOWN, { type: 'interaction_manifest_failed' });
    expect(next).toBe(SHOWN);
  });

  it('keeps the body when the workflow observation is lost', () => {
    // useHarnessWorkflowStatus.ts:52-60 sets workflow to null on a poll error.
    // That is an absence of information, not information about an absence.
    expect(nextResultBodyState(SHOWN, { type: 'workflow_status_lost' })).toBe(SHOWN);
  });

  it('never lets a stale job-list status regress a rendered body (project-workspace.tsx:3367-3378)', () => {
    // The job-list array is not updated in place for an already-present job
    // (:1117), so its status can be arbitrarily stale. The original `else`
    // branch called setResult(null) and replaced the result with a spinner.
    const next = nextResultBodyState(SHOWN, {
      type: 'job_status_observed', jobId: 'job_1', status: 'running', source: 'job-list',
    });
    expect(next).toBe(SHOWN);
  });

  it('keeps the body when the same job is re-fetched (project-workspace.tsx:3339-3344)', () => {
    // The DONE path called setLoading(true) + setResult(null) before issuing
    // the request — the largest blank in the component, hit on every refetch
    // of a result that was still perfectly valid.
    const next = nextResultBodyState(SHOWN, { type: 'result_fetch_started', jobId: 'job_1' });
    expect(next).toBe(SHOWN);
  });

  it('shows a spinner when a DIFFERENT job starts loading', () => {
    expect(nextResultBodyState(SHOWN, { type: 'result_fetch_started', jobId: 'job_2' }))
      .toEqual({ kind: 'loading', jobId: 'job_2' });
  });

  it('ignores a late reply for a job the user has left', () => {
    const next = nextResultBodyState(SHOWN, {
      type: 'result_fetch_succeeded', jobId: 'job_0', artifactName: 'stale.png',
    });
    expect(next).toBe(SHOWN);
  });

  it('renders the artifact when its own fetch succeeds', () => {
    expect(nextResultBodyState({ kind: 'loading', jobId: 'job_2' }, {
      type: 'result_fetch_succeeded', jobId: 'job_2', artifactName: 'heatmap.png',
    })).toEqual({ kind: 'artifact', jobId: 'job_2', artifactName: 'heatmap.png' });
  });

  it('does not replace a readable body with an error', () => {
    const next = nextResultBodyState(SHOWN, {
      type: 'result_fetch_failed', jobId: 'job_1', reason: 'network',
    });
    expect(next).toBe(SHOWN);
  });

  it('replaces a spinner with an error', () => {
    expect(nextResultBodyState({ kind: 'loading', jobId: 'job_1' }, {
      type: 'result_fetch_failed', jobId: 'job_1', reason: 'network',
    })).toEqual({ kind: 'error', jobId: 'job_1', reason: 'network' });
  });

  it('returns the same reference, not a copy, when the body survives', () => {
    // The invariant suite asserts with strict deepEqual, which rejects any
    // extra own key — even an undefined one. Degradation state belongs in a
    // sibling reducer, so this must be identity, not a spread.
    for (const event of [
      { type: 'interaction_manifest_failed' },
      { type: 'workflow_status_lost' },
      { type: 'result_fetch_started', jobId: 'job_1' },
    ] as const) {
      expect(nextResultBodyState(SHOWN, event)).toBe(SHOWN);
    }
  });
});
