import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EndpointRowDetail } from './EndpointRowDetail';
import type { ChatModelPreset } from '@/hooks/useAiSettings';

afterEach(cleanup);

const profile: ChatModelPreset = {
  id: 'p1',
  label: 'DeepSeek',
  provider: 'openai-compatible',
  model: 'deepseek-chat',
  defaultModel: 'deepseek-chat',
  capabilities: ['chat', 'streaming', 'tools'],
};

describe('EndpointRowDetail（BLOCK-455 D6 行详情：默认模型控件 + 逐模型能力表）', () => {
  it('默认模型的视觉/向量勾选写模型级条目（不动渠道声明）', () => {
    const onUpdate = vi.fn();
    render(<EndpointRowDetail profile={profile} models={['deepseek-chat']} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('DeepSeek deepseek-chat 支持识图（视觉输入）'));
    expect(onUpdate).toHaveBeenCalledWith('p1', {
      modelCapabilities: { 'deepseek-chat': ['chat', 'streaming', 'tools', 'vision'] },
    });
  });

  it('能力表含「渠道默认（兜底）」行：勾选写渠道级 capabilities（旧语义保留）', () => {
    const onUpdate = vi.fn();
    render(<EndpointRowDetail profile={profile} models={['deepseek-chat']} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('DeepSeek 渠道默认 支持向量化（embedding）'));
    expect(onUpdate).toHaveBeenCalledWith('p1', {
      capabilities: ['chat', 'streaming', 'tools', 'embedding'],
    });
  });

  it('已发现的其他模型逐行可编辑（写该模型的 modelCapabilities 条目）', () => {
    const onUpdate = vi.fn();
    render(
      <EndpointRowDetail
        profile={profile}
        models={['deepseek-chat', 'deepseek-reasoner']}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByLabelText('DeepSeek deepseek-reasoner 支持思考档位'));
    expect(onUpdate).toHaveBeenCalledWith('p1', {
      modelCapabilities: { 'deepseek-reasoner': ['chat', 'streaming', 'tools', 'reasoning'] },
    });
    // 默认模型不在逐模型表里重复出现（其能力位由上方控件行编辑，避免同一位两处视图）
    expect(screen.queryByLabelText('DeepSeek deepseek-chat 支持思考档位')).toBeNull();
  });

  it('模型级覆写优先：渠道声明 vision 但默认模型条目无 → 视觉勾选为未选', () => {
    render(
      <EndpointRowDetail
        profile={{
          ...profile,
          capabilities: ['chat', 'streaming', 'tools', 'vision'],
          modelCapabilities: { 'deepseek-chat': ['chat', 'streaming', 'tools'] },
        }}
        models={['deepseek-chat']}
        onUpdate={() => {}}
      />,
    );
    expect(screen.getByLabelText<HTMLInputElement>('DeepSeek deepseek-chat 支持识图（视觉输入）').checked).toBe(false);
  });

  it('未发现其他模型时给出诚实提示', () => {
    render(<EndpointRowDetail profile={profile} models={[]} onUpdate={() => {}} />);
    expect(screen.getByRole('note').textContent).toContain('测试连通性');
  });
});