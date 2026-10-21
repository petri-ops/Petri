/**
 * BLOCK-224 — 模型 profile 归一保留选择器治理字段。
 * visible 缺省=true（不写键）/ false 保留；defaultThinkingLevel 只接受 off|standard|high。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');

const { normalizeModelProfile } = require(path.join(
  ROOT,
  'core/shared-backend/llm-providers/model-profile.js'
));

const base = {
  id: 'p1',
  label: 'DeepSeek',
  provider: 'anthropic',
  model: 'model-a',
};

test('visible 缺省不写键（默认可见）；false 保留', () => {
  assert.equal('visible' in normalizeModelProfile(base), false);
  assert.equal(normalizeModelProfile({ ...base, visible: true }).visible, undefined);
  assert.equal(normalizeModelProfile({ ...base, visible: false }).visible, false);
});

test('defaultThinkingLevel 只保留已知三档，非法值丢弃', () => {
  assert.equal(normalizeModelProfile({ ...base, defaultThinkingLevel: 'high' }).defaultThinkingLevel, 'high');
  assert.equal(normalizeModelProfile({ ...base, defaultThinkingLevel: 'off' }).defaultThinkingLevel, 'off');
  assert.equal(normalizeModelProfile({ ...base, defaultThinkingLevel: 'extreme' }).defaultThinkingLevel, undefined);
  assert.equal(normalizeModelProfile({ ...base, defaultThinkingLevel: 1 }).defaultThinkingLevel, undefined);
});

test('既有字段与上下文窗口不受影响', () => {
  const normalized = normalizeModelProfile({ ...base, contextWindow: 128000.4, capabilities: ['chat', 'tools'] });
  assert.equal(normalized.contextWindow, 128000);
  assert.deepEqual(normalized.capabilities, ['chat', 'tools']);
  assert.equal(normalized.provider, 'anthropic');
});
