/**
 * 试用反馈迭代② HK-01（owner msg_5526ae23113c）：向量配置迁知识空间——
 * 存储兼容（老配置不丢）、embedding 底层链零变化、识图 role 退役。
 */
import { describe, expect, it } from 'vitest';
import { applyEmbeddingBinding, readEmbeddingBinding } from './embeddingBindingMigration';

describe('向量配置迁移（试用反馈②）', () => {
  it('老配置读取不丢：已有 embedding 绑定原样读出', () => {
    expect(readEmbeddingBinding({ model_role_bindings: { embedding: 'ds::bge-m3', chat: 'p1' } })).toBe('ds::bge-m3');
    expect(readEmbeddingBinding(null)).toBe('');
  });

  it('写入只改 embedding 绑定与派生 embed_provider，其它字段逐字保留（底层链零变化）', () => {
    const before = {
      model_role_bindings: { chat: 'p1', embedding: 'old', agent: 'p2' },
      embed_provider: 'old-provider',
      model_profiles: [{ id: 'p1' }],
      model_fallback_enabled: true,
      telemetry_enabled: false,
    };
    const after = applyEmbeddingBinding(before, 'new::bge-m3', 'new-provider');
    expect(after.model_role_bindings).toEqual({ chat: 'p1', embedding: 'new::bge-m3', agent: 'p2' });
    expect(after.embed_provider).toBe('new-provider');
    expect(after.model_profiles).toBe(before.model_profiles);
    expect(after.model_fallback_enabled).toBe(true);
    expect(after.telemetry_enabled).toBe(false);
  });

  it('未给 provider 时不写 embed_provider（不碰底层链）', () => {
    const after = applyEmbeddingBinding({ model_role_bindings: {}, embed_provider: 'keep' }, 'x');
    expect(after.embed_provider).toBe('keep');
  });
});
