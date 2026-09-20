'use strict';

/**
 * BLOCK-98 P1 — microcompact（M1）契约测试。
 * 覆盖：开关门/阈值公式（表驱动）/分组折叠与最近 5 组保留/幂等防重/
 * 协议字段保全/原文数组零改动/统计口径（plan §7 ≥10 断言）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MICROCOMPACT_PLACEHOLDER,
  MIN_GROUP_TOOLS,
  KEEP_RECENT_GROUPS,
  isResilienceEnabled,
  isFolded,
  toolGroups,
  microcompactMessages,
  maybeMicrocompactBody,
} = require('../core/biof3-server/helpers/agent-resilience');

/** 构造一轮工具调用块：assistant 载体 + n 条 tool 结果 */
function toolBlock(n, fill = 'x'.repeat(2000), name = 'read_page') {
  const assistant = {
    role: 'assistant',
    content: null,
    tool_calls: Array.from({ length: n }, (_, _i) => ({
      id: `call_${name}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'function',
      function: { name, arguments: '{}' },
    })),
  };
  const tools = Array.from({ length: n }, (_, i) => ({
    role: 'tool',
    tool_call_id: assistant.tool_calls[i].id,
    name,
    content: fill,
  }));
  return [assistant, ...tools];
}

function longConversation(blockCount) {
  const messages = [{ role: 'system', content: 'system prompt' }];
  for (let i = 0; i < blockCount; i++) {
    const [assistant, ...tools] = toolBlock(2, `结果-${i}-`.padEnd(2000, 'y'));
    messages.push(assistant, ...tools);
  }
  messages.push({ role: 'user', content: '继续' });
  return messages;
}

function withEnv(fn) {
  const prev = process.env.BIOF3_AGENT_RESILIENCE;
  process.env.BIOF3_AGENT_RESILIENCE = '1';
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.BIOF3_AGENT_RESILIENCE;
    else process.env.BIOF3_AGENT_RESILIENCE = prev;
  }
}

test('开关默认开（2026-09-18 裁决）：超阈值折叠；0/false 强关时原样返回', () => {
  const prev = process.env.BIOF3_AGENT_RESILIENCE;
  const prevDir = process.env.BIOF3_LOCAL_DATA_DIR;
  process.env.BIOF3_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-b98-flag-'));
  try {
    // 默认开：超阈值（contextWindow=100）触发 microcompact
    delete process.env.BIOF3_AGENT_RESILIENCE;
    const messages = longConversation(10);
    const body = { messages, model: 'm' };
    const out = maybeMicrocompactBody(body, { contextWindow: 100 });
    assert.notEqual(out, body, 'default-on folds beyond threshold');
    assert.equal(isResilienceEnabled({}), true);
    // kill-switch 强关：原样返回（同一 body 引用）
    process.env.BIOF3_AGENT_RESILIENCE = '0';
    assert.equal(isResilienceEnabled({ BIOF3_AGENT_RESILIENCE: '0' }), false);
    const messages2 = longConversation(10);
    const body2 = { messages: messages2, model: 'm' };
    const out2 = maybeMicrocompactBody(body2, { contextWindow: 100 });
    assert.equal(out2, body2, 'must return the same body reference when disabled via kill-switch');
  } finally {
    if (prev === undefined) delete process.env.BIOF3_AGENT_RESILIENCE;
    else process.env.BIOF3_AGENT_RESILIENCE = prev;
    if (prevDir === undefined) delete process.env.BIOF3_LOCAL_DATA_DIR;
    else process.env.BIOF3_LOCAL_DATA_DIR = prevDir;
  }
});

test('阈值公式：min(窗口×0.9, 窗口−2000) 表驱动', () => {
  delete process.env.BIOF3_AGENT_RESILIENCE;
  const messages = longConversation(3);
  const big = { messages, model: 'm' };
  // 窗口巨大 → 阈值巨大 → 不触发
  const outBig = maybeMicrocompactBody({ ...big }, { contextWindow: 10_000_000 });
  assert.equal(outBig._microcompacted, undefined);
  // 窗口极小 → 阈值为负 → 必触发路径（仅统计 triggered 语义，走 helper 纯函数核）
  const r = microcompactMessages(messages, { contextWindow: 100 });
  assert.equal(r.triggered, true);
});

test('超阈值折叠：仅折叠最近 5 组之前的组，最近组原样保留', () => {
  return withEnv(() => {
    const messages = longConversation(9); // 9 组工具块
    const r = microcompactMessages(messages, { contextWindow: 100 });
    assert.equal(r.triggered, true);
    assert.equal(r.groups, 9 - KEEP_RECENT_GROUPS, 'fold all but the most recent 5 groups');
    assert.ok(r.folded >= (9 - KEEP_RECENT_GROUPS) * MIN_GROUP_TOOLS);

    // 末尾 KEEP_RECENT_GROUPS 组保持原文
    const tail = messages.slice(-4); // 最后一块（assistant+2 tools）+ user
    assert.equal(isFolded(tail[1].content), false);
    assert.equal(isFolded(tail[2].content), false);
    // 头部组被折叠（在投影副本上）
    assert.equal(isFolded(r.messages[2].content), true);
    // 原数组零改动（红线）：原文未折叠且内容原样
    assert.equal(isFolded(messages[2].content), false);
    assert.equal(messages[2].content.startsWith('结果-0-'), true);
    assert.notEqual(r.messages, messages);
  });
});

test('折叠占位符带标记与统计口径，且幂等（二次调用不再折叠）', () => {
  return withEnv(() => {
    const messages = longConversation(9);
    const r1 = microcompactMessages(messages, { contextWindow: 100 });
    assert.ok(r1.clearedChars > 0);
    assert.equal(r1.messages[2].content.includes(MICROCOMPACT_PLACEHOLDER), true);

    const r2 = microcompactMessages(r1.messages, { contextWindow: 100 });
    // 二次调用：已折叠项不成组；若仍有新可折组，折叠数不得包含已折叠项
    assert.equal(r2.folded, 0, 'already-folded messages must not re-fold');
  });
});

test('协议字段保全：tool_call_id/name 原样，assistant 载体不动', () => {
  return withEnv(() => {
    const messages = longConversation(9);
    const r = microcompactMessages(messages, { contextWindow: 100 });
    const origTool = messages[2];
    const newTool = r.messages[2];
    assert.equal(newTool.role, 'tool');
    assert.equal(newTool.tool_call_id, origTool.tool_call_id);
    assert.equal(newTool.name, origTool.name);
    // assistant 载体零改动
    assert.deepEqual(r.messages[1].tool_calls, messages[1].tool_calls);
    assert.equal(r.messages[1].content, messages[1].content);
  });
});

test('maybeMicrocompactBody：折叠命中返回浅拷贝并打标记，重复调用防重入', () => {
  return withEnv(() => {
    const body = { messages: longConversation(9), model: 'm' };
    const out = maybeMicrocompactBody(body, { contextWindow: 100 });
    assert.equal(out._microcompacted, true);
    assert.ok(out._microcompactStats.folded > 0);
    assert.notEqual(out.messages, body.messages);
    assert.equal(body._microcompacted, undefined, '原 body 不被打标');

    const again = maybeMicrocompactBody(out, { contextWindow: 100 });
    assert.equal(again, out, 're-entry must short-circuit');
  });
});

test('toolGroups：零散单条工具结果不成组（MIN_GROUP_TOOLS=2）', () => {
  const single = [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: ' lone result ' },
    { role: 'assistant', content: 'done' },
  ];
  assert.deepEqual(toolGroups(single), [], 'single tool result must not form a group');
});
