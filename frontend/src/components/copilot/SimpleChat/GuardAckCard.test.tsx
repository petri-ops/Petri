// BLOCK-171 CP-2 — GuardAckCard 三按钮契约（放行一次/总是/拒绝）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { GuardAckCard } from './GuardAckCard';

afterEach(cleanup);

describe('GuardAckCard（BLOCK-171 CP-2）', () => {
  const base = {
    toolName: 'workspace_exec',
    guardKey: 'cmd:format',
    message: '动态防护拦截：命令「format」命中系统级破坏命令维度',
    onAck: vi.fn(),
    onDismiss: vi.fn(),
  };

  it('渲染 guardKey 与拦截详情', () => {
    render(<GuardAckCard {...base} />);
    expect(screen.getByTestId('guard-ack-card').textContent).toContain('cmd:format');
    expect(screen.getByTestId('guard-ack-card').textContent).toContain('format」命中');
  });

  it('三按钮分别派发 once / always / dismiss', () => {
    const onAck = vi.fn();
    const onDismiss = vi.fn();
    render(<GuardAckCard {...base} onAck={onAck} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('guard-ack-once'));
    expect(onAck).toHaveBeenCalledWith('once');
    fireEvent.click(screen.getByTestId('guard-ack-always'));
    expect(onAck).toHaveBeenCalledWith('always');
    fireEvent.click(screen.getByText('拒绝'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('busy 时按钮禁用', () => {
    render(<GuardAckCard {...base} busy onAck={vi.fn()} onDismiss={vi.fn()} />);
    for (const id of ['guard-ack-once', 'guard-ack-always']) {
      expect(screen.getByTestId(id).getAttribute('disabled')).not.toBeNull();
    }
  });
});
