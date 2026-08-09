import { afterEach, describe, expect, it, vi } from 'vitest';
import { listProjectJobs } from './project-store';

vi.mock('./authClient', () => ({
  getPlatformApiPrefix: () => '/api',
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function response(jobs: Array<Record<string, unknown>>) {
  return {
    json: async () => ({ status: 'ok', jobs }),
  } as Response;
}

describe('project job conversation projection', () => {
  it('encodes an exact conversation query when requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal('fetch', fetchMock);

    await listProjectJobs('project-1', 'conversation / 1');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/data/projects/project-1/jobs?conversationId=conversation+%2F+1');
  });

  it('keeps project-wide listing explicit and preserves camel, snake, and null identities', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([
      { id: 'camel', tool_id: 'a', status: 'completed', created_at: 3, conversationId: 'conversation-a' },
      { id: 'snake', tool_id: 'b', status: 'running', created_at: 2, conversation_id: 'conversation-b' },
      { id: 'legacy', tool_id: 'c', status: 'failed', created_at: 1, conversation_id: null },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const jobs = await listProjectJobs('project-1');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/data/projects/project-1/jobs');
    expect(jobs.map((job) => [job.id, job.conversationId])).toEqual([
      ['camel', 'conversation-a'],
      ['snake', 'conversation-b'],
      ['legacy', null],
    ]);
  });
});
