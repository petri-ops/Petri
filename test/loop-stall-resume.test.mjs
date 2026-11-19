/**
 * BLOCK-508 HK-01 — agent 循环层 stall-resume 的可执行合同。
 *
 * 红（当前）：loop-stall-resume 模块缺席 → import 失败 / 断言失败。
 * 绿（实现后）：①已出字后 stall 也决定 resume ②重放帧去重 ③有界 ④全失败如实终态。
 *
 * 测试全部走纯函数注入，不依赖真实网关/计时/网络。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shouldResumeOnStall,
  createResumeEventFilter,
  buildGenerationCheckpoint,
  STALL_RESUME_LIMITS,
} from '../core/shared-backend/loop-stall-resume.js';

describe('BLOCK-508 · HK-01 stall-resume 判据（含已出字痛点）', () => {
  const base = {
    error: 'stream_stalled',
    phase: 'idle',
    emittedOutput: true,
    emittedTextLength: 128,
    emittedToolCallIds: ['call_1'],
    attempt: 0,
    elapsedMs: 60_000,
    budgetMs: 10 * 60_000,
    limits: STALL_RESUME_LIMITS,
  };

  it('① 已吐 content/tool_call 后 idle stall 仍决定 resume（507 覆盖不到的痛点）', () => {
    const v = shouldResumeOnStall(base);
    assert.equal(v.action, 'resume', '已出字后停摆也必须自动续跑，不能 break');
    assert.equal(v.reason, 'stall_with_visible_output_resumable');
  });

  it('② 零可见输出 stall 同样 resume（既有场景不回退）', () => {
    const v = shouldResumeOnStall({ ...base, emittedOutput: false, emittedTextLength: 0, emittedToolCallIds: [] });
    assert.equal(v.action, 'resume');
    assert.equal(v.reason, 'stall_no_visible_output');
  });

  it('③ 有界：attempt 超上限/预算耗尽 → terminal，不无限重试', () => {
    assert.equal(shouldResumeOnStall({ ...base, attempt: STALL_RESUME_LIMITS.maxAttempts }).action, 'terminal');
    assert.equal(shouldResumeOnStall({ ...base, elapsedMs: base.budgetMs + 1 }).action, 'terminal');
    assert.equal(shouldResumeOnStall({ ...base, error: 'auth_error' }).action, 'terminal', '非 stall 错误不续跑');
  });

  it('④ 非 stall 错误（含已出字）永不 resume', () => {
    assert.equal(shouldResumeOnStall({ ...base, error: 'rate_limit' }).action, 'terminal');
  });
});

describe('BLOCK-508 · HK-01 重放去重（已交付内容零重复）', () => {
  it('① 已发文本累计长度内的 delta 被吞，超出部分透传', () => {
    const filter = createResumeEventFilter({ emittedTextLength: 5, emittedToolCallIds: [] });
    // 重放首条 delta 含已发前缀 'hello' + 新内容 ' world' → 只透传新内容
    assert.deepEqual(filter({ type: 'content_delta', content: 'hello world' }), { type: 'content_delta', content: ' world', suppressed: false });
    // 游标已耗尽，后续增量全透传
    assert.deepEqual(filter({ type: 'content_delta', content: '!' }), { type: 'content_delta', content: '!', suppressed: false });
    // 另一路：重放首条只含已发前缀 → 整条吞
    const f2 = createResumeEventFilter({ emittedTextLength: 5, emittedToolCallIds: [] });
    assert.deepEqual(f2({ type: 'content_delta', content: 'hello' }), { type: 'content_delta', content: '', suppressed: true });
  });

  it('② 已交付 tool_call id 整条丢弃，新 id 透传', () => {
    const filter = createResumeEventFilter({ emittedTextLength: 0, emittedToolCallIds: ['c1'] });
    const dup = filter({ type: 'tool_call_delta', id: 'c1', arguments: '{}' });
    assert.equal(dup.suppressed, true);
    const fresh = filter({ type: 'tool_call_delta', id: 'c2', arguments: '{}' });
    assert.equal(fresh.suppressed, false);
  });

  it('③ 非 delta 事件（done/usage/error/stall/provider_retry）一律透传不外挂 suppressed', () => {
    const filter = createResumeEventFilter({ emittedTextLength: 10, emittedToolCallIds: [] });
    for (const e of [
      { type: 'done' },
      { type: 'usage', usage: {} },
      { type: 'error', message: 'x' },
      { type: 'stream_stall', phase: 'idle' },
      { type: 'provider_retry', attempt: 2 },
    ]) {
      assert.deepEqual(filter(e), e, `${e.type} 必须原样透传`);
    }
  });

  it('④ reasoning_delta 不算可见交付，不去重（续跑后仍可见）', () => {
    const filter = createResumeEventFilter({ emittedTextLength: 10, emittedToolCallIds: [] });
    assert.equal(filter({ type: 'reasoning_delta', content: 'x' }).suppressed, undefined);
  });
});

describe('BLOCK-508 · HK-01 请求前 checkpoint（续跑现场）', () => {
  it('① 记录 messages 摘要/已发帧游标/tool_call id/attempt，不复制 messages 正文', () => {
    const cp = buildGenerationCheckpoint({
      messages: [{ role: 'user', content: 'x'.repeat(1000) }],
      emittedTextLength: 12,
      emittedToolCallIds: ['c1'],
      attempt: 0,
      requestHash: 'abc',
    });
    assert.equal(cp.emittedTextLength, 12);
    assert.deepEqual(cp.emittedToolCallIds, ['c1']);
    assert.equal(cp.attempt, 0);
    assert.equal(cp.requestHash, 'abc');
    assert.ok(cp.messagesDigest && cp.messagesDigest.length <= 64, '只存摘要不复制正文');
    assert.ok(!JSON.stringify(cp).includes('x'.repeat(1000)), 'checkpoint 不得内嵌大正文');
  });
});

describe('BLOCK-508 · orchestrator 接线合同（结构断言）', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/loop-orchestrator.js'), 'utf8');

  it('① 引入 508 纯函数模块并用于决策', () => {
    assert.match(src, /require\(['"]\.\.\/shared-backend\/loop-stall-resume['"]\)/);
    assert.match(src, /shouldResumeStall508\(\{/);
  });

  it('② stall-resume while 循环存在且 resume 时 continue（不是 break）', () => {
    const stallBlock = src.slice(src.indexOf('BLOCK-508 — 外层 stall-resume'), src.indexOf('// BLOCK-56 P1 — finalization 档'));
    assert.ok(stallBlock.length > 200, 'stall-resume 接线段必须在');
    assert.match(stallBlock, /for \(;;\)/);
    assert.match(stallBlock, /verdict508\.action === 'resume'/);
    assert.match(stallBlock, /continue;/);
    assert.match(stallBlock, /srReplayFilter = createResumeFilter508\(/);
  });

  it('③ onEvent 入口吞掉重放抑制帧，用户侧零重复', () => {
    assert.match(src, /event = srReplayFilter\(event\)/);
    assert.match(src, /event\.suppressed === true\) return/);
  });

  it('④ 既有终态判定保留（非 stall 仍按原逻辑 break）', () => {
    assert.match(src, /if \(!finalizing && \(!upJson \|\| upJson\.error \|\| !upJson\.choices\)\)/);
  });
});
