// UI-620 — 消息排队面板：每条消息自带插话/编辑/移除 + 更多菜单。
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueuedMessagesPanel } from './QueuedMessagesPanel';
import type { QueuedPrompt } from './hooks/useChatStream';

function prompt(id: string, text: string): QueuedPrompt {
  return { id, conversationId: 'conv', text, createdAt: 1 };
}

function props(overrides: Partial<React.ComponentProps<typeof QueuedMessagesPanel>> = {}) {
  return {
    prompts: [prompt('q1', '第一条排队消息'), prompt('q2', '第二条排队消息')],
    autoDrain: true,
    overflow: false,
    streaming: true,
    steeringId: null,
    queueCap: 20,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onSteer: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onSendNow: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('QueuedMessagesPanel', () => {
  it('每条排队消息行内都有 插话/编辑/移除；插话可点并回调该条 id', () => {
    const p = props();
    render(<QueuedMessagesPanel {...p} />);
    expect(screen.getByTestId('queue-panel').textContent).toContain('消息排队 · 2 条');
    const steerButtons = screen.getAllByTestId('queue-chip-steer');
    expect(steerButtons.length).toBe(2);
    expect(steerButtons[0].textContent).toContain('插话');
    expect((steerButtons[0] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(steerButtons[0]);
    expect(p.onSteer).toHaveBeenCalledWith('q1');
    fireEvent.click(screen.getAllByTestId('queue-chip-withdraw')[0]);
    expect(p.onEdit).toHaveBeenCalledWith('q1');
    fireEvent.click(screen.getAllByTestId('queue-chip-remove')[0]);
    expect(p.onRemove).toHaveBeenCalledWith('q1');
  });

  it('非运行态插话禁用并给出「继续排队」原因；插话中显示插话中', () => {
    const idle = props({ streaming: false });
    const { rerender } = render(<QueuedMessagesPanel {...idle} />);
    const disabled = screen.getAllByTestId('queue-chip-steer')[0] as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    expect(disabled.getAttribute('title')).toContain('继续排队');

    rerender(<QueuedMessagesPanel {...props({ steeringId: 'q1' })} />);
    const steering = screen.getAllByTestId('queue-chip-steer')[0] as HTMLButtonElement;
    expect(steering.disabled).toBe(true);
    expect(steering.textContent).toContain('插话中');
  });

  it('更多菜单：立即执行 / 上移 / 下移，选择后菜单关闭', () => {
    const p = props();
    render(<QueuedMessagesPanel {...p} />);
    fireEvent.click(screen.getAllByTestId('queue-chip-more')[0]);
    expect(screen.getByTestId('queue-chip-send-now').textContent).toContain('立即执行');
    fireEvent.click(screen.getByTestId('queue-chip-send-now'));
    expect(p.onSendNow).toHaveBeenCalledWith('q1');
    expect(screen.queryByTestId('queue-chip-send-now')).toBeNull();

    fireEvent.click(screen.getAllByTestId('queue-chip-more')[0]);
    fireEvent.click(screen.getByTestId('queue-chip-up'));
    expect(p.onMove).toHaveBeenCalledWith('q1', -1);

    fireEvent.click(screen.getAllByTestId('queue-chip-more')[0]);
    fireEvent.click(screen.getByTestId('queue-chip-down'));
    expect(p.onMove).toHaveBeenCalledWith('q1', 1);
  });

  it('暂停/恢复排水与溢出提示', () => {
    const p = props();
    const { rerender } = render(<QueuedMessagesPanel {...p} />);
    fireEvent.click(screen.getByTestId('queue-pause'));
    expect(p.onPause).toHaveBeenCalledTimes(1);
    rerender(<QueuedMessagesPanel {...props({ autoDrain: false, overflow: true })} />);
    expect(screen.getByTestId('queue-overflow').textContent).toContain('队列已满');
    fireEvent.click(screen.getByTestId('queue-resume'));
  });

  it('无排队项且自动排水开启时不渲染；暂停时仍显示面板', () => {
    const { rerender, container } = render(<QueuedMessagesPanel {...props({ prompts: [] })} />);
    expect(container.firstChild).toBeNull();
    rerender(<QueuedMessagesPanel {...props({ prompts: [], autoDrain: false })} />);
    expect(screen.getByTestId('queue-panel')).toBeTruthy();
  });
});
