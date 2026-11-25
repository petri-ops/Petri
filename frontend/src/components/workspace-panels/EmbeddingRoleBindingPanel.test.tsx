/**
 * 试用反馈② HK-01（容器层）：向量配置迁知识空间——老配置读取不丢、保存只改绑定+派生 provider。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();
const saveMock = vi.fn();
vi.mock('@/lib/desktopBridge', () => ({
  getBridge: () => ({ get: getMock, save: saveMock }),
}));

afterEach(() => { cleanup(); getMock.mockReset(); saveMock.mockReset(); });

import { EmbeddingRoleBindingPanel } from './EmbeddingRoleBindingPanel';
import type { EmbeddingBindingSettings } from './embeddingBindingMigration';

describe('EmbeddingRoleBindingPanel（知识空间向量配置）', () => {
  it('老配置读取不丢：展示既有 embedding 绑定', async () => {
    getMock.mockResolvedValue({
      model_role_bindings: { chat: 'p1', embedding: 'ds::bge-m3' },
      model_profiles: [{ id: 'ds', provider: 'openai-compatible', model: 'bge-m3', capabilities: ['embedding'] }],
      telemetry_enabled: true,
    });
    render(<EmbeddingRoleBindingPanel />);
    const select = await screen.findByLabelText<HTMLSelectElement>('向量模型（embedding 角色）');
    expect(select.value).toBe('ds::bge-m3');
  });

  it('保存只改 embedding 绑定与派生 provider，其它字段原样保留', async () => {
    const settings = {
      model_role_bindings: { chat: 'p1', embedding: 'old' },
      model_profiles: [{ id: 'ds', provider: 'openai-compatible', model: 'bge-m3', capabilities: ['embedding'] }],
      telemetry_enabled: true,
    };
    getMock.mockResolvedValue(settings);
    saveMock.mockResolvedValue({ ok: true });
    render(<EmbeddingRoleBindingPanel />);
    const select = await screen.findByLabelText<HTMLSelectElement>('向量模型（embedding 角色）');
    fireEvent.change(select, { target: { value: 'ds::bge-m3' } });
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const saved = saveMock.mock.calls[0][0] as EmbeddingBindingSettings;
    expect(saved.model_role_bindings).toEqual({ chat: 'p1', embedding: 'ds::bge-m3' });
    expect(saved.embed_provider).toBe('openai-compatible');
    expect(saved.telemetry_enabled).toBe(true);
  });
});
