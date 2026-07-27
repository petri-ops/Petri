import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultEditAdvancedDrawer, ResultEditPanel } from './ResultEditPanel';
import type { ResultStudioEditControls } from '@/lib/result-studio-interaction-client';

afterEach(cleanup);

function schema(overrides: Partial<ResultStudioEditControls> = {}): ResultStudioEditControls {
  return {
    controlsVersion: 1,
    groups: [
      { group: 'presentation', label: '外观与导出', parameterNames: ['color_up', 'point_size', 'legend_position'] },
      { group: 'scientific', label: '科学参数', parameterNames: ['fc_threshold'] },
    ],
    controls: [
      {
        name: 'color_up', controlType: 'color', impact: 'presentation', group: 'presentation',
        default: '#dc2626', required: false, scientificallyNeutral: true,
      },
      {
        name: 'point_size', controlType: 'number', impact: 'presentation', group: 'presentation',
        default: 1.8, required: false, minimum: 0.2, maximum: 6, scientificallyNeutral: true,
      },
      {
        name: 'legend_position', controlType: 'select', impact: 'presentation', group: 'presentation',
        default: 'right', required: false, options: ['right', 'left', 'top', 'bottom', 'none'],
        scientificallyNeutral: true,
      },
      {
        name: 'fc_threshold', controlType: 'number', impact: 'scientific', group: 'scientific',
        default: 1, required: false, minimum: 0, maximum: null, scientificallyNeutral: false,
      },
    ],
    diagnostics: [],
    currentValues: { color_up: '#dc2626', point_size: 1.8, legend_position: 'right', fc_threshold: 1 },
    ...overrides,
  };
}

describe('G0-RS-P4 Schema 驱动统一编辑面板', () => {
  it('控件完全来自 descriptor 投影，未声明参数不出现', () => {
    render(<ResultEditPanel editControls={schema()} onSubmit={() => undefined} />);
    expect(screen.getByText('color_up')).toBeTruthy();
    expect(screen.getByText('fc_threshold')).toBeTruthy();
    expect(screen.queryByText('secret_flag')).toBeNull();
  });

  it('没有可编辑参数时如实说明，不伪造控件', () => {
    render(
      <ResultEditPanel
        editControls={schema({ groups: [], controls: [], currentValues: {} })}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByText(/没有声明可编辑参数/)).toBeTruthy();
  });

  it('无改动时不能提交，避免生成空候选版本', () => {
    render(<ResultEditPanel editControls={schema()} onSubmit={() => undefined} />);
    const submit = screen.getByRole('button', { name: /生成候选版本/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('仅改呈现参数时声明不重新计算科学结论，且无需科学确认', () => {
    const onSubmit = vi.fn();
    render(<ResultEditPanel editControls={schema()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('point_size'), { target: { value: '3' } });
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-science')).toBe('false');
    expect(status.textContent).toContain('不重新计算科学结论');
    expect(screen.queryByText(/确认继续/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /生成候选版本/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submission = onSubmit.mock.calls[0][0];
    expect(submission.origin).toBe('manual');
    expect(submission.parameterPatch).toEqual({ point_size: 3 });
    expect(submission.scientificConfirmed).toBe(false);
  });

  it('改科学参数必须显式确认才能提交，UI 不代替用户确认', () => {
    const onSubmit = vi.fn();
    render(<ResultEditPanel editControls={schema()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('fc_threshold'), { target: { value: '2' } });
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-science')).toBe('true');
    expect(status.textContent).toContain('需要重新计算');
    const submit = screen.getByRole('button', { name: /生成候选版本/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /确认继续/ }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit.mock.calls[0][0].scientificConfirmed).toBe(true);
  });

  it('把值改回当前生效值后视为无改动，不进入 patch', () => {
    render(<ResultEditPanel editControls={schema()} onSubmit={() => undefined} />);
    const input = screen.getByLabelText('point_size');
    fireEvent.change(input, { target: { value: '3' } });
    expect((screen.getByRole('button', { name: /生成候选版本/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(input, { target: { value: '1.8' } });
    expect((screen.getByRole('button', { name: /生成候选版本/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('上下文阻断时禁用手动提交并显示原因', () => {
    render(
      <ResultEditPanel
        editControls={schema()}
        disabledReason="归因只能到 Job，缺少可复现的单产物脚本。"
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByText(/归因只能到 Job/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('point_size'), { target: { value: '3' } });
    expect((screen.getByRole('button', { name: /生成候选版本/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('作为高级精调抽屉时默认折叠，展开后仍提交同一种手动 patch', () => {
    const onSubmit = vi.fn();
    render(<ResultEditAdvancedDrawer editControls={schema()} onSubmit={onSubmit} />);

    const drawer = document.querySelector('details[aria-label="高级精细调整"]') as HTMLDetailsElement;
    expect(drawer).toBeTruthy();
    expect(drawer.hasAttribute('open')).toBe(false);

    drawer.setAttribute('open', '');
    fireEvent.change(screen.getByLabelText('point_size'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /生成候选版本/ }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'manual',
      parameterPatch: { point_size: 3 },
    }));
    expect(screen.queryByText(/或者直接描述/)).toBeNull();
  });

  it('放弃改动清空草稿与科学确认', () => {
    render(<ResultEditPanel editControls={schema()} onSubmit={() => undefined} />);
    fireEvent.change(screen.getByLabelText('fc_threshold'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /确认继续/ }));
    fireEvent.click(screen.getByRole('button', { name: '放弃改动' }));
    expect((screen.getByRole('button', { name: /生成候选版本/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
