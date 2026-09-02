import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResumePrompt } from './ResumePrompt';
import type { ResumeLastModelCall } from '../copilotClient';

const { previewAgentTaskResumeMock } = vi.hoisted(() => ({
  previewAgentTaskResumeMock: vi.fn(),
}));

vi.mock('../copilotClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../copilotClient')>();
  return {
    ...original,
    previewAgentTaskResume: previewAgentTaskResumeMock,
  };
});

vi.mock('@/components/icons/Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

const lastModelCall: ResumeLastModelCall = {
  ts: '2026-09-02T12:00:00.000Z',
  kind: 'agent_iter',
  model: 'deepseek-chat',
  provider: 'deepseek',
  finishReason: 'tool_calls',
  toolCallNames: ['workspace_write'],
  error: null,
};

describe('ResumePrompt (BLOCK-38 P2 / UI-275)', () => {
  beforeEach(() => {
    previewAgentTaskResumeMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the confirm popover with interruption time and last model call summary', async () => {
    previewAgentTaskResumeMock.mockResolvedValue({
      resumable: true,
      interruptedAt: '2026-09-02T12:00:00.000Z',
      lastModelCall,
      progressDigest: '· 第1轮 调用 workspace_write({"path":"/tmp/a.md"})',
    });

    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ResumePrompt taskId="task-old" onConfirm={onConfirm} />);

    // 初始只渲染入口按钮，不渲染弹层
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /继续执行/ }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.textContent).toContain('deepseek-chat');
    });
    expect(dialog.textContent).toContain('准备调用工具');
    expect(dialog.textContent).toContain('workspace_write');
    expect(dialog.textContent).toContain('第1轮 调用 workspace_write');
    expect(previewAgentTaskResumeMock).toHaveBeenCalledWith('task-old');

    // 确认 → onConfirm 被调用且弹层关闭
    fireEvent.click(screen.getByRole('button', { name: '确认继续' }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('shows the honest empty state when no model call was recorded', async () => {
    previewAgentTaskResumeMock.mockResolvedValue({
      resumable: true,
      interruptedAt: '2026-09-02T12:00:00.000Z',
      lastModelCall: null,
      progressDigest: null,
    });

    render(<ResumePrompt taskId="task-old" onConfirm={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: /继续执行/ }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.textContent).toContain('（无已记录的模型调用）');
    });
  });

  it('surfaces the confirm error inside the popover and keeps it open', async () => {
    previewAgentTaskResumeMock.mockResolvedValue({
      resumable: true,
      interruptedAt: '2026-09-02T12:00:00.000Z',
      lastModelCall: null,
      progressDigest: null,
    });

    const onConfirm = vi.fn().mockRejectedValue(new Error('并发限制，请稍后再试'));
    render(<ResumePrompt taskId="task-old" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /继续执行/ }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await screen.findByRole('button', { name: '确认继续' }));
    await waitFor(() => {
      expect(dialog.textContent).toContain('并发限制，请稍后再试');
    });
    // 弹层保持打开，允许重试
    expect(screen.getByRole('button', { name: '确认继续' })).toBeTruthy();
  });
});
