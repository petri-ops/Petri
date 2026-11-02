// BLOCK-334 P2 Slice D — 文件宿主 xlsx/xlsm 经 viewerRegistry 命中 spreadsheet 后走两宿主唯一的 SpreadsheetViewer。
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveWorkspaceFile } from './types';
import { ThemeProvider } from '@/themes/ThemeProvider';

vi.mock('@/lib/desktopBridge', () => ({ getBridge: () => ({ writeTextFile: vi.fn() }) }));
vi.mock('@/components/editor', () => ({ WorkspaceFilePreviewBridge: () => <div data-testid="mock-editor" /> }));
interface ViewerProps { url: string; name: string; authToken?: string | null; onAnnotateRow?: unknown; onLoaded?: unknown }
const viewerSpy = vi.fn<(props: ViewerProps) => void>();
vi.mock('@/components/viewers/SpreadsheetViewer', () => ({
  SpreadsheetViewer: (props: ViewerProps) => { viewerSpy(props); return <div data-testid="mock-spreadsheet-viewer" />; },
}));
vi.mock('@/lib/office-file-preview', () => ({
  loadOfficePreview: vi.fn(() => Promise.reject(new Error('must not be called for xlsx'))),
  revokeOfficePreviewBlobs: vi.fn(),
}));

import { WorkspaceFilePreview } from './WorkspaceFilePreview';

function xlsxFile(): ActiveWorkspaceFile {
  return {
    name: 'deg.xlsx', path: 'results/deg.xlsx',
    url: 'http://localhost:3001/api/workspaces/p_x/file?path=results%2Fdeg.xlsx',
    workspaceKind: 'local', workspaceDir: '/ws', modifiedAt: 1,
  } as unknown as ActiveWorkspaceFile;
}

afterEach(() => { cleanup(); viewerSpy.mockClear(); });

describe('WorkspaceFilePreview × SpreadsheetViewer（Slice D）', () => {
  it('xlsx 文件直接渲染共享 SpreadsheetViewer（带 Bearer 与行批注回调），不走 office 库也不落二进制兜底卡', () => {
    render(
      <ThemeProvider>
        <WorkspaceFilePreview file={xlsxFile()} refreshVersion={0} openError="" opening={false} onOpen={() => {}} onDownload={() => {}} projectId="p_x" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mock-spreadsheet-viewer')).toBeTruthy();
    const props = viewerSpy.mock.calls[0][0];
    expect(props.name).toBe('deg.xlsx');
    expect(props.url).toContain('results%2Fdeg.xlsx');
    expect(typeof props.onAnnotateRow).toBe('function');
    expect(typeof props.onLoaded).toBe('function');
    expect(screen.queryByText(/系统应用/)).toBeNull();
    expect(screen.getByTestId('annotation-unavailable-hint').textContent).toContain('行号');
  });
});
