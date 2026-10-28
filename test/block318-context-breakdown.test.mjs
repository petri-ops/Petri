/**
 * BLOCK-318 / UI-622 — 上下文构成分类契约。
 *
 * computeContextBreakdown：系统提示词 / 工具定义 / 对话消息 / 工具结果 /
 * 其他系统内容 / 输出预留 六类，total=逐项和；知识空间是系统提示词的子集（钳制）。
 * 源码钉：agent loop 每轮 token_budget 带 breakdown，工具定义只计数一次；plain chat 同口径。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve('.');
const coreRequire = createRequire(path.join(ROOT, 'core/petri-server/package.json'));
const { computeContextBreakdown } = coreRequire(path.join(ROOT, 'core/petri-server/helpers/token-estimator.js'));

test('UI-622 六类构成：逐项求和 = total，工具结果/其他系统单列', () => {
  const breakdown = computeContextBreakdown({
    systemPrompt: 'You are a careful coding agent.',
    messages: [
      { role: 'user', content: '帮我读一下 package.json 并总结脚本。' },
      { role: 'assistant', content: '好的，我先读取文件。' },
      { role: 'tool', content: '{"scripts":{"dev":"vite","build":"tsc && vite build"}}' },
      { role: 'system', content: '（压缩摘要）早期对话要点……' },
    ],
    toolDefinitionsTokens: 1234,
    maxTokens: 8192,
    knowledgeTokens: 64,
  });
  assert.ok(breakdown.systemPrompt > 0);
  assert.ok(breakdown.messages > 0);
  assert.ok(breakdown.toolResults > 0);
  assert.ok(breakdown.otherSystem > 0);
  assert.equal(breakdown.toolDefinitions, 1234);
  assert.equal(breakdown.outputReserve, 8192);
  assert.equal(breakdown.knowledge, Math.min(64, breakdown.systemPrompt));
  assert.equal(
    breakdown.total,
    breakdown.systemPrompt + breakdown.toolDefinitions + breakdown.messages
      + breakdown.toolResults + breakdown.otherSystem + breakdown.outputReserve,
  );
});

test('UI-622 知识空间不得大于系统提示词；缺省值全 0 不产生 NaN', () => {
  const clamped = computeContextBreakdown({ systemPrompt: 'hi', knowledgeTokens: 999999 });
  assert.equal(clamped.knowledge, clamped.systemPrompt);
  const empty = computeContextBreakdown({});
  assert.deepEqual(empty, {
    systemPrompt: 0,
    knowledge: 0,
    toolDefinitions: 0,
    messages: 0,
    toolResults: 0,
    otherSystem: 0,
    outputReserve: 0,
    total: 0,
  });
});

test('UI-622 源码钉：agent loop token_budget 带 breakdown 且工具定义只计数一次', () => {
  const loop = fs.readFileSync(path.join(ROOT, 'core/petri-server/loop-orchestrator.js'), 'utf8');
  assert.match(loop, /computeContextBreakdown/);
  assert.match(loop, /toolDefinitionsTokens/);
  assert.match(loop, /breakdown,\n\s+pct:/);
  // 常量提取在 for 循环之前（每轮不重复 JSON.stringify + tiktoken）
  const defsIdx = loop.indexOf('const toolDefinitionsTokens');
  const loopIdx = loop.indexOf('for (let iter = 0');
  assert.ok(defsIdx > 0 && loopIdx > defsIdx, 'toolDefinitionsTokens 应在循环前计算');
});

test('UI-622 源码钉：plain chat 事件同口径附 breakdown（无工具定义）', () => {
  const chat = fs.readFileSync(path.join(ROOT, 'core/petri-server/routes/ai-chat.js'), 'utf8');
  assert.match(chat, /computeContextBreakdown/);
  assert.match(chat, /toolDefinitionsTokens: 0/);
  assert.match(chat, /breakdown,\n\s+pct/);
});
