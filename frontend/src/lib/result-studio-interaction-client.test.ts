import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArtifactInteraction, fetchResultStudioContext } from './result-studio-interaction-client';

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

// ============================================================================
// BLOCK-139 T2 修复契约 — fetchResultStudioContext 透出后端重投影 Revision 坐标
//
// context-envelope 端点同时返回完整 envelope；前端此前只读 agentView/editControls。
// T2 修复需要 envelope.artifact.artifactId + envelope.revision.revisionId 作为
// 交互 manifest 缺 revisionId 时的补锚真相（与 agent 上下文同一投影），但
// 前端绝不伪造身份：坐标缺失/非法时 resolvedRevision=null，blocked 时也为 null。
// ============================================================================

describe('BLOCK-139 T2：fetchResultStudioContext 透出 resolvedRevision', () => {
  it('ready 时从 envelope 取 artifactId+revisionId（trim 后透出）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      envelope: {
        artifact: { artifactId: 'deg_table' },
        revision: { revisionId: ' rev_chain_f1 ' },
      },
      agentView: { contextToken: 'rst_abc' },
      editControls: { controlsVersion: 1 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchResultStudioContext({ language: 'r', projectId: 'p1' });

    expect(result.status).toBe('ready');
    expect(result.resolvedRevision).toEqual({ artifactId: 'deg_table', revisionId: 'rev_chain_f1' });
  });

  it('envelope 缺 revision 坐标时不伪造（resolvedRevision=null）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      envelope: { artifact: { artifactId: 'deg_table' } },
      agentView: {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchResultStudioContext({ language: 'r', projectId: 'p1' });

    expect(result.status).toBe('ready');
    expect(result.resolvedRevision).toBeNull();
  });

  it('blocked（409 诊断）时 resolvedRevision=null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'context_artifact_not_open',
      diagnostics: [{ code: 'context_artifact_not_open', message: '未打开' }],
    }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchResultStudioContext({ language: 'r', projectId: 'p1' });

    expect(result.status).toBe('blocked');
    expect(result.resolvedRevision).toBeNull();
    expect(result.diagnostics[0]?.code).toBe('context_artifact_not_open');
  });
});
