import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePanelsProvider } from './WorkspacePanelsContext';
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

  it('maximizes on a blank header double-click but ignores buttons and role=button children', () => {
    const bridge = makeBridge();
    vi.stubGlobal('biof3Desktop', bridge);
    renderTitleBar();
    const header = screen.getByRole('banner');

    fireEvent.doubleClick(header);
    expect(bridge.window.maximize).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(screen.getByRole('button', { name: '最小化窗口' }));
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

    expect(header.style.getPropertyValue('--titlebar-left-span')).toBe('134px');
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
