/**
 * BLOCK-156 — 扩展中心页测试。
 * 钉住：四货签在场与切换 / 旧路由 fail-closed 重定向 / D2 分类学接线到技能货架 /
 * 领域插件货签嵌入 PluginStorePanel（embedded 模式）/ MCP 货签 P1 占位在场。
 * IPC 全 mock（不发真实调用）。
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ── IPC mock：技能发现（含领域+通用两类 category）与插件商店桥 ──────────────
const discoverResult = {
  ok: true,
  skills: [
    {
      id: 'deg-analysis-standard',
      name: 'DEG 标准流程',
      version: '1.0.0',
      description: '差异表达分析标准流程',
      category: 'bioinformatics/ngs',
      source: 'built-in',
      tags: [],
      parameters: { required: [], optional: {} },
      plugins: { required: [], optional: [] },
    },
    {
      id: 'coding-playbook',
      name: '编码 playbook',
      version: '1.0.0',
      description: '通用编码方法论',
      category: 'coding/playbook',
      source: 'built-in',
      tags: [],
      parameters: { required: [], optional: {} },
      plugins: { required: [], optional: [] },
    },
  ],
};

vi.mock('@/lib/desktopBridge', () => ({
  getBridge: (ns: string) => {
    if (ns === 'skills') {
      return {
        discover: vi.fn(async () => discoverResult),
        execute: vi.fn(),
        cancel: vi.fn(),
        getExecution: vi.fn(),
        onProgress: vi.fn(() => () => {}),
      };
    }
    if (ns === 'plugins') {
      return {
        listInstalled: vi.fn(async () => []),
        listRemote: vi.fn(async () => ({ plugins: {} })),
        install: vi.fn(async () => ({ ok: true })),
        uninstall: vi.fn(async () => ({ ok: true })),
        checkUpdates: vi.fn(async () => []),
      };
    }
    if (ns === 'runtime') {
      return { status: vi.fn(async () => null) };
    }
    if (ns === 'packs') {
      return {
        listInstalled: vi.fn(async () => ({ packs: [] })),
        listAvailable: vi.fn(async () => ({ packs: [] })),
        installFromDialog: vi.fn(),
        installPath: vi.fn(),
        uninstallPlan: vi.fn(),
        uninstall: vi.fn(),
        onInstallProgress: vi.fn(() => () => {}),
      };
    }
    throw new Error(`unexpected bridge ns: ${ns}`);
  },
}));

import ExtensionsPage from './index';

// P2 起 MCP 货架走后端 HTTP（useMcpServers）——默认空清单
vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
  status: 'ok', servers: [],
}), { status: 200 })));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/extensions" element={<ExtensionsPage />} />
        <Route
          path="*"
          element={<div data-testid="fallback-route">fallback</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BLOCK-156 扩展中心页', () => {
  it('四货签在场（默认领域插件），切换到通用技能货签', async () => {
    renderAt('/extensions');
    expect(screen.getByTestId('extensions-page')).toBeTruthy();
    for (const label of ['领域插件', '领域技能', '通用技能', 'MCP 服务']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('tab', { name: '通用技能' }));
    await waitFor(() =>
      expect(screen.getByTestId('skill-shelf-general-skills')).toBeTruthy(),
    );
  });

  it('D2 分类学接线：领域技能货架只见 bioinformatics，通用技能货架只见 coding', async () => {
    renderAt('/extensions?tab=domain-skills');
    await waitFor(() =>
      expect(screen.getByTestId('skill-shelf-domain-skills')).toBeTruthy(),
    );
    const domainText = screen.getByTestId('skill-shelf-domain-skills').textContent ?? '';
    expect(domainText).toContain('DEG 标准流程');
    expect(domainText).not.toContain('编码 playbook');

    fireEvent.click(screen.getByRole('tab', { name: '通用技能' }));
    await waitFor(() =>
      expect(screen.getByTestId('skill-shelf-general-skills')).toBeTruthy(),
    );
    const generalText = screen.getByTestId('skill-shelf-general-skills').textContent ?? '';
    expect(generalText).toContain('编码 playbook');
    expect(generalText).not.toContain('DEG 标准流程');
  });

  it('MCP 货签 P2 配置面在场（空态 + 添加入口）', async () => {
    renderAt('/extensions?tab=mcp');
    await waitFor(() => expect(screen.getByTestId('mcp-shelf')).toBeTruthy());
    expect(screen.getByTestId('mcp-empty')).toBeTruthy();
    expect(screen.getByTestId('mcp-add-toggle')).toBeTruthy();
  });

  it('非法 tab 参数 fail-closed 回落领域插件货签', () => {
    renderAt('/extensions?tab=../etc');
    expect(screen.getByRole('tab', { name: '领域插件' }).getAttribute('aria-selected')).toBe('true');
  });

  it('技能货架搜索按名称过滤', async () => {
    renderAt('/extensions?tab=domain-skills');
    await waitFor(() =>
      expect(screen.getByTestId('skill-shelf-domain-skills')).toBeTruthy(),
    );
    fireEvent.change(screen.getByLabelText('搜索领域技能'), {
      target: { value: '不存在的技能' },
    });
    expect(screen.getByText('暂无匹配的领域技能')).toBeTruthy();
  });
});
