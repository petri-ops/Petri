// item 88 第三波——面板联动快照测试（生成文件面：wb 视频产物段 + 工作区行）。
// 固定 mock 数据源（stores 全 mock），快照守护渲染形状（attempt2 视频段 + 工作区行共存形态）。
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolActivityItem } from '@/components/copilot/toolActivity';

const state = vi.hoisted(() => ({
  changes: [] as Array<{ path: string; status: 'created' | 'modified'; lastChangedAt: number; tool?: string; iteration?: number }>,
  activities: [] as ToolActivityItem[],
  openPath: vi.fn(),
  showInFolder: vi.fn(),
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

// VideoResultViewer 的 fetch 拉字节——快照环境固定失败态（fail 三态之一，形状稳定）
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));

import { GeneratedFilesSurface } from './GeneratedFilesSurface';

const PROJECT = {
  id: 'project-1',
  name: 'Project',
  workspacePath: 'C:/work',
  workspaceKind: 'local',
};

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

afterEach(() => {
  cleanup();
  state.changes = [];
  state.activities = [];
});

describe('GeneratedFilesSurface 快照（item 88 第三波）', () => {
  it('wb 视频产物段快照（生成视频在面板的联动形态）', async () => {
    state.activities = [VIDEO_ACTIVITY];
    const { asFragment } = render(
      <GeneratedFilesSurface project={PROJECT as never} conversationId="conv_demo_wb88" onOpenFile={vi.fn()} />,
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="generated-video-artifact"]')).toBeTruthy();
    });
    expect(asFragment()).toMatchSnapshot('video-artifact-section');
  });

  it('工作区改动行快照（无视频产物共存形态）', () => {
    state.changes = [{ path: 'scripts/analysis.R', status: 'modified', lastChangedAt: 1, tool: 'workspace_write', iteration: 3 }];
    const { asFragment } = render(
      <GeneratedFilesSurface project={PROJECT as never} conversationId="conv-1" onOpenFile={vi.fn()} />,
    );
    expect(asFragment()).toMatchSnapshot('workspace-row');
  });
});
