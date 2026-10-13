// BLOCK-171 CP-2 — GuardAckCard 三按钮契约（放行一次/总是/拒绝）。
// BLOCK-180 — 审批一等资源面契约：requestId 展示/command span 高亮/两步武装
// （「本任务总是放行」首点出确认条、二次点击才上送——有意行为变更，2026-10-13
// 用户裁决「② 审批二阶段（推荐）」，plan §1 P3 留痕）。
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

  it('once 派发；always 走两步武装（首点出确认条，二次点击才派发）；拒绝派发 dismiss', () => {
    const onAck = vi.fn();
    const onDismiss = vi.fn();
    render(<GuardAckCard {...base} onAck={onAck} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('guard-ack-once'));
    expect(onAck).toHaveBeenCalledWith('once');
    // BLOCK-180 P3 — 两步武装
    fireEvent.click(screen.getByTestId('guard-ack-always'));
    expect(onAck).not.toHaveBeenCalledWith('always');
    expect(screen.getByTestId('guard-ack-arm-confirm').textContent).toContain('不再询问');
    fireEvent.click(screen.getByTestId('guard-ack-arm-confirm-no'));
    expect(screen.queryByTestId('guard-ack-arm-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('guard-ack-always'));
    fireEvent.click(screen.getByTestId('guard-ack-arm-confirm-yes'));
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

describe('GuardAckCard（BLOCK-180 审批一等资源面）', () => {
  const base = {
    toolName: 'workspace_exec',
    guardKey: 'cmd:format',
    message: '动态防护拦截：命令「format」命中系统级破坏命令维度',
    onAck: vi.fn(),
    onDismiss: vi.fn(),
  };

  it('requestId 在场时显示请求标识', () => {
    render(<GuardAckCard {...base} requestId="apr_abc123def4567890" />);
    expect(screen.getByTestId('guard-ack-card').textContent).toContain('apr_abc123def4567890'.slice(0, 12));
  });

  it('command+spans：风险片段按 span 高亮且非片段文本保留', () => {
    const command = 'format C: /q';
    render(
      <GuardAckCard
        {...base}
        command={command}
        spans={[{ start: 0, end: 6, kind: 'destructive-token' }]}
      />,
    );
    const row = screen.getByTestId('guard-ack-command');
    const marks = row.querySelectorAll('mark.sc-guard-card__risk--destructive-token');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('format');
    expect(row.textContent).toContain('C: /q');
  });

  it('无 command 时不高亮行（存量形态退化）', () => {
    render(<GuardAckCard {...base} />);
    expect(screen.queryByTestId('guard-ack-command')).toBeNull();
  });

  it('已武装维度徽标在场', () => {
    render(<GuardAckCard {...base} armedGuardKeys={['cmd:dd', 'path:system32']} />);
    const armed = screen.getByTestId('guard-ack-armed');
    expect(armed.textContent).toContain('cmd:dd');
    expect(armed.textContent).toContain('path:system32');
  });
});
