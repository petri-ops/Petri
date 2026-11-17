/**
 * BLOCK-456 P1 — 模型级上下文/思考默认档契约（HK-01 红绿）。
 * 单源 = core/shared-backend/llm-providers/model-profile.js；
 * sync 桥 = core/petri-server/routes/ai-settings-api.js syncPresetContextWindow。
 * 解析序：modelPreferences[model] 显式覆写 > 渠道级 fallback（旧数据零行为变化）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveModelContextWindow,
  resolveModelThinkingDefault,
  normalizeModelProfile,
} = require('../core/shared-backend/llm-providers/model-profile.js');
const { syncPresetContextWindow } = require('../core/petri-server/routes/ai-settings-api.js');

const base = { id: 'p1', provider: 'deepseek', model: 'deepseek-flash' };

test('resolveModelContextWindow：模型级覆写优先于渠道 fallback', () => {
  const profile = { ...base, contextWindow: 128000, modelPreferences: { 'deepseek-flash': { contextWindow: 400000 } } };
  assert.equal(resolveModelContextWindow(profile, 'deepseek-flash'), 400000);
  assert.equal(resolveModelContextWindow(profile, 'other-model'), 128000);
});

test('resolveModelContextWindow：无覆写读渠道 fallback；都无返回 undefined；存储键写时清洗（normalize 链）', () => {
  assert.equal(resolveModelContextWindow({ ...base, contextWindow: 128000 }, 'deepseek-flash'), 128000);
  assert.equal(resolveModelContextWindow(base, 'deepseek-flash'), undefined);
  assert.equal(resolveModelContextWindow(null, 'x'), undefined);
  const normalized = normalizeModelProfile({ ...base, modelPreferences: { ' deepseek-flash ': { contextWindow: 64000 } } });
  assert.equal(resolveModelContextWindow(normalized, 'deepseek-flash'), 64000);
  assert.equal(resolveModelContextWindow(normalized, ' deepseek-flash '), 64000);
});

test('resolveModelContextWindow：覆写非法值回落渠道 fallback（不静默用坏值）', () => {
  const profile = { ...base, contextWindow: 128000, modelPreferences: { 'deepseek-flash': { contextWindow: -5 } } };
  assert.equal(resolveModelContextWindow(profile, 'deepseek-flash'), 128000);
});

test('resolveModelThinkingDefault：模型级覆写 > 渠道 defaultThinkingLevel > undefined', () => {
  const profile = { ...base, defaultThinkingLevel: 'off', modelPreferences: { 'deepseek-flash': { thinkingLevel: 'high' } } };
  assert.equal(resolveModelThinkingDefault(profile, 'deepseek-flash'), 'high');
  assert.equal(resolveModelThinkingDefault(profile, 'other-model'), 'off');
  assert.equal(resolveModelThinkingDefault(base, 'deepseek-flash'), undefined);
  assert.equal(resolveModelThinkingDefault(null, 'x'), undefined);
});

test('normalizeModelProfile：modelPreferences 消毒（round 正整数 / 已知三档 / 丢非法条目）', () => {
  const normalized = normalizeModelProfile({
    ...base,
    modelPreferences: {
      'deepseek-flash': { contextWindow: 400000.4, thinkingLevel: 'high' },
      'bad-level': { thinkingLevel: 'ultra' },
      'bad-window': { contextWindow: 0 },
      '': { contextWindow: 999 },
      'mixed': { contextWindow: 64000, thinkingLevel: 'off', junk: 1 },
    },
  });
  assert.deepEqual(normalized.modelPreferences, {
    'deepseek-flash': { contextWindow: 400000, thinkingLevel: 'high' },
    'mixed': { contextWindow: 64000, thinkingLevel: 'off' },
  });
});

test('normalizeModelProfile：无 modelPreferences 的旧档案零行为变化', () => {
  const normalized = normalizeModelProfile({ ...base, contextWindow: 128000, defaultThinkingLevel: 'high' });
  assert.equal(normalized.contextWindow, 128000);
  assert.equal(normalized.defaultThinkingLevel, 'high');
  assert.equal(normalized.modelPreferences, undefined);
});

test('sync 桥：choice id 快捷写盘落模型级覆写（修 UI-696 展开态静默丢写）', () => {
  const current = {
    model_profiles: [{ ...base, contextWindow: 128000 }],
    chat_model_presets: [
      { id: 'p1', contextWindow: 128000 },
      { id: 'p1::deepseek-v4-pro', contextWindow: 128000 },
    ],
  };
  const incoming = { chat_model_presets: [{ id: 'p1::deepseek-v4-pro', contextWindow: 400000 }] };
  const patch = syncPresetContextWindow(current, incoming);
  assert.equal(patch.model_profiles[0].modelPreferences['deepseek-v4-pro'].contextWindow, 400000);
  assert.equal(patch.model_profiles[0].contextWindow, 128000, '渠道 fallback 不被模型级写盘污染');
  assert.equal(patch.chat_model_presets.find((p) => p.id === 'p1::deepseek-v4-pro').contextWindow, 400000);
  assert.equal(patch.chat_model_presets.find((p) => p.id === 'p1').contextWindow, 128000);
});

test('sync 桥：choice id 的 model 段解码（encodeURIComponent 形态）', () => {
  const current = { model_profiles: [{ ...base, model: 'm default' }], chat_model_presets: [] };
  const incoming = { chat_model_presets: [{ id: `p1::${encodeURIComponent('m default')}`, contextWindow: 200000 }] };
  const patch = syncPresetContextWindow(current, incoming);
  assert.equal(patch.model_profiles[0].modelPreferences['m default'].contextWindow, 200000);
});

test('sync 桥：裸 id（legacy 快照调用方）仍写渠道级 fallback，行为不变', () => {
  const current = {
    model_profiles: [{ ...base, contextWindow: 128000 }],
    chat_model_presets: [{ id: 'p1', contextWindow: 128000 }],
  };
  const patch = syncPresetContextWindow(current, { chat_model_presets: [{ id: 'p1', contextWindow: 200000 }] });
  assert.equal(patch.model_profiles[0].contextWindow, 200000);
  assert.equal(patch.model_profiles[0].modelPreferences, undefined);
  assert.equal(patch.chat_model_presets[0].contextWindow, 200000);
});

test('sync 桥：同时送 model_profiles 时原样返回（设置页全量路径不变）', () => {
  const incoming = { model_profiles: [{ ...base }], chat_model_presets: [{ id: 'p1', contextWindow: 1 }] };
  assert.deepEqual(syncPresetContextWindow({ model_profiles: [] }, incoming), incoming);
});

test('sync 桥：模型级写盘保留档案其它偏好与既有覆写条目', () => {
  const current = {
    model_profiles: [{
      ...base,
      contextWindow: 128000,
      modelPreferences: { 'deepseek-flash': { thinkingLevel: 'high' }, 'other': { contextWindow: 64000 } },
    }],
    chat_model_presets: [],
  };
  const patch = syncPresetContextWindow(current, { chat_model_presets: [{ id: 'p1::deepseek-flash', contextWindow: 400000 }] });
  assert.deepEqual(patch.model_profiles[0].modelPreferences, {
    'deepseek-flash': { thinkingLevel: 'high', contextWindow: 400000 },
    'other': { contextWindow: 64000 },
  });
});

test('sync 桥：与当前解析值相同的写入是 no-op（全量 presets POST 不物化 fallback）', () => {
  const current = {
    model_profiles: [{ ...base, contextWindow: 128000, defaultThinkingLevel: 'standard' }],
    chat_model_presets: [
      { id: 'p1::deepseek-flash', contextWindow: 128000, defaultThinkingLevel: 'standard' },
      { id: 'p1::deepseek-v4-pro', contextWindow: 128000, defaultThinkingLevel: 'standard' },
    ],
  };
  const patch = syncPresetContextWindow(current, { chat_model_presets: current.chat_model_presets });
  assert.equal(patch.model_profiles[0].modelPreferences, undefined, '兜底值不得批量落盘为显式覆写');
  assert.equal(patch.model_profiles[0].contextWindow, 128000);
  assert.equal(patch.model_profiles[0].defaultThinkingLevel, 'standard');
});

test('sync 桥：no-op 判定按模型级解析值（已有覆写时送 fallback 值=显式改回，须写）', () => {
  const current = {
    model_profiles: [{ ...base, contextWindow: 128000, modelPreferences: { 'deepseek-flash': { contextWindow: 400000 } } }],
    chat_model_presets: [],
  };
  const patch = syncPresetContextWindow(current, { chat_model_presets: [{ id: 'p1::deepseek-flash', contextWindow: 128000 }] });
  assert.equal(patch.model_profiles[0].modelPreferences['deepseek-flash'].contextWindow, 128000);
});

test('sync 桥：choice id 思考档写模型级 thinkingLevel（渠道 defaultThinkingLevel 不污染）', () => {
  const current = {
    model_profiles: [{ ...base, defaultThinkingLevel: 'off' }],
    chat_model_presets: [{ id: 'p1::deepseek-flash', defaultThinkingLevel: 'off' }],
  };
  const patch = syncPresetContextWindow(current, { chat_model_presets: [{ id: 'p1::deepseek-flash', defaultThinkingLevel: 'high' }] });
  assert.equal(patch.model_profiles[0].modelPreferences['deepseek-flash'].thinkingLevel, 'high');
  assert.equal(patch.model_profiles[0].defaultThinkingLevel, 'off');
  assert.equal(patch.chat_model_presets[0].defaultThinkingLevel, 'high');
});

test('sync 桥：裸 id 思考档仍写渠道级；非法档位忽略', () => {
  const current = {
    model_profiles: [{ ...base, defaultThinkingLevel: 'off' }],
    chat_model_presets: [{ id: 'p1', defaultThinkingLevel: 'off' }],
  };
  const patch = syncPresetContextWindow(current, { chat_model_presets: [{ id: 'p1', defaultThinkingLevel: 'high' }] });
  assert.equal(patch.model_profiles[0].defaultThinkingLevel, 'high');
  assert.equal(patch.model_profiles[0].modelPreferences, undefined);
  const bad = syncPresetContextWindow(current, { chat_model_presets: [{ id: 'p1', defaultThinkingLevel: 'ultra' }] });
  assert.equal(bad.model_profiles[0].defaultThinkingLevel, 'off');
});