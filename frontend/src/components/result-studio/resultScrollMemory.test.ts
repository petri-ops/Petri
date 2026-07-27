/**
 * G0-RS-P4R-2 - result↔chat scroll preservation, tested where it can be tested.
 *
 * The scroll memory is a module-level Map keyed by job id. The restore effect
 * in ResultArtifactShell reads it on mount; the onScroll handler writes it.
 * These tests cover the pure memory contract; the wiring (ref + effect) is
 * covered by the invariant that `.resultView` carries the handlers, which a
 * refactor that drops them would break.
 *
 * Only result↔chat is in scope (plan §P4R-2): code/history are not in
 * WorkspaceMode and compare renders identically to result.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  getResultScrollPosition,
  setResultScrollPosition,
  clearResultScrollPosition,
  __resetResultScrollMemoryForTest,
} from './resultScrollMemory';

describe('resultScrollMemory', () => {
  beforeEach(() => {
    __resetResultScrollMemoryForTest();
  });

  it('returns 0 for a job that was never recorded', () => {
    expect(getResultScrollPosition('job_1')).toBe(0);
  });

  it('returns 0 for null/undefined ids and does not record them', () => {
    setResultScrollPosition(null, 123);
    setResultScrollPosition(undefined, 456);
    expect(getResultScrollPosition(null)).toBe(0);
    expect(getResultScrollPosition(undefined)).toBe(0);
  });

  it('records and returns the scrollTop for a job', () => {
    setResultScrollPosition('job_1', 412);
    expect(getResultScrollPosition('job_1')).toBe(412);
  });

  it('isolates positions by job id (switching job resets, switching mode does not)', () => {
    // result↔chat switches keep the same job id, so the position survives.
    setResultScrollPosition('job_1', 412);
    expect(getResultScrollPosition('job_1')).toBe(412);
    // A different job has its own slot, not the previous job's position.
    expect(getResultScrollPosition('job_2')).toBe(0);
    setResultScrollPosition('job_2', 88);
    expect(getResultScrollPosition('job_1')).toBe(412);
    expect(getResultScrollPosition('job_2')).toBe(88);
  });

  it('overwrites the position on repeat writes for the same job', () => {
    setResultScrollPosition('job_1', 100);
    setResultScrollPosition('job_1', 300);
    expect(getResultScrollPosition('job_1')).toBe(300);
  });

  it('clears a recorded position but leaves other jobs untouched', () => {
    setResultScrollPosition('job_1', 412);
    setResultScrollPosition('job_2', 88);
    clearResultScrollPosition('job_1');
    expect(getResultScrollPosition('job_1')).toBe(0);
    expect(getResultScrollPosition('job_2')).toBe(88);
  });

  it('clear is a no-op for unknown or null ids', () => {
    clearResultScrollPosition('never_recorded');
    clearResultScrollPosition(null);
    setResultScrollPosition('job_1', 412);
    clearResultScrollPosition(null);
    expect(getResultScrollPosition('job_1')).toBe(412);
  });
});
