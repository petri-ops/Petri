import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EndpointRowDetail } from './EndpointRowDetail';
import type { ChatModelPreset } from '@/hooks/useAiSettings';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const profile: ChatModelPreset = {
  id: 'p1',
  label: 'DeepSeek',
  provider: 'openai-compatible',
  model: 'deepseek-chat',
  defaultModel: 'deepseek-chat',
  capabilities: ['tools'],
};

describe('EndpointRowDetail（BLOCK-518 声明面退役：视觉/思考列隐藏，向量列+探测钮保留）', () => {
  it('视觉/思考勾选位不渲染（声明位退役）；向量勾选位保留', () => {
    render(
      <EndpointRowDetail
        profile={profile}
        models={['deepseek-chat', 'deepseek-reasoner', 'bge-m3']}
        onUpdate={() => {}}
      />,
    );
    expect(screen.queryByLabelText('DeepSeek deepseek-chat 支持识图（视觉输入）')).toBeNull();
    expect(screen.queryByLabelText('DeepSeek deepseek-chat 支持思考档位')).toBeNull();
    expect(screen.queryByLabelText('DeepSeek deepseek-reasoner 支持识图（视觉输入）')).toBeNull();
    expect(screen.queryByLabelText('DeepSeek deepseek-reasoner 支持思考档位')).toBeNull();
    // 红线：embedding 勾选位必留（渠道默认 + 逐模型）。
    expect(screen.getByLabelText('DeepSeek deepseek-chat 支持向量化（embedding）')).toBeTruthy();
    expect(screen.getByLabelText('DeepSeek bge-m3 支持向量化（embedding）')).toBeTruthy();
    // 探测钮保留（默认模型 + 逐模型）。
    expect(screen.getByLabelText('DeepSeek 探测 deepseek-chat 思考能力')).toBeTruthy();
    expect(screen.getByLabelText('DeepSeek 探测 bge-m3 思考能力')).toBeTruthy();
    // 表头列集 = 模型/向量/探测。
    const headers = [...screen.getAllByText(/^(模型|向量|探测)$/)].map((el) => el.textContent);
    expect(headers).toContain('向量');
    expect(headers).not.toContain('视觉');
    expect(headers).not.toContain('思考');
  });

  it('能力表含「渠道默认（兜底）」行：勾选写渠道级 capabilities（旧语义保留）', () => {
    const onUpdate = vi.fn();
    render(<EndpointRowDetail profile={profile} models={['deepseek-chat']} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('DeepSeek 渠道默认 支持向量化（embedding）'));
    expect(onUpdate).toHaveBeenCalledWith('p1', {
      capabilities: ['tools', 'embedding'],
    });
  });

  it('已发现的其他模型逐行可编辑（写该模型的 modelCapabilities 条目）', () => {
    const onUpdate = vi.fn();
    render(
      <EndpointRowDetail
        profile={profile}
        models={['deepseek-chat', 'bge-m3']}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByLabelText('DeepSeek bge-m3 支持向量化（embedding）'));
    expect(onUpdate).toHaveBeenCalledWith('p1', {
      modelCapabilities: { 'bge-m3': ['tools', 'embedding'] },
    });
    // 默认模型不在逐模型表里重复出现（其能力位由上方控件行编辑，避免同一位两处视图）
    expect(screen.queryByLabelText('DeepSeek 渠道默认 支持向量化（embedding）')).toBeTruthy();
  });

  it('未发现其他模型时给出诚实提示', () => {
    render(<EndpointRowDetail profile={profile} models={[]} onUpdate={() => {}} />);
    expect(screen.getByRole('note').textContent).toContain('测试连通性');
  });

  it('探测到思考证据 → 仅诚实展示证据，不物化 reasoning 声明位（声明面退役）', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      ok: true,
      verdict: 'supported',
      evidence: { requestId: 'req-1', reasoningTokens: 4, observedAt: '2026-11-17T00:00:00.000Z' },
    }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const onUpdate = vi.fn();
    render(<EndpointRowDetail profile={profile} models={['deepseek-chat', 'model-x']} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByLabelText('DeepSeek 探测 model-x 思考能力'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('探测到思考证据'));
    expect(fetchMock).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('req-1');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('探测无证据时提示未知', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      ok: true,
      verdict: 'unknown',
      evidence: { requestId: 'req-2', reasoningTokens: 0, observedAt: '2026-11-17T00:00:00.000Z' },
    }), { status: 200 }))));
    const onUpdate = vi.fn();
    render(<EndpointRowDetail profile={profile} models={['deepseek-chat', 'model-y']} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByLabelText('DeepSeek 探测 model-y 思考能力'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('未找到明确思考证据'));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('探测 unsupported → 明确告知该模型不支持思考档位', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      ok: true,
      verdict: 'unsupported',
      evidence: { requestId: 'req-3', reasoningTokens: 0, observedAt: '2026-11-17T00:00:00.000Z' },
    }), { status: 200 }))));
    const onUpdate = vi.fn();
    render(<EndpointRowDetail profile={profile} models={['deepseek-chat', 'model-z']} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByLabelText('DeepSeek 探测 model-z 思考能力'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('不支持思考档位'));
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
