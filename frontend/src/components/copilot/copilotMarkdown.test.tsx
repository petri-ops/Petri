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
});
