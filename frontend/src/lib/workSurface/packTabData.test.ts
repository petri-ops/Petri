import { describe, expect, it } from 'vitest';
import { PACK_TAB_LIMITS, fetchPackTabData } from './packTabData';

interface Route {
  status?: number;
  body: string;
}

function fetcher(routes: Map<string, Route>) {
  const calls: string[] = [];
  const impl = (url: string) => {
    calls.push(url);
    const hit = routes.get(url);
    const status = hit?.status ?? (hit ? 200 : 404);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(hit?.body ?? ''),
    });
  };
  return { impl, calls };
}

const BASE = 'http://mock/';

describe('packTabData（BLOCK-236）', () => {
  it('lineage：节点/边裁剪到上限并标 truncated', async () => {
    const nodes = Array.from({ length: PACK_TAB_LIMITS.lineageNodes + 5 }, (_, i) => ({ id: `n${i}` }));
    const edges = Array.from({ length: PACK_TAB_LIMITS.lineageEdges + 5 }, (_, i) => ({ from: `n${i}`, to: 'n0' }));
    const routes = new Map<string, Route>([
      [`${BASE}api/result-studio/lineage?jobId=job-1`, { body: JSON.stringify({ nodes, edges }) }],
    ]);
    const res = await fetchPackTabData('lineage', { jobId: 'job-1' }, { apiBase: BASE, fetchImpl: fetcher(routes).impl });
    expect(res.ok).toBe(true);
    const data = res.data;
    expect(Array.isArray(data)).toBe(false);
    const payload = data;
    if (!payload || !('nodes' in payload)) throw new Error('expected lineage payload');
    expect(payload.nodes).toHaveLength(PACK_TAB_LIMITS.lineageNodes);
    expect(payload.edges).toHaveLength(PACK_TAB_LIMITS.lineageEdges);
    expect(payload.truncated).toBe(true);
  });

  it('lineage：缺 jobId 直接拒绝（不发请求）', async () => {
    const { impl, calls } = fetcher(new Map());
    const res = await fetchPackTabData('lineage', {}, { apiBase: BASE, fetchImpl: impl });
    expect(res).toEqual({ ok: false, reason: 'missing_job_id' });
    expect(calls).toHaveLength(0);
  });

  it('history：没有列表端点 → 明确 no_endpoint（不拿别的数据冒充）', async () => {
    const { impl } = fetcher(new Map());
    const res = await fetchPackTabData('history', { jobId: 'job-1' }, { apiBase: BASE, fetchImpl: impl });
    expect(res).toEqual({ ok: false, reason: 'no_endpoint' });
  });

  it('revisions-source：超长源码截断并留提示', async () => {
    const long = 'x'.repeat(PACK_TAB_LIMITS.sourceChars + 10);
    const routes = new Map<string, Route>([
      [`${BASE}api/result-studio/revisions/r1/source`, { body: JSON.stringify({ source: long }) }],
    ]);
    const res = await fetchPackTabData('revisions-source', { revisionId: 'r1' }, { apiBase: BASE, fetchImpl: fetcher(routes).impl });
    expect(res.ok).toBe(true);
    const payload = res.data;
    if (!payload || !('text' in payload)) throw new Error('expected source payload');
    expect(payload.truncated).toBe(true);
    expect(payload.text.length).toBeGreaterThan(PACK_TAB_LIMITS.sourceChars);
    expect(payload.text).toContain('已截断');
  });

  it('HTTP 失败与坏 JSON 都如实返回原因', async () => {
    const routes = new Map<string, Route>([
      [`${BASE}api/result-studio/revisions/r9/source`, { status: 500, body: '{}' }],
    ]);
    expect(await fetchPackTabData('revisions-source', { revisionId: 'r9' }, { apiBase: BASE, fetchImpl: fetcher(routes).impl }))
      .toEqual({ ok: false, reason: 'http_500' });

    const badRoutes = new Map<string, Route>([
      [`${BASE}api/result-studio/revisions/r2/source`, { body: 'not-json' }],
    ]);
    expect(await fetchPackTabData('revisions-source', { revisionId: 'r2' }, { apiBase: BASE, fetchImpl: fetcher(badRoutes).impl }))
      .toEqual({ ok: false, reason: 'invalid_json' });
  });
});
