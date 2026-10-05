/**
 * fetchCrossJobPinSnapshot 契约测试（BLOCK-140 P1 第二刀，HK-01 红绿先行）。
 *
 * 跨 job 钉住的最小闭环：血缘节点「钉住」→ 按既有打开链同源数据源
 * （/tools/status/{jobId}，与 ResultArtifactShell 结果拉取同款）拉目标 job
 * 结果 → 首选产物 → 构成视图级快照（ArtifactPinSnapshot）。文本/表格载荷在
 * 钉住时刻一次取足（钉住动作=一次取数），副栏 ArtifactPinPane 照常零取数
 * 渲染（D1 不破）。report/image 只需 url 不取文件载荷。目标 job 无结果/
 * 无产物/请求失败 → null（诚实，不猜）。本文件先于模块落地，当前必须红。
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactPinPane } from './ArtifactPinPane';
import { fetchCrossJobPinSnapshot } from './crossJobPinSnapshot';

vi.mock('@/lib/authClient', () => ({
  getApiPrefix: () => '/api/r',
  getToken: () => null,
}));

const jsonResponse = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) }) as Response;
const textResponse = (text: string) => ({ ok: true, text: () => Promise.resolve(text) }) as Response;
// URL 派生：RequestInfo 可为 Request 对象（有 .url），不走 String() 防 [object Object]
const urlOf = (input: RequestInfo | URL): string =>
  (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

// 模块级 fetch 桩（类型化，仿 LineageStrip.test 先例）：mockReset 于 afterEach。
const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>();

describe('fetchCrossJobPinSnapshot（BLOCK-140 P1 跨 job 钉住）', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('拉目标 job 结果并取首选产物：csv → 表格快照（载荷钉住时刻一次取足）', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes('/tools/status/ancestor-job')) {
        return Promise.resolve(jsonResponse({
          ok: true,
          result: { artifacts: [{ name: 'marker-table.csv', type: 'table' }] },
        }));
      }
      if (url.includes('/tools/file/ancestor-job/marker-table.csv')) {
        return Promise.resolve(textResponse('gene,log2fc\nTP53,2.4'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const snapshot = await fetchCrossJobPinSnapshot({ toolJobId: 'ancestor-job', lang: 'r' });
    if (!snapshot) throw new Error('snapshot must not be null for a healthy target job');
    expect(snapshot.jobId).toBe('ancestor-job');
    expect(snapshot.artifactName).toBe('marker-table.csv');
    expect(snapshot.viewerAdapter).toBe('table');
    expect(snapshot.previewData).toEqual([['gene', 'log2fc'], ['TP53', '2.4']]);
    expect(snapshot.previewText).toBeNull();
    expect(snapshot.url).toBe('/api/r/tools/file/ancestor-job/marker-table.csv');
  });

  it('text 产物 → previewText 载荷', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes('/tools/status/ancestor-job')) {
        return Promise.resolve(jsonResponse({
          ok: true,
          result: { artifacts: [{ name: 'deconvolution-summary.txt', type: 'text', label: '反卷积摘要' }] },
        }));
      }
      if (url.includes('/tools/file/ancestor-job/deconvolution-summary.txt')) {
        return Promise.resolve(textResponse('祖先 job 的摘要正文'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const snapshot = await fetchCrossJobPinSnapshot({ toolJobId: 'ancestor-job', lang: 'r' });
    if (!snapshot) throw new Error('snapshot must not be null');
    expect(snapshot.viewerAdapter).toBe('text');
    expect(snapshot.previewText).toContain('祖先 job 的摘要正文');
    expect(snapshot.previewData).toBeNull();
    expect(snapshot.label).toBe('反卷积摘要');
  });

  it('report 产物 → 仅 url（previewText/previewData 皆空，且不发起文件取数）', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes('/tools/status/ancestor-job')) {
        return Promise.resolve(jsonResponse({
          ok: true,
          result: { artifacts: [{ name: 'final-report.html', type: 'report' }] },
        }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const snapshot = await fetchCrossJobPinSnapshot({ toolJobId: 'ancestor-job', lang: 'r' });
    if (!snapshot) throw new Error('snapshot must not be null');
    expect(snapshot.viewerAdapter).toBe('report');
    expect(snapshot.url).toBe('/api/r/tools/file/ancestor-job/final-report.html');
    expect(snapshot.previewText).toBeNull();
    expect(snapshot.previewData).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('目标 job 请求失败 / 无结果 / 无产物 → null（诚实，不猜）', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 500 } as Response));
    expect(await fetchCrossJobPinSnapshot({ toolJobId: 'bad-job', lang: 'r' })).toBeNull();

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: false, error: 'x' })));
    expect(await fetchCrossJobPinSnapshot({ toolJobId: 'bad-job', lang: 'r' })).toBeNull();

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true, result: { artifacts: [] } })));
    expect(await fetchCrossJobPinSnapshot({ toolJobId: 'empty-job', lang: 'r' })).toBeNull();
  });

  it('跨 job 钉住渲染：快照直接喂 ArtifactPinPane，离线渲染目标 job 产物（副栏零取数）', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes('/tools/status/ancestor-job')) {
        return Promise.resolve(jsonResponse({
          ok: true,
          result: { artifacts: [{ name: 'marker-table.csv', type: 'table' }] },
        }));
      }
      if (url.includes('/tools/file/ancestor-job/marker-table.csv')) {
        return Promise.resolve(textResponse('gene,log2fc\nTP53,2.4'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const onUnpin = vi.fn();

    const snapshot = await fetchCrossJobPinSnapshot({ toolJobId: 'ancestor-job', lang: 'r' });
    if (!snapshot) throw new Error('snapshot must not be null');
    // D1 基线取在快照构建后（构建的取数=钉住时刻合法取数）、render 前：
    const fetchCallsBeforeRender = fetchMock.mock.calls.length;
    render(
      <ArtifactPinPane mode="result" snapshot={snapshot} onUnpin={onUnpin}>
        <div data-testid="main-projection">主区产物（当前 job）</div>
      </ArtifactPinPane>,
    );

    const pane = screen.getByTestId('artifact-pin-pane');
    expect(pane.textContent).toContain('marker-table.csv');
    expect(pane.textContent).toContain('TP53');
    expect(screen.getByTestId('main-projection').textContent).toContain('主区产物（当前 job）');
    // D1：副栏渲染零取数（快照构建的取数都发生在 render 之前）
    expect(fetchMock.mock.calls.length).toBe(fetchCallsBeforeRender);
  });
});
