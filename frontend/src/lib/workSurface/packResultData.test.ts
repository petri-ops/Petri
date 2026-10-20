import { describe, expect, it, vi } from 'vitest';
import { loadPackResultData } from './packResultData';

function response(input: { ok?: boolean; status?: number; text?: string; blob?: Blob }): Response {
  return {
    ok: input.ok !== false,
    status: input.status ?? 200,
    text: () => Promise.resolve(input.text ?? ''),
    blob: () => Promise.resolve(input.blob ?? new Blob([])),
  } as unknown as Response;
}

describe('pack result data bridge (BLOCK-218)', () => {
  it('projects an image into a bounded data URL', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(response({
      blob: new Blob(['png-bytes'], { type: 'image/png' }),
    })));
    const data = await loadPackResultData({
      url: 'http://localhost:3001/artifact.png',
      kind: 'plot',
      fileName: 'volcano.png',
      fetchImpl,
    });
    expect(data.status).toBe('ready');
    expect(data.adapter).toBe('image');
    expect(data.imageDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects oversized images honestly', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(response({
      blob: new Blob(['x'.repeat(20)], { type: 'image/png' }),
    })));
    const data = await loadPackResultData({
      url: 'http://localhost:3001/artifact.png',
      kind: 'plot',
      fileName: 'volcano.png',
      fetchImpl,
      maxImageBytes: 10,
    });
    expect(data.status).toBe('unavailable');
    expect(data.reason).toBe('image_too_large');
  });

  it('parses a bounded table and marks truncation', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(response({
      text: 'gene,log2FoldChange\nA,1\nB,2\nC,3',
    })));
    const data = await loadPackResultData({
      url: 'http://localhost:3001/artifact.csv',
      kind: 'table',
      fileName: 'deg.csv',
      fetchImpl,
      maxTextChars: 25,
    });
    expect(data.status).toBe('ready');
    expect(data.adapter).toBe('table');
    expect(data.truncated).toBe(true);
    expect(data.rows?.[0]).toEqual(['gene', 'log2FoldChange']);
  });

  it('returns text for markdown/report and metadata-only for binary', async () => {
    const text = await loadPackResultData({
      url: 'http://localhost:3001/report.html',
      kind: 'report',
      fileName: 'report.html',
      fetchImpl: () => Promise.resolve(response({ text: '<h1>report</h1>' })),
    });
    expect(text.status).toBe('ready');
    expect(text.adapter).toBe('report');
    expect(text.text).toBe('<h1>report</h1>');

    const binary = await loadPackResultData({
      url: 'http://localhost:3001/archive.zip',
      kind: 'file',
      fileName: 'archive.zip',
      fetchImpl: () => Promise.resolve(response({ text: 'ignored' })),
    });
    expect(binary.status).toBe('unavailable');
    expect(binary.reason).toBe('binary_not_inline');
  });

  it('reports HTTP failures and missing URLs', async () => {
    const missing = await loadPackResultData({ url: '', kind: 'plot', fileName: 'volcano.png' });
    expect(missing.reason).toBe('no_artifact_url');

    const notFound = await loadPackResultData({
      url: 'http://localhost:3001/missing.png',
      kind: 'plot',
      fileName: 'volcano.png',
      fetchImpl: () => Promise.resolve(response({ ok: false, status: 404 })),
    });
    expect(notFound.status).toBe('unavailable');
    expect(notFound.reason).toBe('artifact_http_404');
  });
});
