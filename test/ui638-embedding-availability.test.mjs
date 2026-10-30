/**
 * UI-638 加映四 — embedding 角色可用性判定（红绿先行）。
 * 旧实现硬编码只看 DashScope key，换绑本地/其它 provider 后会被误判不可用。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { embeddingRoleAvailable } = require('../core/petri-server/helpers/embedding-availability.js');

const local = { id: 'ollama-embedding', provider: 'ollama', capabilities: ['embedding'] };
const cloud = { id: 'ds-embed', provider: 'dashscope', capabilities: ['embedding'] };

describe('embeddingRoleAvailable', () => {
  it('本地 provider 无需 key 即可用', () => {
    assert.equal(embeddingRoleAvailable({
      model_role_bindings: { embedding: 'ollama-embedding' },
      model_profiles: [local],
      credential_status: {},
    }), true);
  });

  it('云端 provider 需要对应凭据', () => {
    const base = { model_role_bindings: { embedding: 'ds-embed' }, model_profiles: [cloud] };
    assert.equal(embeddingRoleAvailable({ ...base, credential_status: {} }), false);
    assert.equal(embeddingRoleAvailable({ ...base, credential_status: { dashscope: true } }), true);
  });

  it('未绑定 / 档案缺 embedding 能力 / 档案不存在 → 不可用', () => {
    assert.equal(embeddingRoleAvailable({ model_role_bindings: {}, model_profiles: [local] }), false);
    assert.equal(embeddingRoleAvailable({
      model_role_bindings: { embedding: 'chat-only' },
      model_profiles: [{ id: 'chat-only', provider: 'ollama', capabilities: ['chat'] }],
    }), false);
    assert.equal(embeddingRoleAvailable({
      model_role_bindings: { embedding: 'ghost' },
      model_profiles: [local],
    }), false);
    assert.equal(embeddingRoleAvailable(null), false);
  });
});
