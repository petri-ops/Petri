import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeneratedFilesSurface } from './GeneratedFilesSurface';
import type { ToolActivityItem } from '@/components/copilot/toolActivity';

const state = vi.hoisted(() => ({
  changes: [] as Array<{ path: string; status: 'created' | 'modified'; lastChangedAt: number; tool?: string; iteration?: number }>,
  activities: [] as ToolActivityItem[],
  openPath: vi.fn(() => Promise.resolve({ ok: true })),
  showInFolder: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock('@/lib/desktopBridge', () => ({
  getBridge: (ns: string) => (ns === 'files' ? { openPath: state.openPath, showInFolder: state.showInFolder } : undefined),
}));

vi.mock('@/components/copilot/conversationChangesStore', () => ({
  hydrateConversationFileChanges: vi.fn(() => Promise.resolve()),
  useConversationFileChanges: () => state.changes,
}));
vi.mock('@/components/copilot/conversationRunStore', () => ({
  useConversationRun: () => ({ toolActivities: state.activities }),
}));

const PROJECT = {
  id: 'project-1',
  name: 'Project',
  workspacePath: 'C:/work',
  workspaceKind: 'local',
};

afterEach(() => {
  cleanup();
  state.changes = [];
  state.activities = [];
  state.openPath.mockClear();
  state.showInFolder.mockClear();
  vi.unstubAllGlobals();
});

describe('generated files surface', () => {
  it('renders the empty state when the conversation has no writes', async () => {
    render(<GeneratedFilesSurface project={PROJECT as never} conversationId="conv-1" onOpenFile={vi.fn()} />);
    expect(await screen.findByText('当前会话还没有写入过工作区文件。')).toBeTruthy();
    expect(screen.getByTestId('generated-files-surface').getAttribute('data-state')).toBe('empty');
  });

  it('shows workspace evidence and honestly reports a missing tool record', async () => {
    state.changes = [{ path: 'scripts/analysis.R', status: 'modified', lastChangedAt: 1, tool: 'workspace_write', iteration: 3 }];
    render(<GeneratedFilesSurface project={PROJECT as never} conversationId="conv-1" onOpenFile={vi.fn()} />);
    expect(await screen.findByText('scripts/analysis.R')).toBeTruthy();
    expect(screen.getByText('当前工作区版本')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '工具记录' }));
    expect(await screen.findByText(/没有找到对应的写入工具记录/)).toBeTruthy();
  });

  it('shows tool-recorded content when a write result carries it', async () => {
    state.changes = [{ path: 'scripts/analysis.R', status: 'modified', lastChangedAt: 1 }];
    state.activities = [{
      key: 'k', name: 'workspace_write', status: 'success', actionLabel: '已写入',
      resultData: { path: 'scripts/analysis.R', content: 'x <- 1' },
    }];
    render(<GeneratedFilesSurface project={PROJECT as never} conversationId="conv-1" onOpenFile={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '工具记录' }));
    expect(await screen.findByText('x <- 1')).toBeTruthy();
  });

  it('opens the current workspace file through the host callback', async () => {
    state.changes = [{ path: 'scripts/analysis.R', status: 'created', lastChangedAt: 1 }];
    const onOpenFile = vi.fn();
    render(<GeneratedFilesSurface project={PROJECT as never} conversationId="conv-1" onOpenFile={onOpenFile} />);
    fireEvent.click(await screen.findByRole('button', { name: '当前工作区版本' }));
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({
      path: 'scripts/analysis.R',
      workspaceDir: 'C:/work',
    }));
  });
});

describe('generated video artifacts (item 85 HK-01)', () => {
  const VIDEO_ACTIVITY: ToolActivityItem = {
    key: 'v1',
    name: 'generate.video',
    status: 'success',
    actionLabel: '已生成视频',
    resultData: {
      path: '/data/generated/generate-video/clip.mp4',
      url: '/api/generated/file/video/clip.mp4',
      mime: 'video/mp4',
    },
  };

  it('renders an inline preview supplied by the controlled read face', async () => {
    state.activities = [VIDEO_ACTIVITY];
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<GeneratedFilesSurface project={PROJECT as never} conversationId="conv-1" onOpenFile={vi.fn()} />);
    expect(await screen.findByTestId('generated-video-artifact')).toBeTruthy();
    expect(screen.getByTestId('video-result-viewer')).toBeTruthy();
    // 预览供给走 /api/generated 受控读面（83 落的单一真值），不另立第二套 URL
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.includes('/api/generated/file/video/clip.mp4'))).toBe(true);
    // 面板整体不是 empty：生成产物也算内容
    expect(screen.getByTestId('generated-files-surface').getAttribute('data-state')).toBe('ready');
  });

  it('opens the system player with the on-disk path through the files bridge', async () => {
    state.activities = [VIDEO_ACTIVITY];
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<GeneratedFilesSurface project={PROJECT as never} conversationId="conv-1" onOpenFile={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '系统播放器打开' }));
    expect(state.openPath).toHaveBeenCalledWith('/data/generated/generate-video/clip.mp4');
  });

  it('does not render video artifacts from failed activities (fail-closed)', async () => {
    state.activities = [{ ...VIDEO_ACTIVITY, status: 'error' }];
    render(<GeneratedFilesSurface project={PROJECT as never} conversationId="conv-1" onOpenFile={vi.fn()} />);
    expect(await screen.findByText('当前会话还没有写入过工作区文件。')).toBeTruthy();
    expect(screen.queryByTestId('generated-video-artifact')).toBeNull();
  });
});
