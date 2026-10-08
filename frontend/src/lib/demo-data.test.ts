import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoDataTargetDir, loadDemoDataIntoWorkspace } from '@/lib/demo-data';

/** BLOCK-148 #12 补充契约锚：demo 载入命名冲突语义。
 * P2-2 后契约：409 target_already_exists 只证明「目标存在」不证明完整——
 * 装载器对 demo-data/ 命名空间自愈（fs/delete 残留后重传一次）；
 * 删除失败或重传再撞 409 才降级为 skipped（幂等跳过）。 */

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as unknown as Response;
}

function notOk(): Response {
  return { ok: false, status: 500, json: () => Promise.resolve({ ok: false, error: 'boom' }) } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubDemoFetch(opts: { deleteOk: boolean; retryAlsoExists?: boolean }) {
  const encoder = new TextEncoder();
  const uploadBodies: Array<{ toPath: string; offset: number }> = [];
  const deleteBodies: Array<{ paths: string[] }> = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: { body?: string }) => {
    if (url.endsWith('/tools/demo/deseq2')) {
      return Promise.resolve(jsonResponse({
        ok: true,
        files: [
          { name: 'demo-counts.csv', type: 'table' },
          { name: 'demo-coldata.csv', type: 'table' },
        ],
        source: 'plugin',
      }));
    }
    if (url.includes('/tools/demo-data/deseq2/')) {
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(encoder.encode('a,b\n1,2\n').buffer) } as unknown as Response);
    }
    if (url.includes('/fs/upload')) {
      const body = JSON.parse(init?.body ?? '{}') as { toPath: string; offset: number };
      uploadBodies.push(body);
      if (body.toPath === 'demo-data/deseq2/demo-counts.csv') {
        // 首个分片即撞已存在（幂等门在 offset=0）；可选让重传也再撞一次
        if (opts.retryAlsoExists || uploadBodies.filter((b) => b.toPath === body.toPath).length === 1) {
          return Promise.resolve(jsonResponse({ ok: false, error: '目标已存在', code: 'target_already_exists' }));
        }
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    if (url.includes('/fs/delete')) {
      deleteBodies.push(JSON.parse(init?.body ?? '{}') as { paths: string[] });
      return Promise.resolve(opts.deleteOk ? jsonResponse({ ok: true }) : notOk());
    }
    return Promise.resolve(jsonResponse({ ok: true }));
  }));
  return { uploadBodies, deleteBodies };
}

describe('loadDemoDataIntoWorkspace（BLOCK-148 #12 demo 一键载入）', () => {
  it('409 → 删残留后重传自愈：delete 收到该路径，结果 loaded（P2-2 契约）', async () => {
    const { uploadBodies, deleteBodies } = stubDemoFetch({ deleteOk: true });

    const summary = await loadDemoDataIntoWorkspace('p1', 'deseq2');
    expect(summary).toEqual({ listed: 2, loaded: 2, skipped: 0 });
    // 自愈链：counts 首传 409 → fs/delete({paths:[counts]}) → 重传成功 → coldata 正常
    expect(deleteBodies).toEqual([{ paths: ['demo-data/deseq2/demo-counts.csv'] }]);
    expect(uploadBodies.filter((b) => b.toPath === 'demo-data/deseq2/demo-counts.csv').length).toBe(2);
  });

  it('409 且 fs/delete 失败 → 降级 skipped、不抛错、不为该文件追发后续分片', async () => {
    const { uploadBodies, deleteBodies } = stubDemoFetch({ deleteOk: false });

    const summary = await loadDemoDataIntoWorkspace('p1', 'deseq2');
    expect(summary).toEqual({ listed: 2, loaded: 1, skipped: 1 });
    expect(deleteBodies.length).toBe(1);
    expect(uploadBodies.filter((b) => b.toPath === 'demo-data/deseq2/demo-counts.csv').length).toBe(1);
  });

  it('409、自愈重传再撞 409（删除后目标又出现）→ 降级 skipped 不抛错', async () => {
    const { uploadBodies } = stubDemoFetch({ deleteOk: true, retryAlsoExists: true });

    const summary = await loadDemoDataIntoWorkspace('p1', 'deseq2');
    expect(summary).toEqual({ listed: 2, loaded: 1, skipped: 1 });
    expect(uploadBodies.filter((b) => b.toPath === 'demo-data/deseq2/demo-counts.csv').length).toBe(2);
  });

  it('demoDataTargetDir：落地目录 = demo-data/<toolId>（3 段深度，tree 递归上限内）', () => {
    expect(demoDataTargetDir('deseq2')).toBe('demo-data/deseq2');
  });
});
