/**
 * nso-w3-a11y.test.tsx — BLOCK-369（NSO-W3 F-18）可达性契约。
 *
 * ①CenterPanel 非 chat 投影层 inert（键盘不可进入不可见层，修复前仅 aria-hidden）；
 * ②ExternalImportPanel 表单语义：fieldset/legend、label 关联、对象补丁不再 [object Object]、回执 role=status。
 * （项目树 tree/treeitem 语义由 LeftPanel 契约与既有渲染路径覆盖，实机腿归 W3 视觉验收。）
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CenterPanel, type CenterPanelContext, type CenterPanelRefs } from '../components/workspace-panels/CenterPanel';
import { ExternalImportPanel } from '../components/settings/ExternalImportPanel';

vi.mock('@/components/copilot/SimpleChat', () => ({
  SimpleChat: () => <div data-testid="persistent-chat">Agent conversation</div>,
}));
vi.mock('@/components/copilot/conversationRunStore', () => ({
  useConversationRun: () => null,
  useConversationTodoList: () => [],
  useConversationCitations: () => [],
  isConversationRunning: () => false,
}));
vi.mock('@/hooks/useDurableConversationLoop', () => ({
  useDurableConversationLoop: () => ({ loop: null, summary: null }),
}));
vi.mock('@/components/workspace-panels/WorkspaceSummaryCard', () => ({ WorkspaceSummaryCard: () => <div>summary</div> }));
vi.mock('@/components/workspace-panels/ScheduledWorkspacePanel', () => ({ ScheduledWorkspacePanel: () => <div>task</div> }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function context(mode: CenterPanelContext['workspaceMode']): CenterPanelContext {
  return {
    project: { id: 'project-1', name: 'Project One' },
    projectId: 'project-1',
    activeConvId: 'conversation-1', conversations: [],
    workspaceMode: mode,
    showPinnedSummary: mode === 'chat' || mode === 'scheduled',
    bottomTerminalOpen: false, bottomTerminalHeight: 0, inputHeight: 120,
    summaryCardOpen: false, summaryVisibility: 'hidden', summaryOpenWidth: 0,
    activeJob: null, activeWorkflow: null, recentJobs: [], liveJobsPreview: [],
    jobStats: { running: 0, failed: 0, done: 0, pending: 0 }, backendStatus: {} as CenterPanelContext['backendStatus'],
    datasets: [],
    updateWorkspaceMode: vi.fn(), openRightPanel: vi.fn(),
    handleSwitchConversation: vi.fn(), setActiveConvId: vi.fn(), setActiveJobId: vi.fn(),
    openScheduledResults: vi.fn(),
  } as unknown as CenterPanelContext;
}

const refs: CenterPanelRefs = { centerColRef: { current: null }, sessionFrameRef: { current: null } };

describe('W3-F18 CenterPanel 隐藏投影层 inert', () => {
  it('scheduled 模式：conversation 投影层 aria-hidden 且带 inert 属性（键盘不可进入）', () => {
    render(<CenterPanel ctx={context('scheduled')} refs={refs} />);
    const layer = document.querySelector('[data-projection="conversation"]');
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
    expect(layer?.hasAttribute('inert')).toBe(true);
  });

  it('chat 模式：投影层活跃，无 inert', () => {
    render(<CenterPanel ctx={context('chat')} refs={refs} />);
    const layer = document.querySelector('[data-projection="conversation"]');
    expect(layer?.getAttribute('aria-hidden')).toBe('false');
    expect(layer?.hasAttribute('inert')).toBe(false);
  });
});

describe('W3-F18 ExternalImportPanel 表单语义', () => {
  function mockPreview(patch: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/preview')) return { status: 200, ok: true, json: async () => ({ ok: true, patch, credentialsDetected: [], unsupported: [] }) } as unknown as Response;
      return { status: 200, ok: true, json: async () => ({ status: 'ok' }) } as unknown as Response;
    }));
  }

  it('fieldset/legend 存在；textarea 有可关联 label；对象补丁渲染为 JSON 而非 [object Object]', async () => {
    mockPreview({ model: { temperature: 0.2 } });
    render(<ExternalImportPanel apiBase="http://mock/api" />);
    expect(document.querySelector('fieldset[aria-label="选择配置来源"], fieldset')).not.toBeNull();
    expect(screen.getByText('选择配置来源')).toBeTruthy();
    expect(document.getElementById('external-import-content')).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/粘贴配置内容/), { target: { value: 'x = 1' } });
    fireEvent.click(screen.getByRole('button', { name: /预览/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-preview]')).toBeTruthy());
    expect(screen.queryByText((_, el) => el?.textContent === '[object Object]')).toBeNull();
    expect(screen.getByText(/{"temperature":0.2}/)).toBeTruthy();
  });

  it('回滚回执 live region：走 apply+rollback 链后 message 节点带 role=status aria-live=polite', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/preview')) return { status: 200, ok: true, json: async () => ({ ok: true, patch: { k: 'v' }, credentialsDetected: [], unsupported: [] }) } as unknown as Response;
      if (url.includes('/rollback')) return { status: 200, ok: true, json: async () => ({ status: 'ok', restored: ['k'] }) } as unknown as Response;
      return { status: 200, ok: true, json: async () => ({ status: 'ok', appliedKeys: ['k'], applyId: 'imp-1', rollbackAvailable: true }) } as unknown as Response;
    }));
    render(<ExternalImportPanel apiBase="http://mock/api" />);
    fireEvent.change(screen.getByPlaceholderText(/粘贴配置内容/), { target: { value: 'x = 1' } });
    fireEvent.click(screen.getByRole('button', { name: /预览/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-preview]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /应用所选/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-confirm]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /确认应用/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-applied]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /回滚这次导入/ }));
    await waitFor(() => expect(document.querySelector('[data-external-import-message]')).toBeTruthy());
    const msg = document.querySelector('[data-external-import-message]');
    expect(msg?.getAttribute('role')).toBe('status');
    expect(msg?.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText(/已回滚/)).toBeTruthy();
  });
});
