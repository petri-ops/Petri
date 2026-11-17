import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingRoleBinding, hasEmbeddingCapability } from './EmbeddingRoleBinding';

const profiles = [
  { id: 'ollama-embedding', label: '本地 bge-m3', provider: 'ollama', model: 'bge-m3', capabilities: ['embedding'] },
  { id: 'deepseek-chat', label: 'DeepSeek', provider: 'deepseek', model: 'deepseek-flash', capabilities: ['chat', 'vision'] },
] as never;

afterEach(() => cleanup());

describe('EmbeddingRoleBinding（向量模型换绑 · BLOCK-455 D7 模型对）', () => {
  it('候选 = 声明 embedding 的 (渠道, 模型) 对；legacy 裸绑定归一为对显示', () => {
    render(<EmbeddingRoleBinding profiles={profiles} value="ollama-embedding" onChange={() => {}} />);
    const select = screen.getByLabelText<HTMLSelectElement>('向量模型（embedding 角色）');
    expect(select.value).toBe('ollama-embedding::bge-m3');
    const labels = [...select.options].map((o) => o.textContent || '');
    expect(labels.some((t) => t.includes('本地 bge-m3'))).toBe(true);
    expect(labels.some((t) => t.includes('DeepSeek'))).toBe(false);
  });

  it('已发现模型逐一对展开：同渠道只列有 embedding 的模型', () => {
    const mixed = [
      {
        id: 'local', label: '本地', provider: 'ollama', model: 'llama3', capabilities: ['chat'],
        // 发现时推断预填的显式条目（运行时只读显式存储，不做隐式推断）
        modelCapabilities: { 'bge-m3': ['embedding'] },
      },
    ] as never;
    render(
      <EmbeddingRoleBinding
        profiles={mixed}
        availableModels={{ local: ['llama3', 'bge-m3'] }}
        value=""
        onChange={() => {}}
      />,
    );
    const select = screen.getByLabelText<HTMLSelectElement>('向量模型（embedding 角色）');
    const values = [...select.options].map((o) => o.value);
    expect(values).toContain('local::bge-m3');
    expect(values).not.toContain('local::llama3');
  });

  it('切换触发 onChange 携带模型对；未绑定选项存在', () => {
    const onChange = vi.fn();
    render(<EmbeddingRoleBinding profiles={profiles} value="" onChange={onChange} />);
    const select = screen.getByLabelText<HTMLSelectElement>('向量模型（embedding 角色）');
    expect([...select.options].some((o) => o.value === '')).toBe(true);
    fireEvent.change(select, { target: { value: 'ollama-embedding::bge-m3' } });
    expect(onChange).toHaveBeenCalledWith('ollama-embedding::bge-m3');
  });

  it('无向量模型时禁用并给出指引（1024 维要求）', () => {
    render(<EmbeddingRoleBinding profiles={[profiles[1]]} value="" onChange={() => {}} />);
    expect(screen.getByLabelText<HTMLSelectElement>('向量模型（embedding 角色）').disabled).toBe(true);
    expect(screen.getByRole('note').textContent).toContain('1024');
  });

  it('hasEmbeddingCapability 按渠道默认模型解析判定', () => {
    expect(hasEmbeddingCapability({ capabilities: ['embedding'] } as never)).toBe(true);
    expect(hasEmbeddingCapability({ capabilities: ['chat'] } as never)).toBe(false);
    expect(hasEmbeddingCapability({} as never)).toBe(false);
    expect(hasEmbeddingCapability({
      model: 'bge-m3',
      capabilities: ['chat'],
      modelCapabilities: { 'bge-m3': ['embedding'] },
    } as never)).toBe(true);
  });
});