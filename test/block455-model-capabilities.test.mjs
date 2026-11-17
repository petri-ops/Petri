/**
 * BLOCK-455 P1 — 模型级能力声明内核契约（HK-01 红绿先行）。
 *
 * 根治对象：能力声明在渠道级、模型可换 → 能力位与真实请求模型脱节。
 * 契约：
 *   1. resolveModelCapabilities 单源：modelCapabilities[model] 显式覆写 > 渠道 capabilities 兜底；
 *      无覆写的旧数据行为逐字不变（零迁移）。
 *   2. inferModelCapabilities 名称启发式（发现时预填用，非运行时隐式行为）。
 *   3. normalizeModelProfile 清洗 modelCapabilities（未知能力位丢弃）。
 *   4. 角色绑定支持 `profileId::encodeURIComponent(model)` 对（裸 profileId=渠道默认模型，向后兼容）；
 *      能力校验/诊断按解析出的模型能力。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveModelCapabilities,
  inferModelCapabilities,
  parseModelBinding,
  normalizeModelProfile,
  normalizeModelConfig,
  resolveModelProfile,
  validateModelConfig,
} from '../core/shared-backend/llm-providers/model-profile.js';

describe('BLOCK-455 resolveModelCapabilities 单源', () => {
  const profile = {
    capabilities: ['chat', 'streaming', 'tools', 'vision'],
    modelCapabilities: {
      'text-only-model': ['chat', 'streaming', 'tools'],
      'embed-model': ['embedding'],
    },
  };

  it('无覆写 → 渠道 capabilities 兜底（旧数据零行为变化）', () => {
    assert.deepEqual(
      resolveModelCapabilities(profile, 'unknown-model'),
      ['chat', 'streaming', 'tools', 'vision'],
    );
    assert.deepEqual(
      resolveModelCapabilities({ capabilities: ['chat'] }, 'm'),
      ['chat'],
    );
  });

  it('显式覆写优先（含显式空数组=该模型无任何能力）', () => {
    assert.deepEqual(
      resolveModelCapabilities(profile, 'text-only-model'),
      ['chat', 'streaming', 'tools'],
    );
    assert.deepEqual(resolveModelCapabilities(profile, 'embed-model'), ['embedding']);
    assert.deepEqual(
      resolveModelCapabilities({ capabilities: ['chat'], modelCapabilities: { m: [] } }, 'm'),
      [],
    );
  });

  it('缺省模型名 → 渠道兜底；非法输入不抛错', () => {
    assert.deepEqual(resolveModelCapabilities(profile, undefined), profile.capabilities);
    assert.deepEqual(resolveModelCapabilities(null, 'm'), []);
    assert.deepEqual(resolveModelCapabilities({}, 'm'), []);
  });
});

describe('BLOCK-455 inferModelCapabilities 名称启发式', () => {
  it('视觉系模型名 → 含 vision 的聊天能力集', () => {
    for (const name of ['qwen-vl-max', 'gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-5', 'gemini-2.5-pro', 'qvq-max']) {
      const caps = inferModelCapabilities(name);
      assert.ok(caps.includes('vision'), `${name} 应推断 vision`);
      assert.ok(caps.includes('chat'), `${name} 应保留 chat`);
    }
  });

  it('思考系模型名 → 含 reasoning', () => {
    for (const name of ['deepseek-reasoner', 'o3-mini', 'o1-preview', 'qwq-32b', 'kimi-k2-thinking', 'magistral-medium']) {
      assert.ok(inferModelCapabilities(name).includes('reasoning'), `${name} 应推断 reasoning`);
    }
  });

  it('向量系模型名 → 仅 embedding（不是聊天模型）', () => {
    for (const name of ['bge-m3', 'text-embedding-v3', 'text-embedding-3-small', 'gte-large']) {
      assert.deepEqual(inferModelCapabilities(name), ['embedding']);
    }
  });

  it('普通聊天模型名 → 基础集，不滥猜', () => {
    for (const name of ['deepseek-chat', 'llama-3-70b', 'qwen2.5-72b-instruct', '']) {
      assert.deepEqual(inferModelCapabilities(name), ['chat', 'streaming', 'tools']);
    }
  });
});

describe('BLOCK-455 normalizeModelProfile 清洗 modelCapabilities', () => {
  it('保留合法覆写、丢弃未知能力位与非对象输入', () => {
    const normalized = normalizeModelProfile({
      id: 'p1', provider: 'openai-compatible', model: 'gpt-4o',
      capabilities: ['chat', 'streaming', 'tools'],
      modelCapabilities: {
        'gpt-4o': ['chat', 'streaming', 'tools', 'vision', 'bogus'],
        'bge-m3': ['embedding'],
      },
    });
    assert.deepEqual(normalized.modelCapabilities['gpt-4o'], ['chat', 'streaming', 'tools', 'vision']);
    assert.deepEqual(normalized.modelCapabilities['bge-m3'], ['embedding']);
    const noMap = normalizeModelProfile({ id: 'p2', provider: 'openai-compatible', model: 'm', modelCapabilities: 'bad' });
    assert.equal(noMap.modelCapabilities, undefined);
  });

  it('无 modelCapabilities 的旧档案归一后不长出该字段（零迁移）', () => {
    const normalized = normalizeModelProfile({ id: 'p3', provider: 'openai-compatible', model: 'm', capabilities: ['chat'] });
    assert.equal(normalized.modelCapabilities, undefined);
    assert.deepEqual(normalized.capabilities, ['chat']);
  });
});

describe('BLOCK-455 角色绑定 渠道::模型 对', () => {
  it('parseModelBinding：裸 id / 对 / 编码模型名', () => {
    assert.deepEqual(parseModelBinding('p1'), { profileId: 'p1', model: undefined });
    assert.deepEqual(parseModelBinding('p1::gpt-4o'), { profileId: 'p1', model: 'gpt-4o' });
    assert.deepEqual(parseModelBinding('p1::model%2Fa'), { profileId: 'p1', model: 'model/a' });
    assert.deepEqual(parseModelBinding(''), { profileId: '', model: undefined });
  });

  const settings = {
    model_profiles: [{
      id: 'ep1', provider: 'openai-compatible', model: 'gpt-4o',
      capabilities: ['chat', 'streaming', 'tools', 'vision'],
      modelCapabilities: {
        'gpt-4o': ['chat', 'streaming', 'tools', 'vision'],
        'text-only': ['chat', 'streaming', 'tools'],
        'bge-m3': ['embedding'],
      },
    }],
    model_role_bindings: { vision: 'ep1::text-only', embedding: 'ep1::bge-m3', chat: 'ep1' },
  };

  it('resolveModelProfile 解析对 → 返回解析模型与模型级能力', () => {
    const config = normalizeModelConfig(settings);
    const embedding = resolveModelProfile(config, 'embedding');
    assert.equal(embedding.error, undefined);
    assert.equal(embedding.model, 'bge-m3');
    assert.deepEqual(embedding.capabilities, ['embedding']);
    const chat = resolveModelProfile(config, 'chat');
    assert.equal(chat.model, 'gpt-4o'); // 裸 id = 渠道默认模型
  });

  it('能力校验按绑定模型：渠道有 vision 但绑定模型无 → 诚实 mismatch', () => {
    const config = normalizeModelConfig(settings);
    const vision = resolveModelProfile(config, 'vision');
    assert.equal(vision.error, 'model_capability_mismatch');
    const diagnostics = validateModelConfig(config);
    assert.ok(diagnostics.some((d) => d.code === 'model_capability_mismatch' && d.role === 'vision'));
    assert.ok(!diagnostics.some((d) => d.code === 'model_capability_mismatch' && d.role === 'embedding'));
  });

  it('requestedId 显式传对同样生效（覆盖绑定）', () => {
    const config = normalizeModelConfig(settings);
    const resolved = resolveModelProfile(config, 'vision', 'ep1::gpt-4o');
    assert.equal(resolved.error, undefined);
    assert.equal(resolved.model, 'gpt-4o');
  });

  it('默认绑定回退按渠道默认模型的解析能力挑选', () => {
    const config = normalizeModelConfig({
      model_profiles: [
        { id: 'a', provider: 'openai-compatible', model: 'text-only', capabilities: ['chat', 'streaming', 'tools', 'vision'], modelCapabilities: { 'text-only': ['chat', 'streaming', 'tools'] } },
        { id: 'b', provider: 'openai-compatible', model: 'vl-model', capabilities: ['chat', 'streaming', 'tools', 'vision'] },
      ],
    });
    assert.equal(config.roleBindings.vision, 'b'); // a 的默认模型实际无 vision
  });
});