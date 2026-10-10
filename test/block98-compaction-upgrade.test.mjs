'use strict';

/**
 * BLOCK-98 P2 — auto-compact 升级（M2）契约测试。
 * 覆盖：D3 阈值公式表驱动 / planCompaction 阈值注入 / applyCompactionView
 * legacy 逐字节兼容 + resilience 附加行（转写指针+续接纪律）/ 转写路径校验。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const resilience = require('../core/petri-server/helpers/agent-resilience');
const compactionMod = require('../core/petri-server/helpers/conversation-compaction');

test('planThreshold 阈值公式表驱动（D3）', () => {
  // 200K 窗口（ZCode 标定域）：eff=200000-8192=191808, buffer=min(13000,15344)=13000
  assert.deepEqual(resilience.planThreshold(200000, 8192), { effectiveWindow: 191808, buffer: 13000, threshold: 178808 });
  // 128K + 21K 输出预留
  assert.deepEqual(resilience.planThreshold(128000, 21000), { effectiveWindow: 107000, buffer: 8560, threshold: 98440 });
  // 64K + 8192：buffer 按 8% 缩放
  assert.deepEqual(resilience.planThreshold(64000, 8192), { effectiveWindow: 55808, buffer: 4465, threshold: 51343 });
  // 超小窗口：有效窗口钳 0 → 阈值 0（永远可压缩，不炸任务）
  assert.deepEqual(resilience.planThreshold(8000, 21000), { effectiveWindow: 0, buffer: 0, threshold: 0 });
  // 窗口未知
  assert.equal(resilience.planThreshold(0, 8192), null);
  assert.equal(resilience.planThreshold(undefined), null);
});

test('transcriptPathFor：id 白名单 + DATA_DIR 回退', () => {
  const p = resilience.transcriptPathFor('conv_abc-1', '/tmp/dd');
  assert.ok(p.includes('conv_abc-1.jsonl'));
  assert.equal(resilience.transcriptPathFor('../evil', '/tmp/dd'), null);
  assert.equal(resilience.transcriptPathFor('', '/tmp/dd'), null);
});

test('planCompaction 支持注入阈值（resilience 模式），legacy 常量不变', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    rowid: i + 1,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'c'.repeat(4000),
  }));
  // legacy：固定 12K 触发
  const legacy = compactionMod.planCompaction(rows);
  assert.equal(legacy.should, true);
  // 注入低阈值：同样触发但走注入值
  const low = compactionMod.planCompaction(rows, null, { threshold: 100 });
  assert.equal(low.should, true);
  // 注入超高阈值：不触发
  const high = compactionMod.planCompaction(rows, null, { threshold: 999_999_999 });
  assert.equal(high.should, false);
  // 常量未被改动（legacy 兼容）
  assert.equal(compactionMod.COMPACTION_TRIGGER_TOKENS, 12000);
});

test('applyCompactionView legacy：无 opts 时文案逐字节不变', () => {
  const assembled = [
    { rowid: 1, role: 'user', content: '早的问题' },
    { rowid: 2, role: 'assistant', content: '早的回答' },
    { rowid: 3, role: 'user', content: '新的问题' },
  ];
  const compaction = { summary: '摘要内容', covers_rowid: 2 };
  const view = compaction_moduleView(assembled, compaction);
  assert.deepEqual(view, [
    { role: 'user', content: '[会话早期对话摘要（原文详见会话记录）]\n摘要内容\n[以上为摘要，此后为原文消息]' },
    { role: 'user', content: '新的问题' },
  ]);
});

test('applyCompactionView resilience：附加转写指针与续接纪律', () => {
  const assembled = [
    { rowid: 1, role: 'user', content: '早的问题' },
    { rowid: 2, role: 'assistant', content: '早的回答' },
    { rowid: 3, role: 'user', content: '新的问题' },
  ];
  const compaction = { summary: '摘要内容', covers_rowid: 2 };
  const view = compaction_moduleView(assembled, compaction, {
    resilienceEnabled: true,
    transcriptPath: '/data/llm-transcripts/conv_x.jsonl',
  });
  const summary = view[0].content;
  assert.ok(summary.includes('摘要内容'));
  assert.ok(summary.includes('/data/llm-transcripts/conv_x.jsonl'), 'transcript pointer injected');
  assert.ok(summary.includes('续接纪律'), 'continuation discipline injected');
  assert.ok(summary.includes('[以上为摘要，此后为原文消息]'), 'boundary marker preserved');
  assert.equal(view.length, 2);
});

// 兼容层：conversation-compaction.applyCompactionView 转发
function compaction_moduleView(assembled, compaction, opts) {
  return compactionMod.applyCompactionView(assembled, compaction, opts);
}
