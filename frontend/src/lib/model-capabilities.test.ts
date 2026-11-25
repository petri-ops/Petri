/**
 * BLOCK-455 — 前端镜像与后端单源的一致性契约（跨源矩阵）。
 * 后端 = core/shared-backend/llm-providers/model-profile.js（CJS，createRequire 加载）。
 * 任何一侧改规则而另一侧未同步 → 本矩阵红。
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveModelCapabilities,
  inferModelCapabilities,
  parseModelBinding,
  prefillModelCapabilities,
  type ModelCapabilityProfileLike,
} from './model-capabilities';

const require = createRequire(import.meta.url);
const backend = require(resolve(__dirname, '../../../core/shared-backend/llm-providers/model-profile.js')) as {
  inferModelCapabilities: (modelName: string | undefined) => string[];
  resolveModelCapabilities: (profile: ModelCapabilityProfileLike, model?: string) => string[];
  parseModelBinding: (value: string | undefined | null) => { profileId: string; model?: string };
};

const MODEL_NAMES = [
  'gpt-4o', 'gpt-4o-mini', 'qwen-vl-max', 'claude-sonnet-4-5', 'gemini-2.5-pro', 'qvq-max',
  'deepseek-reasoner', 'deepseek-chat', 'o1-preview', 'o3-mini', 'qwq-32b', 'kimi-k2-thinking',
  'magistral-medium', 'deepseek-r1', 'bge-m3', 'text-embedding-v3', 'text-embedding-3-small',
  'gte-large', 'llama-3-70b', 'qwen2.5-72b-instruct', 'model/a', '', 'GLM-4-Plus',
  'glm-4.6', 'glm-4.6v', 'glm-4.7', 'glm-5.3-flash', 'glm-5.3-flashx',
];

describe('BLOCK-455 前后端能力解析一致性', () => {
  it('inferModelCapabilities 跨源矩阵逐字一致', () => {
    for (const name of MODEL_NAMES) {
      expect(inferModelCapabilities(name), name).toEqual(backend.inferModelCapabilities(name));
    }
  });

  it('resolveModelCapabilities 跨源矩阵逐字一致（覆写/兜底/空数组/缺省）', () => {
    const profiles: ModelCapabilityProfileLike[] = [
      { capabilities: ['chat', 'streaming', 'tools', 'vision'] },
      { capabilities: ['chat'], modelCapabilities: { m: ['embedding'], empty: [] } },
      { modelCapabilities: { m: ['chat', 'vision'] } },
      {},
    ];
    const models = ['m', 'empty', 'unknown', undefined];
    for (const profile of profiles) {
      for (const model of models) {
        expect(resolveModelCapabilities(profile, model), `${JSON.stringify(profile)} / ${model}`)
          .toEqual(backend.resolveModelCapabilities(profile, model));
      }
    }
  });

  it('parseModelBinding 跨源矩阵逐字一致（裸 id/对/编码/非法编码）', () => {
    for (const value of ['p1', 'p1::gpt-4o', 'p1::model%2Fa', 'p1::%E4%B8%AD%E6%96%87', 'p1::%zz', '', '  p1::m  ']) {
      expect(parseModelBinding(value), value).toEqual(backend.parseModelBinding(value));
    }
  });
});

describe('BLOCK-455 prefillModelCapabilities 零回归预填（BLOCK-518 收窄口径）', () => {
  it('不覆盖已有显式条目', () => {
    const next = prefillModelCapabilities(
      { capabilities: ['tools'], modelCapabilities: { 'gpt-4o': ['tools'] } },
      ['gpt-4o'],
    );
    expect(next).toBeUndefined();
  });

  it('向量系模型名只写 embedding（即使渠道已声明 tools）', () => {
    const next = prefillModelCapabilities(
      { capabilities: ['tools'] },
      ['bge-m3', 'deepseek-chat'],
    );
    expect(next).toEqual({ 'bge-m3': ['embedding'] });
  });

  it('BLOCK-518 — 推断收窄 [tools]：渠道已含 tools 时聊天模型不再物化条目', () => {
    expect(prefillModelCapabilities(
      { capabilities: ['tools'] },
      ['glm-4.6', 'glm-5.3-flash', 'gpt-4o', 'deepseek-reasoner', 'my-custom-model'],
    )).toBeUndefined();
  });

  it('渠道声明缺 tools 时按推断补齐并集', () => {
    const next = prefillModelCapabilities(
      { capabilities: [] },
      ['gpt-4o'],
    );
    expect(next).toEqual({ 'gpt-4o': ['tools'] });
  });
});