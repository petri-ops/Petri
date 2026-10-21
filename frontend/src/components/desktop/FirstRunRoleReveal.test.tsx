import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FirstRunRoleReveal } from './FirstRunRoleReveal';

const originalFetch = globalThis.fetch;

function mockPrefs(prefs: Record<string, unknown>, putOk = true) {
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const response = init?.method === 'PUT'
      ? new Response(JSON.stringify({ ok: putOk }), { status: putOk ? 200 : 500 })
      : new Response(JSON.stringify({ prefs }), { status: 200 });
    return await Promise.resolve(response);
  });
}

beforeEach(() => { globalThis.fetch = originalFetch; });
afterEach(() => { globalThis.fetch = originalFetch; cleanup(); });

describe('FirstRunRoleReveal', () => {
  it('首次展示三张角色卡；显式确认后关闭并写回', async () => {
    mockPrefs({ roleRevealSeen: false });
    render(<FirstRunRoleReveal />);
    await waitFor(() => expect(screen.getByTestId('role-reveal')).not.toBeNull());
    expect(screen.getByText('分析数据')).not.toBeNull();
    expect(screen.getByText('写代码')).not.toBeNull();
    expect(screen.getByText('整理知识')).not.toBeNull();
    fireEvent.click(screen.getByTestId('role-reveal-start'));
    await waitFor(() => expect(screen.queryByTestId('role-reveal')).toBeNull());
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/user/prefs'), expect.objectContaining({ method: 'PUT' }));
  });

  it('已看过 → 不渲染', async () => {
    mockPrefs({ roleRevealSeen: true });
    render(<FirstRunRoleReveal />);
    await waitFor(() => expect(screen.queryByTestId('role-reveal')).toBeNull());
  });

  it('写回失败显示错误但不重新弹窗', async () => {
    mockPrefs({ roleRevealSeen: false }, false);
    render(<FirstRunRoleReveal />);
    await waitFor(() => expect(screen.getByTestId('role-reveal')).not.toBeNull());
    fireEvent.click(screen.getByTestId('role-reveal-start'));
    await waitFor(() => expect(screen.queryByTestId('role-reveal')).toBeNull());
  });
});
