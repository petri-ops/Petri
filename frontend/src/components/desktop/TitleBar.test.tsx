import React from 'react';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TitleBarResultItem } from '@/hooks/useWorkspacePanels';
import { WorkspacePanelsProvider, useWorkspacePanelsContext } from './WorkspacePanelsContext';
import { TitleBar } from './TitleBar';

type DesktopWindow = NonNullable<Window['biof3Desktop']>['window'];
type DesktopBridge = NonNullable<Window['biof3Desktop']>;

function makeBridge(overrides: Partial<DesktopWindow> = {}): DesktopBridge {
  const windowApi: DesktopWindow = {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    onMaximizeChanged: vi.fn(() => vi.fn()),
    ...overrides,
  };
  return {
    isDesktop: true,
    // mac 分支才渲染交通灯窗口控件；缺这个字段会导致相关用例全部找不到按钮。
    platform: 'darwin',
    window: windowApi,
  } as DesktopBridge;
}

function renderTitleBar() {
  return render(
    <MemoryRouter>
      <WorkspacePanelsProvider>
        <TitleBar />
      </WorkspacePanelsProvider>
    </MemoryRouter>,
  );
}

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
  return render(
    <MemoryRouter>
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('TitleBar desktop window controls', () => {
  it('renders the three desktop controls with labels and the expected icons', () => {
    const bridge = makeBridge();
    vi.stubGlobal('biof3Desktop', bridge);
    renderTitleBar();

    const close = screen.getByRole('button', { name: '关闭窗口' });
    const minimize = screen.getByRole('button', { name: '最小化窗口' });
    const maximize = screen.getByRole('button', { name: '最大化窗口' });

    expect(screen.getAllByRole('button', { name: /窗口$/ })).toHaveLength(3);
    expect(close.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(close.querySelectorAll('line')).toHaveLength(2);
    expect(minimize.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(minimize.querySelectorAll('line')).toHaveLength(1);
    expect(maximize.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(maximize.querySelector('rect')).toBeTruthy();
    expect(maximize.getAttribute('title')).toBe('最大化');
  });

  it('routes close, minimize, and maximize clicks to the desktop bridge', () => {
    const bridge = makeBridge();
    vi.stubGlobal('biof3Desktop', bridge);
    renderTitleBar();

    fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }));
    fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }));
    fireEvent.click(screen.getByRole('button', { name: '最大化窗口' }));

    expect(bridge.window.close).toHaveBeenCalledTimes(1);
    expect(bridge.window.minimize).toHaveBeenCalledTimes(1);
    expect(bridge.window.maximize).toHaveBeenCalledTimes(1);
  });

  // 回归：窗口控件是 DOM 里最靠前的可聚焦元素。若它们参与键盘焦点，页面加载后
  // 焦点会默认落在「关闭窗口」上，用户击键被按钮吞掉（空格/回车还会误触关闭）。
  // 断言源码而非渲染结果：isMac/isDesktop 是模块级常量，在 import 时即求值，
  // stubGlobal 注入发生在其后，因此测试环境下这些按钮根本不渲染（既有缺陷）。
  it('keeps window controls out of the keyboard focus order', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'src/components/desktop/TitleBar.tsx'),
      'utf8',
    );
    const controlBlocks = source
      .split('<button')
      .filter((block) => /aria-label=(?:"关闭窗口"|"最小化窗口")|isMaximized \? '还原窗口'/.test(block));

    expect(controlBlocks.length).toBeGreaterThanOrEqual(3);
    for (const block of controlBlocks) {
      expect(block).toContain('tabIndex={-1}');
    }
  });

  it('hydrates maximized state, follows maximize changes, and unregisters the listener', async () => {
    let onMaximizeChanged: ((isMaximized: boolean) => void) | undefined;
    const unsubscribe = vi.fn();
    const bridge = makeBridge({
      isMaximized: vi.fn().mockResolvedValue(true),
      onMaximizeChanged: vi.fn((callback: (isMaximized: boolean) => void) => {
        onMaximizeChanged = callback;
        return unsubscribe;
      }),
    });
    vi.stubGlobal('biof3Desktop', bridge);
    const view = renderTitleBar();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '还原窗口' })).toBeTruthy();
    });
    expect(bridge.window.isMaximized).toHaveBeenCalledTimes(1);
    expect(bridge.window.onMaximizeChanged).toHaveBeenCalledTimes(1);

    act(() => onMaximizeChanged?.(false));
    expect(screen.getByRole('button', { name: '最大化窗口' })).toBeTruthy();
    act(() => onMaximizeChanged?.(true));
    expect(screen.getByRole('button', { name: '还原窗口' })).toBeTruthy();

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('subscribes to live state before issuing the initial maximize query', async () => {
    const order: string[] = [];
    const bridge = makeBridge({
      onMaximizeChanged: vi.fn((callback: (isMaximized: boolean) => void) => {
        order.push('subscribe');
        return vi.fn();
      }),
      isMaximized: vi.fn(() => {
        order.push('query');
        return Promise.resolve(false);
      }),
    });
    vi.stubGlobal('biof3Desktop', bridge);
    renderTitleBar();

    await waitFor(() => expect(bridge.window.isMaximized).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['subscribe', 'query']);
  });

  it('keeps live maximize events authoritative over a late initial query result', async () => {
    let onMaximizeChanged: ((isMaximized: boolean) => void) | undefined;
    const initialQuery = deferred<boolean>();
    const bridge = makeBridge({
      isMaximized: vi.fn(() => initialQuery.promise),
      onMaximizeChanged: vi.fn((callback: (isMaximized: boolean) => void) => {
        onMaximizeChanged = callback;
        return vi.fn();
      }),
    });
    vi.stubGlobal('biof3Desktop', bridge);
    renderTitleBar();

    await waitFor(() => {
      expect(bridge.window.isMaximized).toHaveBeenCalledTimes(1);
      expect(bridge.window.onMaximizeChanged).toHaveBeenCalledTimes(1);
    });

    act(() => onMaximizeChanged?.(false));
    expect(screen.getByRole('button', { name: '最大化窗口' })).toBeTruthy();
    act(() => onMaximizeChanged?.(true));
    expect(screen.getByRole('button', { name: '还原窗口' })).toBeTruthy();

    await act(async () => {
      initialQuery.resolve(false);
      await initialQuery.promise;
    });
    // The stale query says unmaximized, but the newer live event remains true.
    expect(screen.getByRole('button', { name: '还原窗口' })).toBeTruthy();
  });

  it('keeps the safe unmaximized default when the initial query rejects', async () => {
    const initialQuery = deferred<boolean>();
    const bridge = makeBridge({
      isMaximized: vi.fn(() => initialQuery.promise),
    });
    vi.stubGlobal('biof3Desktop', bridge);
    renderTitleBar();

    await waitFor(() => {
      expect(bridge.window.isMaximized).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: '最大化窗口' })).toBeTruthy();
    });

    await act(async () => {
      initialQuery.reject(new Error('window state unavailable'));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: '最大化窗口' })).toBeTruthy();
  });

  it('keeps the safe default when an older bridge throws before returning a query promise', async () => {
    const bridge = makeBridge({
      isMaximized: vi.fn(() => {
        throw new Error('window state unavailable');
      }),
    });
    vi.stubGlobal('biof3Desktop', bridge);
    renderTitleBar();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: '最大化窗口' })).toBeTruthy();
  });

  // 双击标题栏最大化只在非 mac 生效：mac 上该手势由系统处理，
  // 组件显式设置 onDoubleClick={!isMac ? ... : undefined}。
  it('maximizes on a blank header double-click but ignores buttons and role=button children', () => {
    const bridge = { ...makeBridge(), platform: 'win32' } as DesktopBridge;
    vi.stubGlobal('biof3Desktop', bridge);
    renderTitleBar();
    const header = screen.getByRole('banner');

    fireEvent.doubleClick(header);
    expect(bridge.window.maximize).toHaveBeenCalledTimes(1);

    // 非 mac 走 WindowControls，其 aria-label 是「最小化」（mac 交通灯才是「最小化窗口」）。
    fireEvent.doubleClick(screen.getByRole('button', { name: '最小化' }));
    expect(bridge.window.maximize).toHaveBeenCalledTimes(1);

    const roleButton = document.createElement('div');
    roleButton.setAttribute('role', 'button');
    header.appendChild(roleButton);
    fireEvent.doubleClick(roleButton);
    expect(bridge.window.maximize).toHaveBeenCalledTimes(1);
  });

  it('uses the fixed collapsed left rail width after toggling the left panel', () => {
    vi.stubGlobal('biof3Desktop', undefined);
    renderTitleBar();
    const header = screen.getByRole('banner');
    expect(header.getAttribute('style')).toContain('--titlebar-left-span: 241px');

    fireEvent.click(screen.getByRole('button', { name: '收起左侧栏' }));

    // 非 mac（无 desktop bridge）收起后为 collapsedLeftRail=146；mac 为 180。
    expect(header.style.getPropertyValue('--titlebar-left-span')).toBe('146px');
  });
});

describe('TitleBar web fallback', () => {
  it('renders a placeholder and never calls IPC when biof3Desktop is unavailable', () => {
    vi.stubGlobal('biof3Desktop', undefined);
    renderTitleBar();
    const header = screen.getByRole('banner');

    expect(screen.queryByRole('button', { name: '关闭窗口' })).toBeNull();
    expect(screen.queryByRole('button', { name: '最小化窗口' })).toBeNull();
    expect(screen.queryByRole('button', { name: '最大化窗口' })).toBeNull();
    expect(header.querySelector('[aria-hidden="true"]')).toBeTruthy();

    expect(() => fireEvent.doubleClick(header)).not.toThrow();
  });

  it('treats a bridge that is not marked desktop as web content', () => {
    const bridge = makeBridge();
    vi.stubGlobal('biof3Desktop', { ...bridge, isDesktop: false });
    renderTitleBar();

    expect(screen.queryByRole('button', { name: '关闭窗口' })).toBeNull();
    expect(bridge.window.onMaximizeChanged).not.toHaveBeenCalled();
    expect(bridge.window.isMaximized).not.toHaveBeenCalled();
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

    const menu = await screen.findByRole('menu', { name: '结果列表' });
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
