import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataIntakeControl } from './DataIntakeControl';
import * as dataProfile from '@/lib/data-profile';
import type { ImportedDataFile } from '@/lib/data-profile';

function imported(name: string, role: string, confidence: number): ImportedDataFile {
  const isCounts = role === 'counts_matrix';
  const headers = isCounts ? ['gene', 'S1', 'S2'] : ['sample', 'group'];
  const dataRows = isCounts ? [['G1', '1', '2'], ['G2', '3', '4']] : [['S1', 'control'], ['S2', 'case']];
  return {
    name,
    relativePath: `data/${name}`,
    size: 120,
    profile: {
      status: 'ok',
      blocked: false,
      snapshot: {
        projectId: 'p1',
        relativePath: `data/${name}`,
        size: 120,
        modifiedAt: 1,
        sha256: (role === 'counts_matrix' ? 'a' : 'b').repeat(64),
        encoding: 'utf-8',
        delimiter: ',',
      },
      observation: {
        headers,
        sample: {
          rows: [headers, ...dataRows],
          dataRows,
          rowCount: 3,
          totalRowCount: 3,
          dataRowCount: 2,
          columnCount: headers.length,
          bounds: {
            rows: { observed: 3, truncated: false },
            columns: { observed: headers.length, truncated: false },
          },
        },
        totalRowCount: 3,
        columnBounds: { observed: 3 },
        fileRoleCandidates: [{ candidate: role, confidence, evidence: {}, basis: 'fixture' }],
      },
      diagnostics: [],
      diagnosticCodes: [],
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SDC1-A data intake control', () => {
  it('imports one batch, projects readiness, and hands exact files to the Agent', async () => {
    vi.spyOn(dataProfile, 'importProjectData').mockResolvedValue([
      imported('counts.csv', 'counts_matrix', 0.92),
      imported('metadata.csv', 'sample_metadata', 0.89),
    ]);
    const prompts: string[] = [];
    const onAskAgent = (prompt: string) => {
      prompts.push(prompt);
      return true;
    };
    const view = render(<DataIntakeControl projectId="p1" onAskAgent={onAskAgent} />);

    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['counts'], 'counts.csv'), new File(['metadata'], 'metadata.csv')] },
    });

    await waitFor(() => expect(screen.getByText('可开始分析')).toBeTruthy());
    expect(screen.getByText('counts.csv')).toBeTruthy();
    expect(screen.getByText('metadata.csv')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /\u5f00\u59cb\u5206\u6790/ }));

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('data/counts.csv');
    expect(prompts[0]).toContain('data/metadata.csv');
  });

  it('does not expose an enabled analysis command for an incomplete batch', async () => {
    vi.spyOn(dataProfile, 'importProjectData').mockResolvedValue([
      imported('counts.csv', 'counts_matrix', 0.92),
    ]);
    const view = render(<DataIntakeControl projectId="p1" onAskAgent={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['counts'], 'counts.csv')] },
    });

    await waitFor(() => expect(screen.getByText(/sample_metadata 候选/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /\u5f00\u59cb\u5206\u6790/ }).hasAttribute('disabled')).toBe(true);
  });

  it('aborts an old project import and ignores its late response after project switch', async () => {
    let resolveImport!: (files: ImportedDataFile[]) => void;
    let importSignal: AbortSignal | undefined;
    vi.spyOn(dataProfile, 'importProjectData').mockImplementation((_projectId, _files, signal) => {
      importSignal = signal;
      return new Promise((resolve) => { resolveImport = resolve; });
    });
    const view = render(<DataIntakeControl projectId="p1" onAskAgent={vi.fn()} />);
    fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['counts'], 'counts.csv')] },
    });
    await waitFor(() => expect(importSignal).toBeDefined());

    view.rerender(<DataIntakeControl projectId="p2" onAskAgent={vi.fn()} />);
    expect(importSignal?.aborted).toBe(true);
    await act(async () => {
      resolveImport([imported('counts.csv', 'counts_matrix', 0.92)]);
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    expect(screen.queryByText('counts.csv')).toBeNull();
    expect(screen.getByText('选择数据文件')).toBeTruthy();
  });
});
