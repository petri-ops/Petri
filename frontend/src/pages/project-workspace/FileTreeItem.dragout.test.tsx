// UI-453 — 文件树拖出（OS 导出）DownloadURL 契约测试：
// 统一 REST 形态（本地/ssh 同构），不再有 file:// 未编码路径（Windows 从未可用的旧分支）。

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from './types';
import { FileTreeItem } from './FileTreeItem';

const entry: FileEntry = { name: '样本 文件.md', type: 'file', size: 12, modifiedAt: 42 };
const dirEntry: FileEntry = { name: 'docs', type: 'dir' };

function dataTransferStub() {
  const store = new Map<string, string>();
  return {
    types: [] as string[],
    setData: vi.fn((mime: string, value: string) => {
      store.set(mime, value);
    }),
    getData: vi.fn((mime: string) => store.get(mime) ?? ''),
    effectAllowed: '',
    dropEffect: '',
  };
}

function renderItem(e: FileEntry, kind: 'local' | 'ssh' = 'local') {
  return render(
    <FileTreeItem
      entry={e}
      fullPath={e.name}
      isExpanded={false}
      depth={0}
      expandedDirs={new Set()}
      onToggleDir={() => {}}
      onFetchDir={() => Promise.resolve([])}
      onFetchDirPage={() => Promise.resolve({ entries: [], total: 0, truncated: false })}
      fileUrlFor={(p) => `http://localhost:3001/api/workspaces/p1/file?path=${encodeURIComponent(p)}`}
      onOpenFile={() => {}}
      activePath={null}
      refreshVersion={0}
      workspaceDir={kind === 'local' ? 'D:\\工作 目录' : undefined}
      workspaceKind={kind}
      onRowContextMenu={() => {}}
      onDropToDir={() => {}}
    />,
  );
}

afterEach(cleanup);

describe('UI-453 拖出 DownloadURL 统一 REST', () => {
  it('文件行 dragstart：DownloadURL 为预览同源 REST 形态（本地项目也是，无 file://）', () => {
    const view = renderItem(entry, 'local');
    const row = view.getByRole('treeitem');
    const dt = dataTransferStub();
    fireEvent.dragStart(row, { dataTransfer: dt });
    const downloadUrl = dt.setData.mock.calls.find(([mime]) => mime === 'DownloadURL')?.[1] ?? '';
    expect(downloadUrl).toContain('application/octet-stream:样本 文件.md:http://localhost:3001/api/workspaces/p1/file?path=');
    expect(downloadUrl).not.toContain('file://');
    expect(downloadUrl).not.toContain('D:');
  });

  it('ssh 项目同构：同样 REST 形态（工作目录不进 URL）', () => {
    const view = renderItem(entry, 'ssh');
    const dt = dataTransferStub();
    fireEvent.dragStart(view.getByRole('treeitem'), { dataTransfer: dt });
    const downloadUrl = dt.setData.mock.calls.find(([mime]) => mime === 'DownloadURL')?.[1] ?? '';
    expect(downloadUrl).toMatch(/^application\/octet-stream:.+:http:\/\/localhost:3001\/api\//);
  });

  it('目录行不携带 DownloadURL（只挂树内 MIME）', () => {
    const view = renderItem(dirEntry);
    const dt = dataTransferStub();
    fireEvent.dragStart(view.getByRole('treeitem'), { dataTransfer: dt });
    expect(dt.setData.mock.calls.some(([mime]) => mime === 'DownloadURL')).toBe(false);
    expect(dt.setData.mock.calls.some(([mime]) => mime === 'application/x-gewu-tree-item')).toBe(true);
  });
});
