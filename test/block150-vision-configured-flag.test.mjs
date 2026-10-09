import assert from 'node:assert/strict';
import { test } from 'node:test';

const { computeVisionConfigured } = await import('../core/biof3-server/routes/ai-settings-api.js');

test('BLOCK-150 加映 — vision_configured 能力位三态（注入 getCredential 判据）', () => {
  const settings = {
    model_role_bindings: { vision: 'dashscope-vision' },
    model_profiles: [{ id: 'dashscope-vision', provider: 'dashscope', credentialRef: 'provider:dashscope' }],
  };
  // 有档有凭据 → true
  assert.equal(computeVisionConfigured(settings, () => 'sk-x'), true);
  // 有档无凭据（store 与 env 双空）→ false —— 用户实机形态
  assert.equal(computeVisionConfigured(settings, () => ''), false);
  // 无 vision 档（绑定指向不存在的 profile 且无 roles 声明）→ false
  assert.equal(
    computeVisionConfigured(
      { model_role_bindings: { vision: 'gone' }, model_profiles: [{ id: 'other', provider: 'deepseek' }] },
      () => 'sk-x',
    ),
    false,
  );
  // roles 兜底：绑定缺失但档位 roles 含 vision → 按 roles 解析
  assert.equal(
    computeVisionConfigured(
      { model_role_bindings: {}, model_profiles: [{ id: 'v', provider: 'dashscope', roles: ['vision'], credentialRef: 'provider:dashscope' }] },
      () => 'sk-x',
    ),
    true,
  );
});
