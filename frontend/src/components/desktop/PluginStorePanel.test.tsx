/**
 * BLOCK-86 P2 (UI-374) — 插件商店领域包改版组件测试。
 *
 * 门禁对账（plan §5.2）：pack 卡片运行时子项 / 进度 / 确认弹层三档 /
 * 提示条件（含「无包不提示」负例）+ 运行时分类收编 + 来源包标注。
 * usePluginStore 与 desktopBridge 全量 mock——本组件全部数据面都走桥。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  onInstallProgressSpy,
  emitInstallProgress,
} = vi.hoisted(() => ({
  onInstallProgressSpy: vi.fn(),
  emitInstallProgress: vi.fn(),
}));

const mockUsePluginStore = vi.hoisted(() => vi.fn());
const mockGetBridge = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/usePluginStore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usePluginStore: (args?: unknown) => mockUsePluginStore(args),
  };
});
vi.mock('@/lib/desktopBridge', () => ({
  getBridge: (name: string) => mockGetBridge(name),
}));

import { PluginStorePanel } from './PluginStorePanel';

const baseHook = {
  installed: [] as Array<{ id: string; manifestDrift?: boolean }>,
  remote: { plugins: {
    'biof3-r-runtime': { id: 'biof3-r-runtime', title: 'R 运行时（基础环境）', type: 'runtime', size: 657224393 },
  } },
  runtimeStatus: { r: { installed: false }, python: { installed: false } },
  updates: [] as Array<{ id: string; latestVersion: string }>,
  checkingUpdates: false,
  install: vi.fn(async () => ({ ok: true })),
  uninstall: vi.fn(async () => ({ ok: true })),
  checkUpdates: vi.fn(async () => []),
};

const packBridge = {
  listInstalled: vi.fn(),
  listAvailable: vi.fn(),
  installFromDialog: vi.fn(),
  installPath: vi.fn(),
  uninstallPlan: vi.fn(),
  uninstall: vi.fn(),
  onInstallProgress: onInstallProgressSpy.mockImplementation((cb: (p: unknown) => void) => {
    emitInstallProgress.mockImplementation((payload: unknown) => cb(payload));
    return () => {};
  }),
};

const packBio = {
  packId: 'gewu-pack-bio',
  name: '格物 · 生信分析包',
  version: '0.1.0',
  description: '生信垂直领域包',
  packRoot: '/somewhere/gewu-pack-bio',
  installed: true,
  requiresRuntimes: [
    { pluginId: 'biof3-r-runtime', version: '>=1.0.0' },
  ],
  contents: {
    pluginCount: 2,
    plugins: [
      { id: 'deseq2', language: 'r', version: '1.0.0' },
      { id: 'celltypist', language: 'python', version: '1.0.0' },
    ],
    pluginIds: ['deseq2', 'celltypist'],
    scriptCount: 15,
    demoDataCount: 6,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUsePluginStore.mockReturnValue({ ...baseHook });
  mockGetBridge.mockImplementation((name: string) => (name === 'packs' ? packBridge : null));
  packBridge.listInstalled.mockResolvedValue({ ok: true, packs: [packBio] });
  packBridge.listAvailable.mockResolvedValue({ ok: true, packs: [packBio] });
  packBridge.uninstallPlan.mockResolvedValue({
    ok: true,
    runtimes: {
      removable: [{ pluginId: 'biof3-r-runtime', installed: true, sizeBytes: 657224393 }],
      retained: [],
    },
    packSource: { dir: '/somewhere/gewu-pack-bio', exists: true, sizeBytes: 1024 * 1024 * 40 },
    userDataPolicy: 'results、项目文件与数据库不受影响',
  });
  packBridge.uninstall.mockResolvedValue({
    ok: true,
    removed: { record: true, runtimes: [{ pluginId: 'biof3-r-runtime', ok: true }] },
    kept: { packSourceDir: '/somewhere/gewu-pack-bio', userDataPolicy: 'results、项目文件与数据库不受影响' },
    requiresRestart: true,
  });
});

afterEach(() => {
  cleanup();
});

function renderStore() {
  return render(<PluginStorePanel onClose={() => {}} />);
}

describe('PluginStorePanel 领域包改版 (UI-374)', () => {
  it('运行时分类收编：侧栏不再有独立「运行时」入口', async () => {
    renderStore();
    await waitFor(() => expect(screen.getByTestId('domain-packs-section')).toBeTruthy());
    expect(screen.queryByText('运行时')).toBeNull();
  });

  it('包卡片展开：运行时子项随契约渲染，包已装而运行时缺失标「必需 · 缺失」+ 补装按钮', async () => {
    renderStore();
    await waitFor(() => expect(screen.getByTestId('domain-pack-gewu-pack-bio')).toBeTruthy());
    // 展开前子项不可见
    expect(screen.queryByTestId('pack-runtimes-gewu-pack-bio')).toBeNull();
    fireEvent.click(screen.getByLabelText('展开 格物 · 生信分析包 详情'));
    const sub = screen.getByTestId('pack-runtimes-gewu-pack-bio');
    expect(sub.textContent).toContain('R 运行时');
    expect(sub.textContent).toContain('必需 · 缺失');
    expect(sub.textContent).toContain('约 627MB');
    expect(screen.getByText('补装')).toBeTruthy();
  });

  it('包安装的运行时进度：pack:install-progress 事件驱动进度条', async () => {
    renderStore();
    await waitFor(() => expect(screen.getByTestId('domain-pack-gewu-pack-bio')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('展开 格物 · 生信分析包 详情'));
    expect(onInstallProgressSpy).toHaveBeenCalled();
    act(() => {
      emitInstallProgress({ pluginId: 'biof3-r-runtime', progress: { ratio: 0.5, received: 328612196, total: 657224393 } });
    });
    expect(screen.getByTestId('pack-runtimes-gewu-pack-bio').textContent).toContain('50%');
  });

  it('卸载三档确认弹层：预览运行时回收体积/包源默认保留，执行时显式传勾选项', async () => {
    renderStore();
    await waitFor(() => expect(screen.getByTestId('domain-pack-gewu-pack-bio')).toBeTruthy());
    fireEvent.click(screen.getByText('卸载'));
    const dialog = await screen.findByTestId('pack-uninstall-confirm');
    expect(dialog.textContent).toContain('约回收 627MB');
    expect(dialog.textContent).toContain('包源目录');
    expect(dialog.textContent).toContain('results、项目文件与数据库不受影响');
    // 缺省勾选：运行时删 / 包源保留
    fireEvent.click(screen.getByTestId('pack-uninstall-confirm-execute'));
    await waitFor(() => expect(packBridge.uninstall).toHaveBeenCalled());
    expect(packBridge.uninstall).toHaveBeenCalledWith('gewu-pack-bio', { deleteRuntimes: true, deletePackSource: false });
  });

  it('卸载弹层：取消勾选运行时后执行 → deleteRuntimes=false（契约不声明/不勾选绝不触碰运行时）', async () => {
    renderStore();
    await waitFor(() => expect(screen.getByTestId('domain-pack-gewu-pack-bio')).toBeTruthy());
    fireEvent.click(screen.getByText('卸载'));
    await screen.findByTestId('pack-uninstall-confirm');
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // 取消「删除运行时」
    fireEvent.click(screen.getByTestId('pack-uninstall-confirm-execute'));
    await waitFor(() => expect(packBridge.uninstall).toHaveBeenCalled());
    expect(packBridge.uninstall).toHaveBeenCalledWith('gewu-pack-bio', { deleteRuntimes: false, deletePackSource: false });
  });

  it('缺失提示领域感知正例：包已装且运行时缺失 → 提示出现并挂包名', async () => {
    renderStore();
    await waitFor(() => expect(screen.getByTestId('domain-packs-section')).toBeTruthy());
    const hint = screen.getByText(/需要.*R.*运行时/);
    expect(hint.textContent).toContain('格物 · 生信分析包');
  });

  it('缺失提示负例：无已装包（或包未声明运行时）→ 无包不提运行时', async () => {
    packBridge.listInstalled.mockResolvedValue({ ok: true, packs: [] });
    renderStore();
    await waitFor(() => expect(screen.getByTestId('domain-packs-section')).toBeTruthy());
    expect(screen.queryByText(/需要.*运行时/)).toBeNull();
  });

  it('包交付插件在商店可见并标注来源包（分析工具分类同样可见）', async () => {
    renderStore();
    await waitFor(() => expect(screen.getByTestId('pack-delivered-plugins')).toBeTruthy());
    const section = screen.getByTestId('pack-delivered-plugins');
    expect(section.textContent).toContain('deseq2');
    expect(section.textContent).toContain('来源包：格物 · 生信分析包');
    // 分析工具分类下同样可见
    fireEvent.click(screen.getByText('分析工具'));
    await waitFor(() => expect(screen.getByTestId('pack-delivered-plugins')).toBeTruthy());
  });

  it('模块清单行：包卡片折叠态显示 分析插件/脚本/演示数据 计数', async () => {
    renderStore();
    await waitFor(() => expect(screen.getByTestId('domain-pack-gewu-pack-bio')).toBeTruthy());
    const card = screen.getByTestId('domain-pack-gewu-pack-bio');
    expect(card.textContent).toContain('2 个分析插件');
    expect(card.textContent).toContain('15 个脚本模块');
    expect(card.textContent).toContain('6 个演示数据集');
  });
});
