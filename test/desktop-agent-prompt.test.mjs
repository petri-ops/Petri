import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSystemPrompt } = require('../core/biof3-server/helpers/system-prompt.js');
const {
  appendDesktopAgentInstructions,
} = require('../core/biof3-server/helpers/desktop-agent-prompt.js');
const { getToolDefs } = require('../core/biof3-server/agent-tools/tool-defs.js');

test('desktop prompt rejects legacy identity and automatic recommendation patterns', () => {
  const prompt = appendDesktopAgentInstructions(
    buildSystemPrompt(
      { page: 'desktop-project', projectId: 'project-a' },
      { provider: 'deepseek', providerLabel: 'DeepSeek', model: 'deepseek-v4-flash' }
    ) +
      '\n\n=== Tool Calling 指南 ===' +
      '\n旧内容：DESeq2 完成后推荐 enrichment 或 gsea，并自称 BioF3 Copilot。'
  );

  assert.doesNotMatch(prompt, /BioF3 Copilot/);
  assert.doesNotMatch(prompt, /完成后推荐 enrichment 或 gsea/);
  assert.doesNotMatch(prompt, /FigCode|推荐学习路径/);
  assert.match(prompt, /不要自动生成“推荐下一步”清单/);
  assert.match(prompt, /历史助手消息、摘要或检索记录/);
  assert.match(prompt, /面向用户的正文说明当前判断和接下来要核对什么/);
  assert.match(prompt, /不输出隐藏推理过程/);
});

test('retired learning recommendation tools are not exposed to models', () => {
  const names = getToolDefs().map((entry) => entry.function.name);
  for (const name of [
    'discover_capabilities',
    'act_generic',
    'suggest_next_steps',
    'verify_understanding',
    'suggest_review',
    'record_learning_signal',
  ]) {
    assert.equal(names.includes(name), false, `${name} must remain unavailable`);
  }
});

test('desktop prompt keeps result presentation deterministic and excludes legacy page actions', () => {
  const prompt = appendDesktopAgentInstructions(buildSystemPrompt(
    { page: 'desktop-project', projectId: 'project-a' },
    { provider: 'deepseek', providerLabel: 'DeepSeek', model: 'deepseek-v4-flash' }
  ));
  assert.match(prompt, /客户端依据成功事件自动打开结果/);
  assert.doesNotMatch(prompt, /discover_capabilities|act_generic|open_result handler/);
});
