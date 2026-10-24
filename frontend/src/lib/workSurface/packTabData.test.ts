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
      [`${BASE}result-studio/lineage?jobId=job-1`, { body: JSON.stringify({ nodes, edges }) }],
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

  it('BLOCK-252 lineage：后端 lineage.chain 映射为节点/边', async () => {
    const routes = new Map<string, Route>([
      [`${BASE}result-studio/lineage?jobId=job-2`, {
        body: JSON.stringify({
          ok: true,
          lineage: {
            chain: [
              { toolJobId: 'tj_parent', toolId: 'qc', isCurrent: false },
              { toolJobId: 'tj_current', toolId: 'deseq2', isCurrent: true },
            ],
            downstreamCount: 0,
          },
        }),
      }],
    ]);
    const res = await fetchPackTabData('lineage', { jobId: 'job-2' }, { apiBase: BASE, fetchImpl: fetcher(routes).impl });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data || !('nodes' in res.data)) throw new Error('expected lineage payload');
    expect(res.data.nodes).toEqual([
      { id: 'tj_parent', label: 'qc', kind: 'ancestor' },
      { id: 'tj_current', label: 'deseq2', kind: 'current' },
    ]);
    expect(res.data.edges).toEqual([{ from: 'tj_parent', to: 'tj_current' }]);
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
      [`${BASE}result-studio/revisions/r1/source?projectId=p1`, { body: JSON.stringify({ source: long }) }],
    ]);
    const res = await fetchPackTabData('revisions-source', { projectId: 'p1', revisionId: 'r1' }, { apiBase: BASE, fetchImpl: fetcher(routes).impl });
    expect(res.ok).toBe(true);
    const payload = res.data;
    if (!payload || !('text' in payload)) throw new Error('expected source payload');
    expect(payload.truncated).toBe(true);
    expect(payload.text.length).toBeGreaterThan(PACK_TAB_LIMITS.sourceChars);
    expect(payload.text).toContain('已截断');
  });

  it('BLOCK-252 revisions-source：读取后端 content 字段', async () => {
    const routes = new Map<string, Route>([
      [`${BASE}result-studio/revisions/r3/source?projectId=p1`, { body: JSON.stringify({ content: 'plot(1)\n' }) }],
    ]);
    const res = await fetchPackTabData('revisions-source', { projectId: 'p1', revisionId: 'r3' }, { apiBase: BASE, fetchImpl: fetcher(routes).impl });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data || !('text' in res.data)) throw new Error('expected source payload');
    expect(res.data.text).toBe('plot(1)\n');
    expect(res.data.truncated).toBe(false);
  });

  it('HTTP 失败与坏 JSON 都如实返回原因', async () => {
    const routes = new Map<string, Route>([
      [`${BASE}result-studio/revisions/r9/source?projectId=p1`, { status: 500, body: '{}' }],
    ]);
    expect(await fetchPackTabData('revisions-source', { projectId: 'p1', revisionId: 'r9' }, { apiBase: BASE, fetchImpl: fetcher(routes).impl }))
      .toEqual({ ok: false, reason: 'http_500' });

    const badRoutes = new Map<string, Route>([
      [`${BASE}result-studio/revisions/r2/source?projectId=p1`, { body: 'not-json' }],
    ]);
    expect(await fetchPackTabData('revisions-source', { projectId: 'p1', revisionId: 'r2' }, { apiBase: BASE, fetchImpl: fetcher(badRoutes).impl }))
      .toEqual({ ok: false, reason: 'invalid_json' });
  });
});

describe('packTabData.compare（BLOCK-236 第二批）', () => {
  it('compare：按上限裁剪文件列表并标 truncated', async () => {
    const files = Array.from({ length: PACK_TAB_LIMITS.compareFiles + 3 }, (_, i) => ({
      path: `src/f${i}.ts`,
      status: 'modified',
      added: i,
      removed: 0,
    }));
    const routes = new Map<string, Route>([
      [`${BASE}result-studio/changesets/cs1/compare`, { body: JSON.stringify({ files }) }],
    ]);
    const res = await fetchPackTabData('compare', { changeSetId: 'cs1' }, { apiBase: BASE, fetchImpl: fetcher(routes).impl });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data || !('files' in res.data)) throw new Error('expected compare payload');
    expect(res.data.files).toHaveLength(PACK_TAB_LIMITS.compareFiles);
    expect(res.data.truncated).toBe(true);
  });

  it('BLOCK-252 compare：从 changeSet.changedPaths + textDiff 分桶逐文件 +/-', async () => {
    const patch = [
      'diff --git a/analysis/a.R b/analysis/a.R',
      '+++ b/analysis/a.R',
      '+plot(1)',
      '-plot(2)',
      'diff --git a/analysis/p.json b/analysis/p.json',
      '+{"x":1}',
    ].join('\n');
    const routes = new Map<string, Route>([
      [`${BASE}result-studio/changesets/cs2/compare`, {
        body: JSON.stringify({
          changeSet: {
            changedPaths: [
              { relativePath: 'analysis/a.R', changeType: 'modified' },
              { relativePath: 'analysis/p.json', changeType: 'added' },
            ],
          },
          textDiff: { patch, truncated: false },
        }),
      }],
    ]);
    const res = await fetchPackTabData('compare', { changeSetId: 'cs2' }, { apiBase: BASE, fetchImpl: fetcher(routes).impl });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data || !('files' in res.data)) throw new Error('expected compare payload');
    expect(res.data.files).toEqual([
      { path: 'analysis/a.R', status: 'modified', added: 1, removed: 1 },
      { path: 'analysis/p.json', status: 'added', added: 1, removed: 0 },
    ]);
  });

  it('compare：缺 changeSetId 直接拒绝（不发请求）', async () => {
    const { impl, calls } = fetcher(new Map());
    const res = await fetchPackTabData('compare', {}, { apiBase: BASE, fetchImpl: impl });
    expect(res).toEqual({ ok: false, reason: 'missing_changeset_id' });
    expect(calls).toHaveLength(0);
  });
});
