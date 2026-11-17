import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { VisionRoleBinding } from './VisionRoleBinding';

const PROFILES: ChatModelPreset[] = [
  { id: 'glm', label: 'GLM', provider: 'openai-compatible', model: 'glm-4.5', capabilities: ['chat', 'streaming', 'tools'] },
  { id: 'ds', label: 'DeepSeek', provider: 'openai-compatible', model: 'deepseek-flash', capabilities: ['chat', 'streaming', 'tools', 'vision'] },
  { id: 'qv', label: 'Qwen VL', provider: 'dashscope-vision', model: 'qwen-vl-max', capabilities: ['vision'] },
];

describe('BLOCK-150 加映 — 识图模型角色选择器（UI-476 · BLOCK-455 D7 模型对）', () => {
  it('候选 = 声明 vision 的 (渠道, 模型) 对，值用 渠道::模型 格式', () => {
    const { container } = render(<VisionRoleBinding profiles={PROFILES} value="" onChange={() => {}} />);
    const options = [...container.querySelectorAll('option')].map((o) => o.value);
    expect(options).toContain('ds::deepseek-flash');
    expect(options).toContain('qv::qwen-vl-max');
    expect(options).not.toContain('glm::glm-4.5');
    expect(options).not.toContain('ds');
  });

  it('已发现模型逐一对展开：能力按模型解析，未声明 vision 的模型不列', () => {
    const profiles = [
      {
        ...PROFILES[1],
        capabilities: ['chat', 'streaming', 'tools'],
        modelCapabilities: { 'deepseek-flash': ['chat', 'streaming', 'tools', 'vision'] },
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
    expect(options).not.toContain('ds::deepseek-r1');
  });

  it('模型级覆写决定候选（渠道有 vision 但默认模型条目无 → 不列）', () => {
    const profiles = [
      { ...PROFILES[1], modelCapabilities: { 'deepseek-flash': ['chat', 'streaming', 'tools'] } },
    ];
    const { container } = render(<VisionRoleBinding profiles={profiles} value="" onChange={() => {}} />);
    const options = [...container.querySelectorAll('option')].map((o) => o.value);
    expect(options).not.toContain('ds::deepseek-flash');
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

  it('无 vision 模型时显示配置指引（前置诚实）', () => {
    const { container } = render(
      <VisionRoleBinding profiles={[PROFILES[0]]} value="" onChange={() => {}} />,
    );
    expect(container.textContent).toContain('勾选「视觉」能力');
  });
});