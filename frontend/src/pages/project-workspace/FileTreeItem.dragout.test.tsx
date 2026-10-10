// UI-453 — 文件树拖出（OS 导出）DownloadURL 契约测试：
// 统一 REST 形态（本地/ssh 同构），不再有 file:// 未编码路径（Windows 从未可用的旧分支）。

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from './types';
import { FileTreeItem } from './FileTreeItem';

// UI-453 加映二 — 拖出经主进程 webContents.startDrag（真文件拖拽），mock 桥观察载荷
type DragPayload = { name: string; localPath?: string; url?: string };
const startFileDragMock = vi.fn((_payload: DragPayload) => Promise.resolve({ ok: true }));
vi.mock('@/lib/desktopBridge', () => ({
  getBridge: () => ({ startFileDrag: startFileDragMock }),
}));

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

describe('UI-453 加映二 拖出经 startDrag 真文件拖拽', () => {
  it('本地项目文件行 dragstart：主进程 startDrag 收 localPath（OS 级复制语义），不写 DownloadURL', () => {
    const view = renderItem(entry, 'local');
    const dt = dataTransferStub();
    fireEvent.dragStart(view.getByRole('treeitem'), { dataTransfer: dt });
    expect(startFileDragMock).toHaveBeenCalledTimes(1);
    expect(startFileDragMock.mock.calls[0][0]).toEqual({
      name: '样本 文件.md',
      localPath: 'D:\\工作 目录/样本 文件.md',
    });
    expect(dt.setData.mock.calls.some(([mime]) => mime === 'DownloadURL')).toBe(false);
  });

  it('ssh 项目：startDrag 收 REST URL（附 token），无 localPath', () => {
    const view = renderItem(entry, 'ssh');
    const dt = dataTransferStub();
    fireEvent.dragStart(view.getByRole('treeitem'), { dataTransfer: dt });
    expect(startFileDragMock).toHaveBeenCalledTimes(1);
    const payload = startFileDragMock.mock.calls[0]?.[0];
    expect(payload.localPath).toBeUndefined();
    expect(payload.url).toContain('http://localhost:3001/api/workspaces/p1/file?path=');
    expect(payload.url).toContain('token=desktop-local');
  });

  it('目录行不触发 startDrag（只挂树内 MIME）', () => {
    const view = renderItem(dirEntry);
    const dt = dataTransferStub();
    fireEvent.dragStart(view.getByRole('treeitem'), { dataTransfer: dt });
    expect(startFileDragMock).not.toHaveBeenCalled();
    expect(dt.setData.mock.calls.some(([mime]) => mime === 'application/x-petri-tree-item')).toBe(true);
  });
});
