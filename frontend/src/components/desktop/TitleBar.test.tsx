import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TitleBarResultItem } from '@/hooks/useWorkspacePanels';
import { WorkspacePanelsProvider, useWorkspacePanelsContext } from './WorkspacePanelsContext';
import { TitleBar } from './TitleBar';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function ResultStateHarness({
  resultItems,
  activeResultId,
  onSelectResult,
}: {
  resultItems: TitleBarResultItem[];
  activeResultId: string | null;
  onSelectResult: ((id: string) => void) | null;
}) {
  const { updateTitleBar } = useWorkspacePanelsContext();

  React.useEffect(() => {
    updateTitleBar({ resultItems, activeResultId, onSelectResult });
  }, [activeResultId, onSelectResult, resultItems, updateTitleBar]);

  return null;
}

function renderTitleBarWithResults(
  resultItems: TitleBarResultItem[],
  activeResultId: string | null,
  onSelectResult: (id: string) => void,
) {
  // UI-376 — 结果选择器是工作区语境（欢迎页已 bare），渲染在工作区路由
  return render(
    <MemoryRouter initialEntries={['/project/p1/chat']}>
      <WorkspacePanelsProvider>
        <ResultStateHarness
          resultItems={resultItems}
          activeResultId={activeResultId}
          onSelectResult={onSelectResult}
        />
        <TitleBar />
      </WorkspacePanelsProvider>
    </MemoryRouter>,
  );
}

