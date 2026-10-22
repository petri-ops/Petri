// BLOCK-244 Q1-REM — 编辑重发 checkpoint 选择弹层契约。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { EditCheckpointDialog } from './EditCheckpointDialog';

afterEach(cleanup);

describe('EditCheckpointDialog（BLOCK-244 C5）', () => {
  it('展示回退边界与三个动作；错误可见；busy 禁用', () => {
    const onRollback = vi.fn();
    const onResend = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <EditCheckpointDialog open at={Date.now()} onRollback={onRollback} onResend={onResend} onCancel={onCancel} />,
    );
    expect(screen.getByTestId('edit-checkpoint-warning').textContent).toContain('部分未记录');
    fireEvent.click(screen.getByTestId('edit-checkpoint-rollback'));
    expect(onRollback).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('edit-checkpoint-resend'));
    expect(onResend).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('edit-checkpoint-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <EditCheckpointDialog open busy error="回退失败" onRollback={onRollback} onResend={onResend} onCancel={onCancel} />,
    );
    expect(screen.getByTestId('edit-checkpoint-error').textContent).toContain('回退失败');
    expect(screen.getByTestId<HTMLButtonElement>('edit-checkpoint-rollback').disabled).toBe(true);
  });
});
