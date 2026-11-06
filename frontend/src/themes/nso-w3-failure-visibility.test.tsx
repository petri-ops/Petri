/**
 * nso-w3-failure-visibility.test.tsx — BLOCK-369（NSO-W3 F-10）失败可见性契约。
 *
 * 评估 F-10：ThemeProvider.prefsSync 失败只进 console（用户以为跨端已保存却无从归因）；
 * ExperimentalFeaturesSection 拉取失败静默空段（后端未就绪时整段开关凭空消失）。
 * 契约：
 *  - prefs 同步失败 → 出现 role=status 告警条（含错误与「本端已生效」说明），成功后消失；
 *  - feature-flags 拉取网络失败 → 分段显示失败原因 + 重试按钮（不再静默空段）；成功空列表仍可隐藏。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('W3-F10 主题偏好同步失败可见', () => {
  it('pushPrefs 失败 → role=status 告警条出现；恢复成功后消失', async () => {
    let failNext = true;
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { method?: string }) => {
      if (init?.method === 'PUT') {
        if (failNext) return { ok: false, status: 503 } as Response;
        return { ok: true } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, prefs: {} }) } as unknown as Response;
    }));
    const { ThemeProvider, useTheme } = await import('./ThemeProvider');
    const Probe = () => {
      const { setPreference } = useTheme();
      return (
        <div>
          <button onClick={() => setPreference('dark')}>push</button>
        </div>
      );
    };
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText('push'));
    const alert = await screen.findByRole('status');
    expect(alert).toHaveTextContent('服务端同步失败');
    expect(alert).toHaveTextContent('本端已生效');
    failNext = false;
    fireEvent.click(screen.getByText('push'));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});

describe('W3-F10 实验开关拉取失败可见', () => {
  const loadSection = async () => (await import('../components/settings/ExperimentalFeaturesSection')).ExperimentalFeaturesSection;

  it('拉取网络失败 → 显示失败原因与重试按钮（不静默空段）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const Section = (await loadSection()) as React.ComponentType;
    render(<Section />);
    await waitFor(() => expect(screen.getByTestId('experimental-flags-error')).toBeInTheDocument());
    expect(screen.getByTestId('experimental-flags-error')).toHaveTextContent('ECONNREFUSED');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('成功但空列表 → 分段隐藏（既有语义保持）；重试按钮触发重新拉取', async () => {
    let failNext = true;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failNext) throw new Error('ECONNREFUSED');
      return { ok: true, json: async () => ({ status: 'ok', flags: {} }) } as unknown as Response;
    }));
    const Section = (await loadSection()) as React.ComponentType;
    render(<Section />);
    await waitFor(() => expect(screen.getByTestId('experimental-flags-error')).toBeInTheDocument());
    failNext = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByTestId('experimental-flags-error')).toBeNull());
    expect(screen.queryByTestId('server-flags')).toBeNull();
  });
});