describe('TitleBar workspace-context windowTools (UI-359)', () => {
  function renderAt(initialPath: string) {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <WorkspacePanelsProvider>
          <TitleBar />
        </WorkspacePanelsProvider>
      </MemoryRouter>,
    );
  }

  it('hides bottom-terminal and right-panel toggles on non-workspace routes', () => {
    vi.stubGlobal('petriDesktop', undefined);
    renderAt('/');

    // 非工作区路由没有右栏/底部终端，渲染死开关只会产生「点了没反应」。
    expect(screen.queryByRole('button', { name: '展开右侧栏' })).toBeNull();
    expect(screen.queryByRole('button', { name: '收起右侧栏' })).toBeNull();
    expect(screen.queryByRole('button', { name: '展开底部终端' })).toBeNull();
    expect(screen.queryByRole('button', { name: '收起底部终端' })).toBeNull();
  });

  it('keeps the toggles on workspace routes with shortcut hints in titles', () => {
    vi.stubGlobal('petriDesktop', undefined);
    renderAt('/project/p1/chat');

    // 桌面默认 rightOpen=true → 右侧栏按钮呈「收起」态；终端默认收起 → 「展开」态。
    const rightToggle = screen.getByRole('button', { name: '收起右侧栏' });
    expect(rightToggle.getAttribute('title')).toContain('Ctrl+Shift+B');
    const terminalToggle = screen.getByRole('button', { name: '展开底部终端' });
    expect(terminalToggle.getAttribute('title')).toContain('Ctrl+`');
  });

  it('hides the toggles on the standalone Result Studio route', () => {
    vi.stubGlobal('petriDesktop', undefined);
    renderAt('/project/p1/results');

    expect(screen.queryByRole('button', { name: '收起右侧栏' })).toBeNull();
    expect(screen.queryByRole('button', { name: '展开底部终端' })).toBeNull();
  });

  // UI-360 — 摘要卡只在 chat / scheduled 模式存在，欢迎页/独立工作面不开关。
  it('hides the summary toggle on the welcome page', () => {
    vi.stubGlobal('petriDesktop', undefined);
    renderAt('/');

    expect(screen.queryByRole('button', { name: '展开摘要概览' })).toBeNull();
    expect(screen.queryByRole('button', { name: '收起摘要概览' })).toBeNull();
  });

  it('keeps the summary toggle on chat-mode workspace routes', () => {
    vi.stubGlobal('petriDesktop', undefined);
    renderAt('/project/p1/chat');

    expect(screen.getByRole('button', { name: '展开摘要概览' })).toBeTruthy();
  });

  // UI-364/365 — plugins / settings 模式均退役（独立页化 /plugins /settings）：
  // 历史深链 /project/:id/{plugins,settings} fail-closed 回 chat（UI-347 search 先例），
  // 工作区 chrome 全量在场（模式裁剪随模式退役一并消失）。
  it('treats legacy plugins and settings deep links as chat', () => {
    vi.stubGlobal('petriDesktop', undefined);
    const { unmount } = renderAt('/project/p1/plugins');

    expect(screen.getByRole('button', { name: '收起右侧栏' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '展开摘要概览' })).toBeTruthy();

    unmount();
    renderAt('/project/p1/settings');

    expect(screen.getByRole('button', { name: '收起右侧栏' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '展开摘要概览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '展开底部终端' })).toBeTruthy();
  });

});

describe('TitleBar result selector', () => {
  const resultItems: TitleBarResultItem[] = [
    { id: 'result-a', label: '差异表达', status: 'done' },
    { id: 'result-b', label: '火山图', status: 'running' },
  ];

  it('does not render a selector for an empty list', () => {
    renderTitleBarWithResults([], null, vi.fn());

    expect(screen.queryByRole('button', { name: /^结果 \d+$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '展开结果列表' })).toBeNull();
  });

  it('selects the only result from the primary button without opening a menu', async () => {
    const onSelectResult = vi.fn();
    renderTitleBarWithResults([resultItems[0]], 'missing', onSelectResult);

    expect(screen.queryByRole('button', { name: '展开结果列表' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: '结果 1' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '结果 1' }));
    expect(onSelectResult).toHaveBeenCalledWith('result-a');
  });

  it('shows only passed results, marks the active one, and supports keyboard and overlay dismissal', async () => {
    const onSelectResult = vi.fn();
    renderTitleBarWithResults(resultItems, 'result-b', onSelectResult);

    await waitFor(() => expect(screen.getByRole('button', { name: '结果 2' })).toBeTruthy());
    const menuTrigger = screen.getByRole('button', { name: '展开结果列表' });
    fireEvent.keyDown(menuTrigger, { key: 'ArrowDown' });

    await screen.findByRole('menu', { name: '结果列表' });
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems).toHaveLength(2);
    expect(menuItems[0].textContent).toContain('差异表达');
    expect(menuItems[1].textContent).toContain('火山图');
    expect(menuItems[1].getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(menuItems[1]);

    fireEvent.keyDown(menuItems[1], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(menuItems[0]);
    fireEvent.keyDown(menuItems[0], { key: 'Enter' });
    expect(onSelectResult).toHaveBeenCalledWith('result-a');
    expect(screen.queryByRole('menu', { name: '结果列表' })).toBeNull();

    fireEvent.click(menuTrigger);
    await screen.findByRole('menu', { name: '结果列表' });
    fireEvent.keyDown(screen.getByRole('menu', { name: '结果列表' }), { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '结果列表' })).toBeNull();

    fireEvent.click(menuTrigger);
    await screen.findByRole('menu', { name: '结果列表' });
    fireEvent.click(screen.getByRole('button', { name: '关闭结果菜单' }));
    expect(screen.queryByRole('menu', { name: '结果列表' })).toBeNull();
    expect(document.activeElement).toBe(menuTrigger);

    fireEvent.click(menuTrigger);
    await screen.findByRole('menu', { name: '结果列表' });
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('menu', { name: '结果列表' })).toBeNull();
  });
});

describe('TitleBar route-aware dividers (UI-377)', () => {
  function renderAt(initialPath: string) {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <WorkspacePanelsProvider>
          <TitleBar />
        </WorkspacePanelsProvider>
      </MemoryRouter>,
    );
  }

  it('welcome route goes fully bare: no brand title, no zone dividers (UI-376)', () => {
    vi.stubGlobal('petriDesktop', undefined);
    renderAt('/');
    // UI-376 — 欢迎页并入独立页 bare 形态：品牌回退标题（「Petri」）与左区
    // 分隔线都不渲染（页面自带「返回 + 问候」页头）
    const center = document.querySelector('[class*="centerTitle"]') as HTMLElement;
    expect(center).toBeTruthy();
    expect(center.className).toContain('centerTitleBare');
    expect(center.textContent).not.toContain('Petri');
    const left = document.querySelector('[class*="leftZone"]') as HTMLElement;
    expect(left.className).toContain('leftZoneBare');
    // 左栏开合按钮保留（bare 只撤边框与标题）
    expect(screen.getByRole('button', { name: '收起左侧栏' })).toBeTruthy();
  });

  it('keeps the center-title right divider on workspace routes with the right rail open', () => {
    vi.stubGlobal('petriDesktop', undefined);
    renderAt('/project/p1/chat');
    const center = document.querySelector('[class*="centerTitle"]') as HTMLElement;
    expect(center).toBeTruthy();
    // 桌面默认 rightOpen=true → 工作区右栏在场 → 分隔线保留
    expect(center.className).not.toContain('centerTitleNoDivider');
  });

});
