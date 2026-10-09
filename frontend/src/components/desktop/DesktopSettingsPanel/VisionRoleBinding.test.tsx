import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { VisionRoleBinding } from './VisionRoleBinding';

const PROFILES = [
  { id: 'glm', label: 'GLM', provider: 'openai-compatible', model: 'glm-4.5', capabilities: ['chat', 'streaming', 'tools'] },
  { id: 'ds', label: 'DeepSeek', provider: 'openai-compatible', model: 'deepseek-flash', capabilities: ['chat', 'streaming', 'tools', 'vision'] },
  { id: 'qv', label: 'Qwen VL', provider: 'dashscope-vision', model: 'qwen-vl-max', capabilities: ['vision'] },
];

describe('BLOCK-150 加映 — 识图模型角色选择器（UI-476）', () => {
  it('只列声明了 vision 能力的渠道（未声明不可选——网关能力门同口径）', () => {
    const { container } = render(<VisionRoleBinding profiles={PROFILES} value="" onChange={() => {}} />);
    const options = [...container.querySelectorAll('option')].map((o) => o.value);
    expect(options).toContain('ds');
    expect(options).toContain('qv');
    expect(options).not.toContain('glm');
  });

  it('选中变化回调携带渠道 id', () => {
    const onChange = vi.fn();
    const { container } = render(<VisionRoleBinding profiles={PROFILES} value="" onChange={onChange} />);
    fireEvent.change(container.querySelector('select')!, { target: { value: 'ds' } });
    expect(onChange).toHaveBeenCalledWith('ds');
  });

  it('无 vision 渠道时显示配置指引（前置诚实）', () => {
    const { container } = render(
      <VisionRoleBinding profiles={[PROFILES[0]]} value="" onChange={() => {}} />,
    );
    expect(container.textContent).toContain('先在下方渠道行勾选「视觉」能力');
  });
});
