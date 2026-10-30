import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingRoleBinding, hasEmbeddingCapability } from './EmbeddingRoleBinding';

const profiles = [
  { id: 'ollama-embedding', label: '本地 bge-m3', provider: 'ollama', model: 'bge-m3', capabilities: ['embedding'] },
  { id: 'deepseek-chat', label: 'DeepSeek', provider: 'deepseek', model: 'deepseek-flash', capabilities: ['chat', 'vision'] },
] as never;

afterEach(() => cleanup());

describe('EmbeddingRoleBinding（向量模型换绑）', () => {
  it('只列出声明 embedding 能力的渠道，当前绑定可见', () => {
    render(<EmbeddingRoleBinding profiles={profiles} value="ollama-embedding" onChange={() => {}} />);
    const select = screen.getByLabelText<HTMLSelectElement>('向量模型（embedding 角色）');
    expect(select.value).toBe('ollama-embedding');
    const labels = [...select.options].map((o) => o.textContent || '');
    expect(labels.some((t) => t.includes('本地 bge-m3'))).toBe(true);
    expect(labels.some((t) => t.includes('DeepSeek'))).toBe(false);
  });

  it('切换触发 onChange；未绑定选项存在', () => {
    const onChange = vi.fn();
    render(<EmbeddingRoleBinding profiles={profiles} value="" onChange={onChange} />);
    const select = screen.getByLabelText<HTMLSelectElement>('向量模型（embedding 角色）');
    expect([...select.options].some((o) => o.value === '')).toBe(true);
    fireEvent.change(select, { target: { value: 'ollama-embedding' } });
    expect(onChange).toHaveBeenCalledWith('ollama-embedding');
  });

  it('无向量渠道时禁用并给出指引（1024 维要求）', () => {
    render(<EmbeddingRoleBinding profiles={[profiles[1]]} value="" onChange={() => {}} />);
    expect(screen.getByLabelText<HTMLSelectElement>('向量模型（embedding 角色）').disabled).toBe(true);
    expect(screen.getByRole('note').textContent).toContain('1024');
  });

  it('hasEmbeddingCapability 判定', () => {
    expect(hasEmbeddingCapability({ capabilities: ['embedding'] } as never)).toBe(true);
    expect(hasEmbeddingCapability({ capabilities: ['chat'] } as never)).toBe(false);
    expect(hasEmbeddingCapability({} as never)).toBe(false);
  });
});
