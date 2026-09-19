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
  it('polls slowly before a workflow exists, then follows live state', () => {
    // BLOCK-102 P4 降频契约：无 workflow 时 5s 空轮询（曾 1.5s=40 req/min），workflow 出现后恢复 1.5s。
    // 测试同步清偿（BLOCK-103 会话对账并行收口 03530c9b 漏改的断言）。
    expect(workflowPollDelay(null)).toBe(5000);
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
