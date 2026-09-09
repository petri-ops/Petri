// BLOCK-72 / UI-320 — 全局工作台页冒烟：/knowledge 渲染知识面板壳；/backend 渲染后端进程面。
// IPC 全 mock（不发真实调用）。

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BackendStatusProvider } from '@/components/backend/BackendStatusProvider';
import KnowledgePage from './knowledge';
import BackendPage from './backend';

function mockDesktopIpc() {
  const bridge = {
    terminal: {
      snapshot: vi.fn(async () => ({
        ok: true,
        processes: [
          { id: 'biof3-server', label: 'biof3-server', command: 'node server.js', status: 'running', pid: 123, output: 'ok' },
        ],
      })),
      openLogDir: vi.fn(async () => ({ ok: true })),
      openShell: vi.fn(async () => ({ ok: true })),
    },
    files: { openPath: vi.fn(async () => ({ ok: true })) },
  };
  (window as unknown as Record<string, unknown>).biof3Desktop = bridge;
  return bridge;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).biof3Desktop;
  vi.unstubAllGlobals();
});

describe('BLOCK-72 全局工作台页', () => {
  it('/knowledge 渲染知识空间管理面（标题 + 面板测试锚点）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'ok',
      space: { id: 'ks_default', name: '默认知识空间', enabled: false, embeddingModel: 'text-embedding-v3' },
      documents: [],
      embeddingAvailable: false,
      knowledgeDir: '/tmp/knowledge',
      queueDepth: 0,
    }), { status: 200 })));
    render(<MemoryRouter initialEntries={['/knowledge']}><KnowledgePage /></MemoryRouter>);
    expect(screen.getByTestId('knowledge-page')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('knowledge-panel')).toBeTruthy());
    expect(screen.getByText('知识空间')).toBeTruthy();
  });

  it('/backend 渲染后端进程观测面（无项目上下文：全局态回退）', async () => {
    mockDesktopIpc();
    render(
      <MemoryRouter initialEntries={['/backend']}>
        <BackendStatusProvider>
          <BackendPage />
        </BackendStatusProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('backend-page')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('后端').length).toBeGreaterThanOrEqual(1));
    // 无 project ctx：meta 行显示全局回退（不再是「当前项目」）
    await waitFor(() => expect(screen.getByText(/全局 · 数据根目录/)).toBeTruthy());
    // 进程清单来自 terminal.snapshot mock
    await waitFor(() => expect(screen.getByText(/biof3-server/)).toBeTruthy());
  });
});
