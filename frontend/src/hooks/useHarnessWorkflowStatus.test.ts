import { describe, expect, it } from 'vitest';
import { workflowPollDelay } from './useHarnessWorkflowStatus';
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
});
