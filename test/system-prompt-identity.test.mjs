import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSystemPrompt } = require('../core/biof3-server/helpers/system-prompt.js');

test('system prompt keeps the assistant role brand-neutral and discloses the real provider and model', () => {
  const prompt = buildSystemPrompt(
    { page: 'desktop-project', projectId: 'project-a' },
    {
      provider: 'deepseek',
      providerLabel: 'DeepSeek',
      model: 'deepseek-v4-flash',
    }
  );

  assert.match(prompt, /生物信息学分析助手/);
  assert.doesNotMatch(prompt, /BioF3 平台的 AI 助手 Copilot/);
  assert.doesNotMatch(prompt, /“BioF3 Copilot”是你在本产品中的工作角色/);
  assert.match(prompt, /供应商：DeepSeek/);
  assert.match(prompt, /模型：deepseek-v4-flash/);
  assert.match(prompt, /必须直接说明当前供应商和当前模型 ID/);
  assert.match(prompt, /不得提及任何产品名/);
  assert.match(prompt, /不得使用“Copilot”作为身份/);
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
