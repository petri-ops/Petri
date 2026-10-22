// BLOCK-171 CP-2 — GuardAckCard 三按钮契约（放行一次/本任务/拒绝）。
// BLOCK-180 — 审批一等资源面契约：requestId 展示/command span 高亮/两步武装。
// BLOCK-243 Q1 — 三变体/确定性解释/长命令折叠/参数编辑/范围/计数/重复提示。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { GuardAckCard } from './GuardAckCard';

afterEach(cleanup);

describe('GuardAckCard（BLOCK-171 CP-2 / BLOCK-243 Q1 v2）', () => {
  const base = {
    toolName: 'workspace_exec',
    guardKey: 'cmd:format',
    message: '动态防护拦截：命令「format」命中系统级破坏命令维度',
    onAck: vi.fn(),
    onDismiss: vi.fn(),
  };

  it('渲染 guardKey、解释与拦截详情', () => {
    render(<GuardAckCard {...base} explanation="批准仅放行本次调用；如属误判请调整调用方式。" />);
    const card = screen.getByTestId('guard-ack-card');
    expect(card.textContent).toContain('cmd:format');
    expect(card.textContent).toContain('format」命中');
    expect(screen.getByTestId('guard-ack-explanation').textContent).toContain('批准仅放行本次调用');
  });

  it('once 派发；task 走两步武装（首点出确认条，二次点击才派发）；拒绝派发 dismiss', () => {
    const onAck = vi.fn();
    const onDismiss = vi.fn();
    render(<GuardAckCard {...base} onAck={onAck} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('guard-ack-once'));
    expect(onAck).toHaveBeenCalledWith('once');

    fireEvent.click(screen.getByTestId('guard-ack-task'));
    expect(onAck).not.toHaveBeenCalledWith('task');
    expect(screen.getByTestId('guard-ack-arm-confirm').textContent).toContain('不再询问');
    fireEvent.click(screen.getByTestId('guard-ack-arm-confirm-no'));
    expect(screen.queryByTestId('guard-ack-arm-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('guard-ack-task'));
    fireEvent.click(screen.getByTestId('guard-ack-arm-confirm-yes'));
    expect(onAck).toHaveBeenCalledWith('task');

    fireEvent.click(screen.getByText('拒绝'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('始终信任仅 MCP 请求可用；两步武装确认写 trust=allow 的后果', () => {
    const onAck = vi.fn();
    const { rerender } = render(<GuardAckCard {...base} onAck={onAck} />);
    expect(screen.queryByTestId('guard-ack-always')).toBeNull();

    rerender(<GuardAckCard {...base} onAck={onAck} canAlways mcpServerId="demo" />);
    fireEvent.click(screen.getByTestId('guard-ack-always'));
    expect(onAck).not.toHaveBeenCalledWith('always');
    const confirm = screen.getByTestId('guard-ack-arm-confirm');
    expect(confirm.textContent).toContain('信任位');
    expect(confirm.textContent).toContain('demo');
    fireEvent.click(screen.getByTestId('guard-ack-arm-confirm-yes'));
    expect(onAck).toHaveBeenCalledWith('always');
  });

  it('busy 时按钮禁用', () => {
    render(<GuardAckCard {...base} busy canAlways onAck={vi.fn()} onDismiss={vi.fn()} />);
    for (const id of ['guard-ack-once', 'guard-ack-task', 'guard-ack-always']) {
      expect(screen.getByTestId(id).getAttribute('disabled')).not.toBeNull();
    }
  });

  it('变体：danger/warning/info 标题与 data-variant 一致', () => {
    const { rerender } = render(<GuardAckCard {...base} variant="danger" />);
    expect(screen.getByTestId('guard-ack-card').getAttribute('data-variant')).toBe('danger');
    expect(screen.getByTestId('guard-ack-card').textContent).toContain('动态防护确认');

    rerender(<GuardAckCard {...base} variant="warning" guardKey="rule:r1" />);
    expect(screen.getByTestId('guard-ack-card').getAttribute('data-variant')).toBe('warning');
    expect(screen.getByTestId('guard-ack-card').textContent).toContain('规则确认');

    rerender(<GuardAckCard {...base} variant="info" guardKey="mcp:demo" />);
    expect(screen.getByTestId('guard-ack-card').getAttribute('data-variant')).toBe('info');
    expect(screen.getByTestId('guard-ack-card').textContent).toContain('MCP 服务确认');
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

describe('GuardAckCard（BLOCK-243 Q1 v2）', () => {
  const base = {
    toolName: 'mcp_demo_destructive',
    guardKey: 'mcp:demo',
    message: 'MCP 服务「demo」的信任位为 ask；工具声明 destructiveHint',
    onAck: vi.fn(),
    onDismiss: vi.fn(),
  };

  it('长命令默认折叠，点击展开；短命令无折叠钮', () => {
    const longCommand = `echo ${'x'.repeat(300)}`;
    const { rerender } = render(<GuardAckCard {...base} command={longCommand} />);
    const toggle = screen.getByTestId('guard-ack-command-toggle');
    expect(toggle.textContent).toContain('展开全部命令');
    expect(screen.getByTestId('guard-ack-command').querySelector('.sc-guard-card__command-fold')?.className)
      .not.toContain('is-expanded');
    fireEvent.click(toggle);
    expect(screen.getByTestId('guard-ack-command').querySelector('.sc-guard-card__command-fold')?.className)
      .toContain('is-expanded');
    expect(screen.getByTestId('guard-ack-command-toggle').textContent).toContain('收起命令');

    rerender(<GuardAckCard {...base} command="echo ok" />);
    expect(screen.queryByTestId('guard-ack-command-toggle')).toBeNull();
  });

  it('参数编辑：非法 JSON 阻止批准；修改后按一次性批准上送 updatedInput；未改按原参数', () => {
    const onAck = vi.fn();
    const argsPreview = JSON.stringify({ target: 'db' });
    render(<GuardAckCard {...base} argsPreview={argsPreview} inputEditable onAck={onAck} />);
    expect(screen.getByTestId('guard-ack-args-preview').textContent).toContain('"target": "db"');

    fireEvent.click(screen.getByTestId('guard-ack-edit-toggle'));
    const textarea = screen.getByTestId<HTMLTextAreaElement>('guard-ack-args-input');
    expect(textarea.value).toContain('"target"');
    expect(screen.getByTestId('guard-ack-edit-hint').textContent).toContain('一次性批准');

    fireEvent.change(textarea, { target: { value: '{bad json' } });
    fireEvent.click(screen.getByTestId('guard-ack-once'));
    expect(onAck).not.toHaveBeenCalled();
    expect(screen.getByTestId('guard-ack-args-error').textContent).toContain('JSON 解析失败');

    fireEvent.change(textarea, { target: { value: JSON.stringify({ target: 'archive' }) } });
    fireEvent.click(screen.getByTestId('guard-ack-once'));
    expect(onAck).toHaveBeenCalledWith('once', { target: 'archive' });

    onAck.mockClear();
    fireEvent.click(screen.getByTestId('guard-ack-edit-toggle'));
    const again = screen.getByTestId<HTMLTextAreaElement>('guard-ack-args-input');
    fireEvent.change(again, { target: { value: JSON.stringify({ target: 'db' }, null, 2) } });
    fireEvent.click(screen.getByTestId('guard-ack-once'));
    expect(onAck).toHaveBeenCalledWith('once');
  });

  it('参数不可编辑时只读展示并说明原因', () => {
    render(<GuardAckCard {...base} argsPreview={'{"apiKey":"[REDACTED]"}'} inputEditable={false} />);
    expect(screen.getByTestId('guard-ack-args-preview')).toBeTruthy();
    expect(screen.queryByTestId('guard-ack-edit-toggle')).toBeNull();
    expect(screen.getByTestId('guard-ack-args').textContent).toContain('仅只读');
  });

  it('待审批计数与重复调用提示在场', () => {
    render(<GuardAckCard {...base} pendingRequestCount={3} duplicatePending />);
    expect(screen.getByTestId('guard-ack-pending-count').textContent).toContain('2');
    expect(screen.getByTestId('guard-ack-duplicate').textContent).toContain('重复调用');
  });
});
