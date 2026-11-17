import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelChip } from './ModelChip';

afterEach(() => {
  cleanup();
});

describe('UI-538 加映一 — 模型按钮显示当前模型名', () => {
  it('手选模式显示模型短名，title/aria-label 仍为完整模型名', () => {
    render(
      <ModelChip
        supplier="BigModel Coding Plan"
        modelName="glm-5.3-flash"
        autoModel={false}
        autoPreview=""
        onOpenModel={vi.fn()}
      />,
    );
    const chip = screen.getByTestId('model-chip-model');
    expect(screen.getByTestId('model-chip-label').textContent).toBe('glm-5.3-flash');
    expect(chip.getAttribute('title')).toBe('glm-5.3-flash');
    expect(chip.getAttribute('aria-label')).toBe('glm-5.3-flash');
  });

  it('自动模式显示“自动 · 当前解析模型”，不隐藏实际选择', () => {
    render(
      <ModelChip
        supplier="BigModel Coding Plan"
        modelName="glm-5.3-flash"
        autoModel
        autoPreview="glm-5.3-flash（Agent 角色绑定）"
        onOpenModel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('model-chip-label').textContent).toBe('自动 · glm-5.3-flash（Agent 角色绑定）');
    expect(screen.getByTestId('model-chip-model').getAttribute('title')).toBe('自动选模型（当前：glm-5.3-flash（Agent 角色绑定））');
  });

  it('点击仍只打开模型菜单，写法不变', () => {
    const onOpenModel = vi.fn();
    render(
      <ModelChip supplier="s" modelName="m" autoModel={false} autoPreview="" onOpenModel={onOpenModel} />,
    );
    screen.getByTestId('model-chip-model').click();
    expect(onOpenModel).toHaveBeenCalledTimes(1);
  });
});
