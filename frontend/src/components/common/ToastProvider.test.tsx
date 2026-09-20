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
