/**
 * UI-696 契约：模型菜单快捷面只送兼容快照时，上下文窗口必须同步进权威的
 * model_profiles（agent-runner / token 预算读它），且不能抹掉每模型其它偏好。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { syncPresetContextWindow } = require('../core/petri-server/routes/ai-settings-api.js');

const current = {
  model_profiles: [
    {
      id: 'chat-a',
      model: 'model-a',
      contextWindow: 64000,
      visible: false,
      defaultThinkingLevel: 'high',
      capabilities: ['chat', 'reasoning'],
    },
    { id: 'chat-b', model: 'model-b', contextWindow: 128000 },
  ],
  chat_model_presets: [
    { id: 'chat-a', contextWindow: 64000, visible: false, defaultThinkingLevel: 'high' },
    { id: 'chat-b', contextWindow: 128000 },
  ],
};

test('只送 presets：窗口同步进 profiles，其它每模型偏好原样保留', () => {
  const patch = syncPresetContextWindow(current, {
    chat_model_presets: [
      { id: 'chat-a', contextWindow: 200000 },
      { id: 'chat-b', contextWindow: 128000 },
    ],
  });
  const profileA = patch.model_profiles.find((p) => p.id === 'chat-a');
  assert.equal(profileA.contextWindow, 200000);
  assert.equal(profileA.visible, false);
  assert.equal(profileA.defaultThinkingLevel, 'high');
  assert.deepEqual(profileA.capabilities, ['chat', 'reasoning']);
  assert.equal(patch.model_profiles.find((p) => p.id === 'chat-b').contextWindow, 128000);
  // UI-696 实机抓真：兼容快照也要同值，否则读 presets 的消费者会看到旧窗口（第二真相漂移）
  assert.equal(patch.chat_model_presets?.find((p) => p.id === 'chat-a')?.contextWindow, 200000);
});

test('设置页同时送 presets 与 profiles：原样返回，行为不变', () => {
  const incoming = { chat_model_presets: [{ id: 'chat-a', contextWindow: 999 }], model_profiles: current.model_profiles };
  const patch = syncPresetContextWindow(current, incoming);
  assert.deepEqual(patch, incoming);
});

test('非法/缺失窗口不覆盖既有值；未知 id 不新增 profile', () => {
  const patch = syncPresetContextWindow(current, {
    chat_model_presets: [
      { id: 'chat-a', contextWindow: 0 },
      { id: 'chat-b' },
      { id: 'ghost', contextWindow: 400000 },
    ],
  });
  assert.equal(patch.model_profiles.find((p) => p.id === 'chat-a').contextWindow, 64000);
  assert.equal(patch.model_profiles.find((p) => p.id === 'chat-b').contextWindow, 128000);
  assert.equal(patch.model_profiles.length, 2);
});

test('普通写面（不含 presets）不受影响', () => {
  const incoming = { telemetry_enabled: true };
  assert.deepEqual(syncPresetContextWindow(current, incoming), incoming);
});
