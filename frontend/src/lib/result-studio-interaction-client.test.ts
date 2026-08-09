import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArtifactInteraction } from './result-studio-interaction-client';

vi.mock('@/lib/authClient', () => ({
  getApiPrefix: () => '/api/r',
  getToken: () => null,
}));

afterEach(() => vi.unstubAllGlobals());

describe('P4R-4 explicit Revision interaction binding', () => {
  it('sends the viewed revisionId instead of asking the server to infer from Job', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ manifest: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchArtifactInteraction({
      language: 'r',
      jobId: 'job_shared',
      artifact: 'plot.png',
      revisionId: 'rev_historical',
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('revisionId=rev_historical');
  });
});
