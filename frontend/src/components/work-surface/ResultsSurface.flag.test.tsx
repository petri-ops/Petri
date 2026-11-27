// item 90 HK-01 前端钉——resultStudio flag off 时结果面/证据面出「已下架」诚实态，零 RS 数据拉取；
// on 时正常渲染（既有行为不回归）。
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ enabled: false, fetchUrls: [] as string[] }));

vi.mock('@/lib/resultStudioFlag', () => ({
  useResultStudioEnabled: () => state.enabled,
}));

vi.mock('@/lib/env', () => ({
  getApiPrefix: () => 'http://localhost:3001/api',
}));

// 捕获 RS 链路的数据拉取（flag off 时不得发生）
vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
  state.fetchUrls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : '[request]');
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
}));

import { ResultsSurface } from './ResultsSurface';
import { EvidenceSurface } from './EvidenceSurface';

const CTX = {
  project: { id: 'p1', name: 'P', workspacePath: '/w', workspaceKind: 'local' },
  projectId: 'p1',
  conversationId: 'conv-1',
  activeJob: null,
  activeWorkflow: null,
  activeArtifact: null,
  setActiveArtifact: () => undefined,
  jobs: [],
  packResultSurfaces: [],
  resultContext: null,
  resultEditControls: null,
  resultEditSubmitting: false,
  resultAgentDraft: '',
  setResultAgentDraft: () => undefined,
  onResultEditSubmit: () => false,
  pendingArtifactName: null,
  onPendingArtifactConsumed: () => undefined,
  onWorkflowChanged: () => undefined,
  handleAskAgent: () => false,
  handleOpenResult: () => false,
  openRevisionWorkspaceFile: () => undefined,
  openResultBrowser: () => undefined,
} as never;

afterEach(() => {
  cleanup();
  state.enabled = false;
  state.fetchUrls = [];
  vi.clearAllMocks();
});

describe('resultStudio flag off（item 90 阶段一）', () => {
  it('HK-90-5：结果面渲染「已下架」诚实态，零 RS 数据拉取', () => {
    render(<ResultsSurface ctx={CTX} active />);
    expect(screen.getByTestId('results-surface-off')).toBeTruthy();
    expect(screen.queryByTestId('results-library')).toBeNull();
    expect(state.fetchUrls.filter((url) => url.includes('/api/result-studio')).length).toBe(0);
  });

  it('HK-90-6：证据面同 flag 语义', () => {
    render(<EvidenceSurface
      activeJob={null}
      activeWorkflow={null}
      activeArtifact={null}
      conversationId="conv-1"
      onOpenResults={() => undefined}
      onOpenReview={() => undefined}
      onOpenPlan={() => undefined}
    />);
    expect(screen.getByTestId('evidence-surface-off')).toBeTruthy();
  });

  it('HK-90-7：flag on 时正常渲染（可逆），无 off 态残留', async () => {
    state.enabled = true;
    render(<ResultsSurface ctx={CTX} active />);
    expect(screen.queryByTestId('results-surface-off')).toBeNull();
    await waitFor(() => {
      expect(document.querySelector('[data-result-mode]')).toBeTruthy();
    });
  });
});
