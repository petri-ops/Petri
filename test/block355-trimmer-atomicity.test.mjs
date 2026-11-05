'use strict';

/**
 * BLOCK-355 / C-45 — 上下文裁剪必须保持 tool 调用链完整性。
 *
 * 历史缺陷（BLOCK-348 T7 实锤）：三档贪心先挑 tool 结果、占满预算后丢掉
 * assistant(tool_calls)，且输出按 age 升序把新消息排到前面 →
 * provider 收到悬空 tool 消息整体 400，长任务中断。
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require_ = createRequire(import.meta.url);
const { trimMessagesToBudget, countMessageTokens } = require_(
  path.join(ROOT, 'core/petri-server/helpers/message-trimmer.js'),
);

const SYS = { role: 'system', content: 'system prompt' };

function toolTurn(id, payload = 'result ') {
  return [
    { role: 'user', content: `问 ${id} ` + 'x'.repeat(60) },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: id, content: payload.repeat(30) },
  ];
}

/** 输出合法性：每条 tool 必须能找到前面声明的 tool_call_id，且顺序不颠倒。 */
function assertChainIntegrity(messages, label) {
  const declared = new Set();
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) if (tc && tc.id) declared.add(tc.id);
    } else if (msg.role === 'tool') {
      assert.ok(
        msg.tool_call_id && declared.has(msg.tool_call_id),
        `${label}: 悬空 tool 消息（tool_call_id=${msg.tool_call_id}）`,
      );
    }
  }
}

function trim(msgs, contextWindow) {
  return trimMessagesToBudget({
    fullMessages: [SYS, ...msgs],
    contextWindow,
    headroom: 0,
    systemPromptTokens: 1,
  });
}

describe('BLOCK-355 上下文裁剪 tool 链原子性（C-45）', () => {
  test('极小预算下裁剪：整链同留同裁，无悬空 tool', () => {
    const msgs = [];
    for (let i = 0; i < 7; i += 1) msgs.push(...toolTurn(`call_${i}`));
    const total = msgs.reduce((n, m) => n + countMessageTokens(m), 0);
    // 预算远小于总量，强制触发裁剪
    const { messages, stats } = trim(msgs, Math.max(80, Math.floor(total / 3)));
    assert.ok(stats.trimmed, '应发生裁剪');
    assertChainIntegrity(messages.slice(1), 'small-budget');
    assert.ok(messages.length > 1, '不能把所有消息都裁光');
  });

  test('输出保持原始顺序（不再按 age 升序倒置）', () => {
    const msgs = [...toolTurn('call_a'), ...toolTurn('call_b')];
    const total = msgs.reduce((n, m) => n + countMessageTokens(m), 0);
    const { messages } = trim(msgs, Math.max(60, Math.floor(total / 2)));
    const body = messages.slice(1);
    // 每轮内部顺序必须是 user → assistant(tool_calls) → tool
    for (let i = 0; i + 2 < body.length; i += 1) {
      if (body[i].role === 'user' && body[i + 1].role === 'assistant') {
        assert.equal(body[i + 2].role, 'tool', `第 ${i} 轮顺序被倒置`);
      }
    }
    const idxOf = (id) => body.findIndex((m) => m.role === 'tool' && m.tool_call_id === id);
    if (idxOf('call_a') >= 0 && idxOf('call_b') >= 0) {
      assert.ok(idxOf('call_a') < idxOf('call_b'), 'call_a 应早于 call_b');
    }
  });

  test('预算充足时原样返回、零裁剪', () => {
    const msgs = toolTurn('call_ok');
    const { messages, stats } = trim(msgs, 100000);
    assert.equal(stats.trimmed, false);
    assert.equal(messages.length, msgs.length + 1);
    assertChainIntegrity(messages.slice(1), 'no-trim');
  });

  test('输入本身带孤立 tool：防御层丢弃，不进入 provider 请求', () => {
    const msgs = [
      { role: 'user', content: 'u'.repeat(200) },
      { role: 'tool', tool_call_id: 'orphan_no_declaration', content: 'z'.repeat(200) },
      ...toolTurn('call_valid'),
    ];
    const total = msgs.reduce((n, m) => n + countMessageTokens(m), 0);
    const { messages, stats } = trim(msgs, Math.max(80, Math.floor(total / 2)));
    assert.ok(stats.trimmed);
    const orphan = messages.slice(1).find((m) => m.role === 'tool' && m.tool_call_id === 'orphan_no_declaration');
    assert.equal(orphan, undefined, '孤立 tool 必须被丢弃');
    assertChainIntegrity(messages.slice(1), 'orphan-input');
  });

  test('20k 窗口 7 次调用冻结场景：裁剪结果结构合法', () => {
    const msgs = [];
    for (let i = 0; i < 7; i += 1) msgs.push(...toolTurn(`frozen_${i}`, 'y'.repeat(40) + ' '));
    // 模拟 20k 窗口（以估算 token 计）下的紧预算
    const total = msgs.reduce((n, m) => n + countMessageTokens(m), 0);
    const { messages, stats } = trim(msgs, Math.max(120, Math.floor(total * 0.45)));
    assert.ok(stats.trimmed);
    assertChainIntegrity(messages.slice(1), 'frozen-20k-7calls');
    assert.ok(stats.messagesTokensUsed <= Math.max(120, Math.floor(total * 0.45)), '不得超预算');
  });

  test('负测：旧「三档独立贪心 + age 升序」算法会被本契约抓红', () => {
    // 复刻修复前的行为：tool 结果先进 kept、assistant(tool_calls) 因预算不足被丢，
    // 且输出按 age 升序倒置。用它证明上面的断言不是空转。
    const msgs = [];
    for (let i = 0; i < 7; i += 1) msgs.push(...toolTurn(`legacy_${i}`));
    const total = msgs.length;
    const scored = msgs.map((msg, idx) => ({
      msg, idx, age: total - idx, tokens: countMessageTokens(msg),
      tier: msg.role === 'tool' ? 1 : (total - idx > 20 ? 3 : 2),
    }));
    const budget = Math.max(80, Math.floor(scored.reduce((n, s) => n + s.tokens, 0) / 3));
    const kept = [];
    let used = 0;
    for (const s of [...scored].filter((x) => x.tier === 1).sort((a, b) => a.age - b.age)) {
      if (used + s.tokens <= budget) { kept.push(s); used += s.tokens; }
    }
    for (const s of [...scored].filter((x) => x.tier === 2).sort((a, b) => a.age - b.age)) {
      if (used + s.tokens <= budget) { kept.push(s); used += s.tokens; }
    }
    const legacyOutput = kept.sort((a, b) => a.age - b.age).map((s) => s.msg);
    assert.throws(
      () => assertChainIntegrity(legacyOutput, 'legacy'),
      /悬空 tool|tool_call_id/,
      '旧算法必须被完整性断言判红，否则契约是空转的',
    );
  });
});
