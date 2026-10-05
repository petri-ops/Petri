import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineageStrip } from './LineageStrip';
import type { ResultLineageResponse } from './resultStudioClient';

const fetchResultLineage = vi.fn<(...args: unknown[]) => Promise<ResultLineageResponse>>();
vi.mock('./resultStudioClient', () => ({
  fetchResultLineage: (...args: unknown[]) => fetchResultLineage(...args),
}));
vi.mock('@/lib/tool-catalog', () => ({
  useToolCatalog: () => ({ tools: [{ id: 'deseq2', title: 'DESeq2 差异表达' }, { id: 'go-kegg', title: 'GO/KEGG 富集' }], loading: false, error: null, reload: () => {} }),
  findCatalogTool: (tools: Array<{ id: string; name: string }>, toolId: string | null) =>
    (toolId ? tools.find((t) => t.id === toolId) || null : null),
}));

const lineageOf = (chain: ResultLineageResponse['lineage']): ResultLineageResponse =>
  ({ ok: true, lineage: chain });

afterEach(() => { cleanup(); fetchResultLineage.mockReset(); });

describe('LineageStrip（BLOCK-127 BIO-3 P1 结果血缘条）', () => {
  it('renders the upstream chain with catalog names and the current node highlighted', async () => {
    fetchResultLineage.mockResolvedValue(lineageOf({
      chain: [
        { toolJobId: 'j1', toolId: 'deseq2', isCurrent: false },
        { toolJobId: 'j2', toolId: 'go-kegg', isCurrent: true },
      ],
      downstreamCount: 0,
    }));
    render(<LineageStrip projectId="p1" jobId="j2" />);
    expect(await screen.findByRole('button', { name: 'DESeq2 差异表达' })).toBeTruthy();
    const current = screen.getByRole('button', { name: 'GO/KEGG 富集' });
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(screen.getByLabelText('结果血缘链')).toBeTruthy();
  });

  it('dispatches projectOpenResult with the clicked upstream job', async () => {
    const dispatchSpy = vi.fn();
    window.dispatchEvent = dispatchSpy;
    fetchResultLineage.mockResolvedValue(lineageOf({
      chain: [
        { toolJobId: 'j1', toolId: 'deseq2', isCurrent: false },
        { toolJobId: 'j2', toolId: 'go-kegg', isCurrent: true },
      ],
      downstreamCount: 0,
    }));
    render(<LineageStrip projectId="p1" jobId="j2" />);
    fireEvent.click(await screen.findByRole('button', { name: 'DESeq2 差异表达' }));
    expect(dispatchSpy).toHaveBeenCalled();
    const target = dispatchSpy.mock.calls
      .map((call) => call[0] as Event)
      .find((evt) => evt.type === 'gewu:project-open-result');
    expect(target, 'projectOpenResult event must be dispatched').toBeTruthy();
    expect((target as CustomEvent).detail).toEqual({ toolJobId: 'j1', projectId: 'p1' });
  });

  it('renders nothing for a single-node chain or missing lineage (no fabricated truth)', async () => {
    fetchResultLineage.mockResolvedValue(lineageOf({
      chain: [{ toolJobId: 'j1', toolId: 'deseq2', isCurrent: true }],
      downstreamCount: 0,
    }));
    const { container } = render(<LineageStrip projectId="p1" jobId="j1" />);
    await waitFor(() => expect(fetchResultLineage).toHaveBeenCalled());
    expect(container.querySelector('[aria-label="结果血缘链"]')).toBeNull();

    cleanup();
    fetchResultLineage.mockResolvedValue({ ok: true, lineage: null, note: '暂无' });
    const second = render(<LineageStrip projectId="p1" jobId="j1" />);
    await waitFor(() => expect(fetchResultLineage).toHaveBeenCalledTimes(2));
    expect(second.container.querySelector('[aria-label="结果血缘链"]')).toBeNull();
  });

  it('fails silent (renders nothing) when the lineage endpoint errors', async () => {
    fetchResultLineage.mockRejectedValue(new Error('boom'));
    const { container } = render(<LineageStrip projectId="p1" jobId="j1" />);
    await waitFor(() => expect(fetchResultLineage).toHaveBeenCalled());
    expect(container.querySelector('[aria-label="结果血缘链"]')).toBeNull();
  });
});

describe('LineageStrip 节点钉住入口（BLOCK-140 P1 第二刀，HK-01 先红）', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'dispatchEvent');
  });

  it('节点「钉住」次级动作：回调带该节点 toolJobId/projectId；既有打开链不受影响', async () => {
    const onPinArtifact = vi.fn();
    const dispatchSpy = vi.fn();
    window.dispatchEvent = dispatchSpy;
    fetchResultLineage.mockResolvedValue(lineageOf({
      chain: [
        { toolJobId: 'j1', toolId: 'deseq2', isCurrent: false },
        { toolJobId: 'j2', toolId: 'go-kegg', isCurrent: true },
      ],
      downstreamCount: 0,
    }));
    render(<LineageStrip projectId="p1" jobId="j2" onPinArtifact={onPinArtifact} />);
    // 次级动作：悬停小钮（可寻址名=钉住 + 节点标签）
    fireEvent.click(await screen.findByRole('button', { name: '钉住 DESeq2 差异表达' }));
    expect(onPinArtifact).toHaveBeenCalledTimes(1);
    expect(onPinArtifact).toHaveBeenCalledWith({ projectId: 'p1', toolJobId: 'j1' });
    // 既有打开链保留：普通节点点击仍走 projectOpenResult
    fireEvent.click(screen.getByRole('button', { name: 'DESeq2 差异表达' }));
    const target = dispatchSpy.mock.calls
      .map((call) => call[0] as Event)
      .find((evt) => evt.type === 'gewu:project-open-result');
    expect(target, 'projectOpenResult event must be dispatched').toBeTruthy();
    expect((target as CustomEvent).detail).toEqual({ toolJobId: 'j1', projectId: 'p1' });
  });
});
