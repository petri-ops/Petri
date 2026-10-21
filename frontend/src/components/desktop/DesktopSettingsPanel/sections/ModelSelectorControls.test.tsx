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
};

describe('ModelSelectorControls', () => {
  it('显示当前隐藏/默认思考状态，勾选后写回 undefined（恢复默认可见）', () => {
    const onUpdate = vi.fn();
    render(<ModelSelectorControls profile={profile} onUpdate={onUpdate} />);
    const checkbox = screen.getByLabelText<HTMLInputElement>('DeepSeek 在选择器中显示');
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onUpdate).toHaveBeenCalledWith('p1', { visible: undefined });

    const select = screen.getByLabelText<HTMLSelectElement>('默认思考档');
    expect(select.value).toBe('high');
    fireEvent.change(select, { target: { value: 'off' } });
    expect(onUpdate).toHaveBeenCalledWith('p1', { defaultThinkingLevel: 'off' });
  });

  it('默认可见且不覆盖思考档', () => {
    render(
      <ModelSelectorControls
        profile={{ ...profile, visible: undefined, defaultThinkingLevel: undefined }}
        onUpdate={() => {}}
      />
    );
    expect(screen.getByLabelText<HTMLInputElement>('DeepSeek 在选择器中显示').checked).toBe(true);
    expect(screen.getByLabelText<HTMLSelectElement>('默认思考档').value).toBe('');
  });
});
