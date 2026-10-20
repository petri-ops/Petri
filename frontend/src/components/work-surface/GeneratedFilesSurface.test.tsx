import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeneratedFilesSurface } from './GeneratedFilesSurface';
import type { ToolActivityItem } from '@/components/copilot/toolActivity';

const state = vi.hoisted(() => ({
  changes: [] as Array<{ path: string; status: 'created' | 'modified'; lastChangedAt: number; tool?: string; iteration?: number }>,
  activities: [] as ToolActivityItem[],
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
