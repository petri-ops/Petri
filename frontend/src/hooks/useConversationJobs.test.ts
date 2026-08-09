import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listProjectJobs } from '@/lib/project-store';
import type { ToolJob } from '@/lib/project-types';
import {
  artifactAfterJobSelection,
  canCommitJobOpen,
  projectConversationJobs,
  useConversationJobs,
} from './useConversationJobs';

vi.mock('@/lib/project-store', () => ({
  listProjectJobs: vi.fn(),
}));

const mockedListProjectJobs = vi.mocked(listProjectJobs);

function job(id: string, conversationId: string | null): ToolJob {
  return { id, tool_id: 'volcano-plot', status: 'done', created_at: 1, conversationId };
}

beforeEach(() => {
  mockedListProjectJobs.mockReset();
});

describe('projectConversationJobs', () => {
  it('keeps only exact current-conversation jobs and never guesses legacy null jobs', () => {
    expect(projectConversationJobs([
      job('a-1', 'conversation-a'),
      job('b-1', 'conversation-b'),
      job('legacy', null),
    ], 'conversation-a').map((item) => item.id)).toEqual(['a-1']);
    expect(projectConversationJobs([job('legacy', null)], null)).toEqual([]);
  });
});

describe('artifactAfterJobSelection', () => {
  it('retains an artifact only while the selected Job identity is unchanged', () => {
    const artifact = { jobId: 'job-a', name: 'plot.png' };
    expect(artifactAfterJobSelection(artifact, 'job-a', 'job-a')).toBe(artifact);
    expect(artifactAfterJobSelection(artifact, 'job-a', 'job-b')).toBeNull();
    expect(artifactAfterJobSelection(artifact, 'job-a', null)).toBeNull();
  });
});

describe('canCommitJobOpen', () => {
  it('rejects a stale deep-link continuation after a newer navigation action', () => {
    expect(canCommitJobOpen(4, 4)).toBe(true);
    expect(canCommitJobOpen(4, 5)).toBe(false);
  });
});

describe('useConversationJobs', () => {
  it('requests the exact project and conversation scope', async () => {
    mockedListProjectJobs.mockResolvedValueOnce([job('a-1', 'conversation-a')]);
    const { result } = renderHook(() => useConversationJobs('project-1', 'conversation-a', 0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedListProjectJobs).toHaveBeenCalledWith('project-1', 'conversation-a');
    expect(result.current.jobs.map((item) => item.id)).toEqual(['a-1']);
  });

  it('does not fetch or expose unscoped project history without an active conversation', () => {
    const { result } = renderHook(() => useConversationJobs('project-1', null, 0));
    expect(result.current.jobs).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(mockedListProjectJobs).not.toHaveBeenCalled();
  });

  it('ignores a late response from the previously active conversation', async () => {
    let resolveA!: (jobs: ToolJob[]) => void;
    mockedListProjectJobs
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockResolvedValueOnce([job('b-1', 'conversation-b')]);
    const { result, rerender } = renderHook(
      ({ conversationId }) => useConversationJobs('project-1', conversationId, 0),
      { initialProps: { conversationId: 'conversation-a' } },
    );

    rerender({ conversationId: 'conversation-b' });
    await waitFor(() => expect(result.current.jobs.map((item) => item.id)).toEqual(['b-1']));
    await act(async () => {
      resolveA([job('a-1', 'conversation-a')]);
      await Promise.resolve();
    });
    expect(result.current.jobs.map((item) => item.id)).toEqual(['b-1']);
  });

  it('keeps the last good conversation result list when a refresh fails', async () => {
    mockedListProjectJobs.mockResolvedValueOnce([job('a-1', 'conversation-a')]);
    const { result } = renderHook(() => useConversationJobs('project-1', 'conversation-a', 0));
    await waitFor(() => expect(result.current.jobs.map((item) => item.id)).toEqual(['a-1']));

    mockedListProjectJobs.mockRejectedValueOnce(new Error('temporary failure'));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.jobs.map((item) => item.id)).toEqual(['a-1']);
    expect(result.current.error).toBe('temporary failure');
  });
});
