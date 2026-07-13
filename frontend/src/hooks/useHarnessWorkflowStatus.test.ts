import { describe, expect, it } from 'vitest';
import { isDirectRecoveryAction, workflowPollDelay } from './useHarnessWorkflowStatus';
import type { HarnessWorkflowJobState } from '@/lib/harness-client';

function workflow(terminal: boolean): HarnessWorkflowJobState {
  return {
    harnessWorkflowStateVersion: 1,
    jobStatus: terminal ? 'completed' : 'running',
    terminal,
    recoverable: false,
    artifactCount: terminal ? 2 : 0,
    stages: [],
  };
}

describe('workflowPollDelay', () => {
  it('polls while no state or a live state is available', () => {
    expect(workflowPollDelay(null)).toBe(1500);
    expect(workflowPollDelay(workflow(false))).toBe(1500);
  });

  it('stops polling terminal workflows', () => {
    expect(workflowPollDelay(workflow(true))).toBeNull();
  });

  it('only executes bounded recovery actions directly', () => {
    expect(isDirectRecoveryAction('reconcile_artifacts')).toBe(true);
    expect(isDirectRecoveryAction('retry_run')).toBe(true);
    expect(isDirectRecoveryAction('repair_artifacts')).toBe(false);
    expect(isDirectRecoveryAction('review_artifacts')).toBe(false);
  });
});
