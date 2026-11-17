import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelSelectorControls } from './ModelSelectorControls';
import type { ChatModelPreset } from '@/hooks/useAiSettings';

afterEach(cleanup);

const profile: ChatModelPreset = {
  id: 'p1',
  label: 'DeepSeek',
  provider: 'anthropic',
  model: 'm1',
  visible: false,
  defaultThinkingLevel: 'high',
  capabilities: ['chat', 'streaming', 'tools', 'reasoning'],
};

describe('ModelSelectorControls（BLOCK-455 D6：选择器显示 + 思考合并单下拉）', () => {
  it('显示当前隐藏状态，勾选后写回 undefined（恢复默认可见）', () => {
    const onUpdate = vi.fn();
    render(<ModelSelectorControls profile={profile} onUpdate={onUpdate} />);
    const checkbox = screen.getByLabelText<HTMLInputElement>('DeepSeek 在选择器中显示');
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onUpdate).toHaveBeenCalledWith('p1', { visible: undefined });
  });

  it('思考合并下拉：有 reasoning 位 + 默认档 high → 选中「支持 · 默认高」', () => {
    render(<ModelSelectorControls profile={profile} onUpdate={() => {}} />);
    const select = screen.getByLabelText<HTMLSelectElement>('思考能力与默认档');
    expect(select.value).toBe('high');
  });

  it('选「支持 · 不覆盖档位」→ 保留 reasoning 位、清默认档（模型级条目写回）', () => {
    const onUpdate = vi.fn();
    render(<ModelSelectorControls profile={profile} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText('思考能力与默认档'), { target: { value: 'auto' } });
    expect(onUpdate).toHaveBeenCalledWith('p1', {
      modelCapabilities: { m1: ['chat', 'streaming', 'tools', 'reasoning'] },
      defaultThinkingLevel: undefined,
    });
  });

  it('选「不支持思考」→ 从默认模型解析能力移除 reasoning 位并清默认档', () => {
    const onUpdate = vi.fn();
    render(<ModelSelectorControls profile={profile} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText('思考能力与默认档'), { target: { value: 'unsupported' } });
    expect(onUpdate).toHaveBeenCalledWith('p1', {
      modelCapabilities: { m1: ['chat', 'streaming', 'tools'] },
      defaultThinkingLevel: undefined,
    });
  });

  it('无 reasoning 位 → 显示「不支持思考」；选「支持 · 默认标准」补位并写档', () => {
    const onUpdate = vi.fn();
    const noReasoning = { ...profile, capabilities: ['chat', 'streaming', 'tools'], defaultThinkingLevel: undefined };
    render(<ModelSelectorControls profile={noReasoning} onUpdate={onUpdate} />);
    const select = screen.getByLabelText<HTMLSelectElement>('思考能力与默认档');
    expect(select.value).toBe('unsupported');
    fireEvent.change(select, { target: { value: 'standard' } });
    expect(onUpdate).toHaveBeenCalledWith('p1', {
      modelCapabilities: { m1: ['chat', 'streaming', 'tools', 'reasoning'] },
      defaultThinkingLevel: 'standard',
    });
  });

  it('模型级覆写优先于渠道声明（默认模型条目无 reasoning → 不支持）', () => {
    render(
      <ModelSelectorControls
        profile={{ ...profile, modelCapabilities: { m1: ['chat', 'streaming', 'tools'] } }}
        onUpdate={() => {}}
      />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('思考能力与默认档').value).toBe('unsupported');
  });

  it('完全未声明能力的 legacy 档案保持旧宽松语义（显示支持·不覆盖，不误判不支持）', () => {
    const legacy: ChatModelPreset = { id: 'p1', label: 'L', provider: 'openai-compatible', model: 'm1' };
    render(<ModelSelectorControls profile={legacy} onUpdate={() => {}} />);
    const select = screen.getByLabelText<HTMLSelectElement>('思考能力与默认档');
    expect(select.value).toBe('auto');
    expect(select.disabled).toBe(false);
  });

  it('未选默认模型时思考下拉禁用（无模型可声明）', () => {
    render(
      <ModelSelectorControls profile={{ ...profile, model: '', defaultModel: '' }} onUpdate={() => {}} />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('思考能力与默认档').disabled).toBe(true);
  });
});