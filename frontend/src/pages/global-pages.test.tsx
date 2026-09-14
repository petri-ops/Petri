// BLOCK-72 / UI-320 — 全局工作台页冒烟：/knowledge 渲染知识面板壳。
// UI-366 — /backend 页退役（诊断并入设置「运行时与诊断」分区），后端冒烟一并移除。
// IPC 全 mock（不发真实调用）。

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import KnowledgePage from './knowledge';

afterEach(() => {
  cleanup();
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
});
