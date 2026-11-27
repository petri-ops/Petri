/** item84 HK-01：3D 供应商不可用时三选一弹窗（继续降级/配置凭据/取消）。 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Model3DFallbackDialog } from './Model3DFallbackDialog';

const options = [
  { id: 'model3d-fallback-continue', label: '本地近似生成', description: '几何体组合，非 AI 生成' },
  { id: 'model3d-fallback-configure', label: '先配置凭据重试', description: '稍后重试 AI 3D' },
  { id: 'model3d-fallback-cancel', label: '取消', description: '不做 3D' },
];

afterEach(cleanup);

describe('item84 3D 降级三选一弹窗', () => {
  it('HK-01 三按钮齐全且各自回调，无编辑入口', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    render(<Model3DFallbackDialog open question="3D 生成失败，如何处理？" options={options} onSelect={onSelect} onCancel={onCancel} />);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    const buttons = screen.getAllByTestId('model3d-fallback-option');
    expect(buttons.map((b) => b.textContent)).toEqual([
      '本地近似生成', '先配置凭据重试', '取消',
    ]);
    fireEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith('model3d-fallback-continue');
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith('model3d-fallback-configure');
    fireEvent.click(buttons[2]);
    expect(onSelect).toHaveBeenCalledWith('model3d-fallback-cancel');
    expect(screen.queryByText(/裁剪|标注|滤镜/)).toBeNull();
  });

  it('HK-01 open=false 时不渲染', () => {
    const { container } = render(<Model3DFallbackDialog open={false} question="" options={options} onSelect={vi.fn()} onCancel={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
