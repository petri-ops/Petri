import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSystemPrompt } = require('../core/r-server/helpers/system-prompt.js');

test('system prompt distinguishes the BioF3 role from the real provider and model', () => {
  const prompt = buildSystemPrompt(
    { page: 'desktop-project', projectId: 'project-a' },
    {
      provider: 'deepseek',
      providerLabel: 'DeepSeek',
      model: 'deepseek-v4-flash',
    }
  );

  assert.match(prompt, /BioF3 平台的 AI 助手 Copilot/);
  assert.match(prompt, /供应商：DeepSeek/);
  assert.match(prompt, /模型：deepseek-v4-flash/);
  assert.match(prompt, /必须同时说明 BioF3 工作角色、当前供应商和当前模型 ID/);
  assert.match(prompt, /不得省略、模糊/);
});

test('custom supplier labels remain visible alongside the adapter provider id', () => {
  const prompt = buildSystemPrompt(null, {
    provider: 'openai-compatible',
    providerLabel: '火山方舟',
    model: 'doubao-pro',
  });

  assert.match(prompt, /供应商：火山方舟（Provider ID：openai-compatible）/);
  assert.match(prompt, /模型：doubao-pro/);
});
