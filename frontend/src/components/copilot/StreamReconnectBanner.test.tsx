import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { StreamReconnectBanner, deriveReconnectPhase } from './StreamReconnectBanner';

afterEach(cleanup);

describe('B-14 SSE 重连独立横幅（三态，DOM 断言不冒充视觉绿）', () => {
  it('正常态不占位', () => {
    expect(deriveReconnectPhase(undefined)).toBe('hidden');
    expect(deriveReconnectPhase('正在生成回复')).toBe('hidden');
    const { container } = render(<StreamReconnectBanner statusMessage="正在生成回复" />);
    expect(container.firstChild).toBeNull();
  });

  it('断线态：role=status + aria-live，含第 N 次', () => {
    expect(deriveReconnectPhase('与任务失去连接，正在重连（第 3 次）…')).toBe('reconnecting');
    render(<StreamReconnectBanner statusMessage="与任务失去连接，正在重连（第 3 次）…" attempt={3} />);
    const banner = screen.getByRole('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
    expect(banner.getAttribute('data-reconnect-phase')).toBe('reconnecting');
    expect(banner.textContent).toContain('第 3 次');
  });

  it('重放态与耗尽态各自有独立文案', () => {
    expect(deriveReconnectPhase('正在按事件水位重放进度')).toBe('replaying');
    render(<StreamReconnectBanner statusMessage="正在按事件水位重放进度" />);
    expect(screen.getByRole('status').textContent).toContain('重放');

    cleanup();
    expect(deriveReconnectPhase('重连失败，已耗尽重试次数')).toBe('exhausted');
    render(<StreamReconnectBanner statusMessage="重连失败，已耗尽重试次数" />);
    const b = screen.getByRole('status');
    expect(b.getAttribute('data-reconnect-phase')).toBe('exhausted');
    expect(b.textContent).toContain('手动继续');
  });
});
