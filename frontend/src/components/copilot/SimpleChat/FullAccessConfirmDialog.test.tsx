// BLOCK-244 Q1-REM — 完全访问确认层契约。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { FullAccessConfirmDialog } from './FullAccessConfirmDialog';

afterEach(cleanup);

describe('FullAccessConfirmDialog（BLOCK-244 D3）', () => {
  it('open=false 不渲染；open 展示能力/风险并可确认/取消', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<FullAccessConfirmDialog open={false} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.queryByTestId('full-access-confirm')).toBeNull();

    rerender(<FullAccessConfirmDialog open onConfirm={onConfirm} onCancel={onCancel} />);
    const dialog = screen.getByTestId('full-access-confirm');
    expect(dialog.textContent).toContain('完全访问');
    expect(dialog.textContent).toContain('执行本地命令行');
    expect(screen.getByTestId('full-access-risk').textContent).toContain('切回');
    fireEvent.click(screen.getByTestId('full-access-confirm-no'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('full-access-confirm-yes'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
