import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { VisionRoleBinding } from './VisionRoleBinding';

const PROFILES: ChatModelPreset[] = [
  { id: 'glm', label: 'GLM', provider: 'openai-compatible', model: 'glm-4.5', capabilities: ['tools'] },
  { id: 'ds', label: 'DeepSeek', provider: 'openai-compatible', model: 'deepseek-flash', capabilities: ['tools'] },
  { id: 'qv', label: 'Qwen VL', provider: 'dashscope-vision', model: 'qwen-vl-max', capabilities: [] },
];

describe('BLOCK-518 声明面退役 — 识图模型角色选择器（槽位保留、能力过滤撤除）', () => {
  it('候选 = 全部 (渠道, 模型) 对（不过滤能力位），值用 渠道::模型 格式', () => {
    const { container } = render(<VisionRoleBinding profiles={PROFILES} value="" onChange={() => {}} />);
    const options = [...container.querySelectorAll('option')].map((o) => o.value);
    expect(options).toContain('glm::glm-4.5');
    expect(options).toContain('ds::deepseek-flash');
    expect(options).toContain('qv::qwen-vl-max');
    expect(options).not.toContain('ds');
  });

  it('已发现模型逐一对展开：全部列出（不再按模型级覆写过滤）', () => {
    const profiles = [
      {
        ...PROFILES[1],
        modelCapabilities: { 'deepseek-flash': ['tools'] },
      },
    ];
    const { container } = render(
      <VisionRoleBinding
        profiles={profiles}
        availableModels={{ ds: ['deepseek-flash', 'deepseek-r1'] }}
        value=""
        onChange={() => {}}
      />,
    );
    const options = [...container.querySelectorAll('option')].map((o) => o.value);
    expect(options).toContain('ds::deepseek-flash');
    expect(options).toContain('ds::deepseek-r1');
  });

  it('选中变化回调携带 渠道::模型 对', () => {
    const onChange = vi.fn();
    const { container } = render(<VisionRoleBinding profiles={PROFILES} value="" onChange={onChange} />);
    fireEvent.change(container.querySelector('select')!, { target: { value: 'ds::deepseek-flash' } });
    expect(onChange).toHaveBeenCalledWith('ds::deepseek-flash');
  });

  it('legacy 裸渠道绑定归一为对显示（向后兼容）', () => {
    const { container } = render(<VisionRoleBinding profiles={PROFILES} value="ds" onChange={() => {}} />);
    expect(container.querySelector('select')!.value).toBe('ds::deepseek-flash');
  });

  it('无渠道时显示配置指引（槽位=用户指定处理图片的模型）', () => {
    const { container } = render(
      <VisionRoleBinding profiles={[]} value="" onChange={() => {}} />,
    );
    expect(container.textContent).toContain('暂无可选模型');
  });
});
