import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopilotMarkdown } from './copilotMarkdown';
import { __resetFileReferenceCache, type ResolveResponse } from '@/lib/chat-file-references';

describe('CopilotMarkdown file references', () => {
  beforeEach(() => {
    __resetFileReferenceCache();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    __resetFileReferenceCache();
  });

  it('turns a verified inline-code filename into a direct-open link', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [{
          reference: 'report.html',
          resolved: {
            kind: 'artifact',
            jobId: 'job-1',
            artifactName: 'report.html',
            projectId: 'proj-1',
          },
        }],
      }) satisfies ResolveResponse,
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const onFileReferenceClick = vi.fn();

    render(
      <CopilotMarkdown
        text="查看 `report.html`"
        resolveContext={{ projectId: 'proj-1', activeJobId: 'job-1' }}
        onFileReferenceClick={onFileReferenceClick}
      />,
    );

    const link = await screen.findByRole('link', { name: 'report.html' });
    expect(link.className).toContain('cp-file-ref-code');
    fireEvent.click(link);
    expect(onFileReferenceClick).toHaveBeenCalledWith(expect.objectContaining({
      raw: 'report.html',
      kind: 'artifact',
      resolved: expect.objectContaining({ jobId: 'job-1', artifactName: 'report.html' }),
    }));
  });

  it('auto-links a verified source filename in assistant prose', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [{
          reference: 'model-registry.ts',
          resolved: {
            kind: 'workspace',
            projectId: 'proj-1',
            relativePath: 'frontend/src/model-registry.ts',
            name: 'model-registry.ts',
          },
        }],
      }) satisfies ResolveResponse,
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const onFileReferenceClick = vi.fn();

    render(
      <CopilotMarkdown
        text="已更新 model-registry.ts，请点击查看。"
        resolveContext={{ projectId: 'proj-1' }}
        onFileReferenceClick={onFileReferenceClick}
      />,
    );

    const link = await screen.findByRole('link', { name: 'model-registry.ts' });
    fireEvent.click(link);
    expect(onFileReferenceClick).toHaveBeenCalledWith(expect.objectContaining({
      raw: 'model-registry.ts',
      kind: 'workspace',
      resolved: expect.objectContaining({ relativePath: 'frontend/src/model-registry.ts' }),
    }));
  });

  it('auto-links a verified path with spaces in prose', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [{
          reference: 'results/final report.html',
          resolved: {
            kind: 'workspace',
            projectId: 'proj-1',
            relativePath: 'results/final report.html',
            name: 'final report.html',
          },
        }],
      }) satisfies ResolveResponse,
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const onFileReferenceClick = vi.fn();

    render(
      <CopilotMarkdown
        text={'打开 "results/final report.html" 查看报告。'}
        resolveContext={{ projectId: 'proj-1' }}
        onFileReferenceClick={onFileReferenceClick}
      />,
    );

    const link = await screen.findByRole('link', { name: 'results/final report.html' });
    fireEvent.click(link);
    expect(onFileReferenceClick).toHaveBeenCalledWith(expect.objectContaining({
      raw: 'results/final report.html',
      resolved: expect.objectContaining({ relativePath: 'results/final report.html' }),
    }));
  });

  it('auto-links a verified binary data file inside a table cell', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [{
          reference: 'Fig5_intermediate.RData',
          resolved: {
            kind: 'workspace',
            projectId: 'proj-1',
            relativePath: 'data/Fig5_intermediate.RData',
            name: 'Fig5_intermediate.RData',
          },
        }],
      }) satisfies ResolveResponse,
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CopilotMarkdown
        text={'| 文件 | 类型 |\n| --- | --- |\n| Fig5_intermediate.RData | R 工作区数据 |'}
        resolveContext={{ projectId: 'proj-1' }}
      />,
    );

    expect(await screen.findByRole('link', { name: 'Fig5_intermediate.RData' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves unresolved inline code inert', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, results: [] }) satisfies ResolveResponse,
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CopilotMarkdown
        text={'运行 `read.csv("missing.csv")`，结果是 `missing.csv`'}
        resolveContext={{ projectId: 'proj-1', activeJobId: 'job-1' }}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('link', { name: 'missing.csv' })).toBeNull();
    expect(screen.getAllByText(/missing\.csv/)).toHaveLength(2);
  });

  it('reruns the resolver when resolveNonce changes', async () => {
    __resetFileReferenceCache();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [{
          reference: 'report.html',
          resolved: {
            kind: 'artifact',
            jobId: 'job-1',
            artifactName: 'report.html',
            projectId: 'proj-1',
          },
        }],
      }) satisfies ResolveResponse,
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <CopilotMarkdown
        text={'查看 `report.html`'}
        resolveContext={{ projectId: 'proj-1', activeJobId: 'job-1' }}
        resolveNonce={0}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    __resetFileReferenceCache();
    rerender(
      <CopilotMarkdown
        text={'查看 `report.html`'}
        resolveContext={{ projectId: 'proj-1', activeJobId: 'job-1' }}
        resolveNonce={1}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('link', { name: 'report.html' })).toBeTruthy();
  });

  it('delegates fenced code highlighting to the host renderer', () => {
    const highlightCode = vi.fn((code: string, language?: string) => (
      <code data-language={language}>{code}</code>
    ));
    render(
      <CopilotMarkdown
        text={'```python\nprint("hello")\n```'}
        highlightCode={highlightCode}
      />,
    );

    expect(highlightCode).toHaveBeenCalledWith('print("hello")', 'python');
    expect(screen.getByText('print("hello")').getAttribute('data-language')).toBe('python');
    expect(screen.getByRole('button', { name: '复制代码' })).toBeTruthy();
    expect(screen.getByText('python').closest('.cp-code-head')).not.toBeNull();
  });

  it('renders text and tree fences without a language header', () => {
    const { container } = render(
      <CopilotMarkdown text={'```text\nsrc/\n  index.ts\n```'} />,
    );

    expect(screen.queryByText('text')).toBeNull();
    expect(container.querySelector('.cp-code-head')).toBeNull();
    expect(container.querySelector('.cp-code-block-plain')).not.toBeNull();
    expect(container.querySelector('.cp-code-plain-action button')).not.toBeNull();
  });

  it('renders status marks neutrally and provides table copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(
      <CopilotMarkdown
        text={'## 结果\n\n| 文件 | 状态 |\n| --- | --- |\n| Fig1 | ✅ 完成 |\n| Fig8 | ❌ 未完成 |'}
      />,
    );

    expect(screen.getByLabelText('✅').textContent).toBe('✓');
    expect(screen.getByLabelText('❌').textContent).toBe('×');
    const copyButton = screen.getByRole('button', { name: '复制' });
    expect(screen.queryByText('表格')).toBeNull();
    expect(copyButton.closest('.cp-table-figure')).not.toBeNull();
    expect(copyButton.closest('table')).toBeNull();
    expect(copyButton.closest('.cp-table-tools')).not.toBeNull();
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('文件\t状态\nFig1\t✅ 完成\nFig8\t❌ 未完成'));
    expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy();
  });
});
