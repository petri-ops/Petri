/**
 * BLOCK-518 转型 — 能力声明收窄契约（HK-01 红绿先行）。
 *
 * 方案源：acceptance/model-capability-simplification/SIMPLIFICATION-PLAN-2026-11-25.md
 * §二（owner 2026-11-25「按你的推荐来，冲吧」msg_884f86238075 批准阶段一+二）。
 *
 * 契约：
 *   1. MODEL_CAPABILITIES 白名单收窄为 ['tools','embedding']——chat/streaming/vision/reasoning
 *      不再是声明位；normalizeModelProfile 归一时丢弃（旧数据迁移=收窄，embedding/tools 必留）。
 *   2. BLOCK-518 批量清除转型销账：modelCapabilities 物化覆写条目收窄后为空的整条清除
 *      （vision/reasoning 位失去载体）；显式空数组（该模型无任何能力）保留。
 *   3. 角色能力门收敛：仅 agent→tools、embedding→embedding 保持硬门（砍了会静默坏）；
 *      chat 族/vision 槽位不再做能力过滤（多模态时代声明面退役，上游诚实报错）。
 *   4. 红线：embedding/tools 必留——normalizeRoleBindings 的 embedding 回退仍按 embedding 位挑选。
 *   5. 零配置默认档案：dashscope-vision（能力位为空）不再自动注入。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_CAPABILITIES,
  MODEL_ROLES,
  normalizeModelProfile,
  normalizeModelConfig,
  resolveModelProfile,
  validateModelConfig,
  inferModelCapabilities,
} from '../core/shared-backend/llm-providers/model-profile.js';

describe('BLOCK-518 能力白名单收窄', () => {
  it('MODEL_CAPABILITIES = [tools, embedding]', () => {
    assert.deepEqual([...MODEL_CAPABILITIES], ['tools', 'embedding']);
  });

  it('渠道 capabilities 收窄：vision/reasoning/chat/streaming 位丢弃，tools/embedding 必留', () => {
    const narrowed = normalizeModelProfile({
      id: 'p1', provider: 'openai-compatible', model: 'm1',
      capabilities: ['chat', 'streaming', 'tools', 'vision', 'reasoning'],
    });
    assert.deepEqual(narrowed.capabilities, ['tools']);

    const embeddingKept = normalizeModelProfile({
      id: 'p2', provider: 'openai-compatible', model: 'm2',
      capabilities: ['chat', 'streaming', 'tools', 'vision', 'embedding'],
    });
    assert.deepEqual(embeddingKept.capabilities, ['tools', 'embedding']);
  });

  it('旧数据声明收窄为空 → 回落 provider 推断（deepseek/openai 系=tools，dashscope=embedding）', () => {
    const chatOnly = normalizeModelProfile({
      id: 'p3', provider: 'deepseek', model: 'm3', capabilities: ['chat'],
    });
    assert.deepEqual(chatOnly.capabilities, ['tools']);

    const dashscope = normalizeModelProfile({
      id: 'p4', provider: 'dashscope', model: 'm4', capabilities: ['chat'],
    });
    assert.deepEqual(dashscope.capabilities, ['embedding']);
  });

  it('BLOCK-518 销账：物化覆写条目收窄后为空 → 整条清除；embedding 位保留；显式空数组保留', () => {
    const normalized = normalizeModelProfile({
      id: 'p5', provider: 'openai-compatible', model: 'm5',
      capabilities: ['tools'],
      modelCapabilities: {
        'vl-model': ['chat', 'streaming', 'tools', 'vision'],      // 收窄后 ['tools'] 保留
        'reasoner': ['chat', 'streaming', 'reasoning'],            // 收窄后空 → 整条清除（销账）
        'bge-m3': ['embedding'],                                   // embedding 位保留
        'no-cap-model': [],                                        // 显式空数组=该模型无能力，保留
      },
    });
    assert.deepEqual(normalized.modelCapabilities['vl-model'], ['tools']);
    assert.equal('reasoner' in normalized.modelCapabilities, false);
    assert.deepEqual(normalized.modelCapabilities['bge-m3'], ['embedding']);
    assert.deepEqual(normalized.modelCapabilities['no-cap-model'], []);
  });

  it('inferModelCapabilities 收窄：向量系=[embedding]，其余=[tools]', () => {
    assert.deepEqual(inferModelCapabilities('bge-m3'), ['embedding']);
    assert.deepEqual(inferModelCapabilities('text-embedding-v3'), ['embedding']);
    for (const name of ['gpt-4o', 'qwen-vl-max', 'deepseek-reasoner', 'glm-5.3-flash', 'deepseek-chat', '']) {
      assert.deepEqual(inferModelCapabilities(name), ['tools'], name);
    }
  });
});

describe('BLOCK-518 角色能力门收敛（tools/embedding 硬门必留，chat 族/vision 槽位撤门）', () => {
  const settings = {
    model_profiles: [{
      id: 'ep1', provider: 'openai-compatible', model: 'any-model',
      capabilities: ['tools'],
      modelCapabilities: {
        'no-tools-model': [],       // 显式无能力
        'bge-m3': ['embedding'],
      },
    }],
    model_role_bindings: {
      chat: 'ep1', agent: 'ep1', planner: 'ep1',
      vision: 'ep1::no-tools-model', embedding: 'ep1::bge-m3',
      summary: 'ep1', report: 'ep1', explanation: 'ep1',
    },
  };

  it('vision 槽位撤门：绑定无 vision 声明的模型不再报 mismatch（槽位保留、过滤退役）', () => {
    const config = normalizeModelConfig(settings);
    const vision = resolveModelProfile(config, 'vision');
    assert.equal(vision.error, undefined);
    assert.equal(vision.model, 'no-tools-model');
    const diagnostics = validateModelConfig(config);
    assert.ok(!diagnostics.some((d) => d.code === 'model_capability_mismatch' && d.role === 'vision'));
  });

  it('chat 族撤门：chat/planner/summary/report/explanation 解析无 mismatch', () => {
    const config = normalizeModelConfig(settings);
    for (const role of ['chat', 'planner', 'summary', 'report', 'explanation']) {
      assert.equal(resolveModelProfile(config, role).error, undefined, role);
    }
    const diagnostics = validateModelConfig(config);
    assert.ok(!diagnostics.some((d) => d.code === 'model_capability_mismatch'
      && ['chat', 'planner', 'summary', 'report', 'explanation'].includes(d.role)));
  });

  it('红线 agent：显式无 tools 的模型绑 agent 仍诚实 mismatch', () => {
    const config = normalizeModelConfig(settings);
    const agent = resolveModelProfile(config, 'agent', 'ep1::no-tools-model');
    assert.equal(agent.error, 'model_capability_mismatch');
    assert.equal(agent.requiredCapability, 'tools');
  });

  it('红线 embedding：绑定向量角色仍要求 embedding 位（mismatch 诚实）', () => {
    const config = normalizeModelConfig(settings);
    const embedding = resolveModelProfile(config, 'embedding', 'ep1::no-tools-model');
    assert.equal(embedding.error, 'model_capability_mismatch');
    assert.equal(embedding.requiredCapability, 'embedding');
    assert.equal(resolveModelProfile(config, 'embedding').model, 'bge-m3');
  });

  it('MODEL_ROLES 不含能力位的角色门=tools/embedding 两值（含 null 槽位）', () => {
    // ROLE_CAPABILITY 收敛：chat/planner/vision/summary/report/explanation 撤门，
    // agent=tools、embedding=embedding 由上面两条红线钉死；此处钉角色槽位数量不减（阶段三另议）。
    assert.equal(MODEL_ROLES.length, 8);
  });
});

describe('BLOCK-518 绑定回退与零配置', () => {
  it('无能力门角色（vision/chat）缺显式绑定时回退默认档案或首个档案；embedding 回退仍按 embedding 位', () => {
    const config = normalizeModelConfig({
      model_profiles: [
        { id: 'a', provider: 'openai-compatible', model: 'text-only', capabilities: ['tools'], modelCapabilities: { 'text-only': [] } },
        { id: 'b', provider: 'openai-compatible', model: 'vl-model', capabilities: ['tools'] },
      ],
    });
    // vision 无能力门 → 回退按确定性顺序（默认档案缺席 → 首个档案 a）
    assert.equal(config.roleBindings.vision, 'a');
    // agent 有 tools 门 → a 显式无能力、b 有 tools → 回退 b
    assert.equal(config.roleBindings.agent, 'b');
    // embedding 门 → 无 embedding 档案 → 不回退（诚实 unbound）
    assert.equal(config.roleBindings.embedding, undefined);
    assert.ok(config.diagnostics.some((d) => d.code === 'model_role_unbound' && d.role === 'embedding'));
  });

  it('零配置：deepseek-chat（tools）+ dashscope-embedding（embedding）注入；dashscope-vision 不再自动注入', () => {
    const config = normalizeModelConfig({});
    const ids = config.profiles.map((p) => p.id);
    assert.ok(ids.includes('deepseek-chat'));
    assert.ok(ids.includes('dashscope-embedding'));
    assert.ok(!ids.includes('dashscope-vision'), 'dashscope-vision 能力位为空，不再自动注入');
    const deepseek = config.profiles.find((p) => p.id === 'deepseek-chat');
    assert.deepEqual(deepseek.capabilities, ['tools']);
    const embed = config.profiles.find((p) => p.id === 'dashscope-embedding');
    assert.deepEqual(embed.capabilities, ['embedding']);
    assert.equal(config.roleBindings.vision, 'deepseek-chat');
    assert.equal(config.roleBindings.embedding, 'dashscope-embedding');
  });
});
