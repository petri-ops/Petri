import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ToastProvider, useToast } from './ToastProvider';

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useToast>) => void }) {
  onReady(useToast());
  return null;
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('throws when useToast is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Harness onReady={() => undefined} />)).toThrow(
      /useToast must be used inside ToastProvider/,
    );
    spy.mockRestore();
  });

  it('shows a toast when show() is called and auto-dismisses after the default duration', () => {
    let api!: ReturnType<typeof useToast>;
    render(
      <ToastProvider>
        <Harness onReady={(a) => { api = a; }} />
      </ToastProvider>,
    );

    act(() => {
      api.show({ message: 'Analysis saved', variant: 'success' });
    });
    expect(screen.queryByText('Analysis saved')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('Analysis saved')).toBeNull();
  });

  it('supports sticky toasts (duration <= 0) that do not auto-dismiss', () => {
    let api!: ReturnType<typeof useToast>;
    render(
      <ToastProvider>
        <Harness onReady={(a) => { api = a; }} />
      </ToastProvider>,
    );

    act(() => {
      api.show({ message: 'Pinned notice', variant: 'info', duration: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByText('Pinned notice')).not.toBeNull();
  });

  it('renders an error toast inside an assertive live region', () => {
    let api!: ReturnType<typeof useToast>;
    render(
      <ToastProvider>
        <Harness onReady={(a) => { api = a; }} />
      </ToastProvider>,
    );

    act(() => {
      api.error('Runtime failed to start');
    });
    const region = screen.getByText('Runtime failed to start').closest('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('assertive');
  });

  it('removes a toast immediately when its dismiss button is clicked', () => {
    let api!: ReturnType<typeof useToast>;
    render(
      <ToastProvider>
        <Harness onReady={(a) => { api = a; }} />
      </ToastProvider>,
    );

    act(() => {
      api.info('Heads up');
    });
    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    act(() => {
      fireEvent.click(dismiss);
    });
    expect(screen.queryByText('Heads up')).toBeNull();
  });

  it('stacks multiple toasts and dismisses by id', () => {
    let api!: ReturnType<typeof useToast>;
    render(
      <ToastProvider>
        <Harness onReady={(a) => { api = a; }} />
      </ToastProvider>,
    );

    let firstId = '';
    act(() => {
      firstId = api.warning('First');
      api.warning('Second');
    });
    expect(screen.queryByText('First')).not.toBeNull();
    expect(screen.queryByText('Second')).not.toBeNull();

    act(() => {
      api.dismiss(firstId);
    });
    expect(screen.queryByText('First')).toBeNull();
    expect(screen.queryByText('Second')).not.toBeNull();
  });
});

// POST-S7 H2/B-07——4 秒提示消失后必须可回看（有界历史 + 去重 + 清空）。
// 钉住三件事：①播报即入历史（不依赖消失时机）②同 (variant,message) 去重合并
// ③上限 50 条（防长会话把 DOM 撑爆）。
describe('ToastProvider 通知历史（POST-S7 H2/B-07）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function renderWithApi() {
    let api!: ReturnType<typeof useToast>;
    render(
      <ToastProvider>
        <Harness onReady={(value) => { api = value; }} />
      </ToastProvider>,
    );
    return () => api;
  }

  it('提示消失后仍在历史里，可展开回看', () => {
    const getApi = renderWithApi();
    act(() => {
      getApi().error('模型调用失败：HTTP 502');
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText('模型调用失败：HTTP 502')).toBeNull();
    fireEvent.click(screen.getByTestId('toast-history-toggle'));
    expect(screen.getByTestId('toast-history-panel')).toBeTruthy();
    expect(screen.getByText('模型调用失败：HTTP 502')).toBeTruthy();
  });

  it('同 (variant,message) 去重合并，不会刷屏', () => {
    const getApi = renderWithApi();
    act(() => {
      getApi().warning('同一告警');
      getApi().warning('同一告警');
      getApi().warning('同一告警');
    });
    expect(getApi().history.filter((item) => item.message === '同一告警')).toHaveLength(1);
    expect(screen.getByTestId('toast-history-toggle').textContent).toContain('通知历史（1）');
  });

  it('历史有上限（50），长会话不线性膨胀', () => {
    const getApi = renderWithApi();
    act(() => {
      for (let i = 0; i < 60; i += 1) getApi().info(`第 ${i} 条`);
    });
    expect(getApi().history).toHaveLength(50);
    expect(getApi().history[0].message).toBe('第 59 条');
  });

  it('清空后历史面板消失', () => {
    const getApi = renderWithApi();
    act(() => {
      getApi().info('一条');
    });
    fireEvent.click(screen.getByTestId('toast-history-toggle'));
    fireEvent.click(screen.getByText('清空'));
    expect(screen.queryByTestId('toast-history-panel')).toBeNull();
    expect(getApi().history).toHaveLength(0);
  });
});
