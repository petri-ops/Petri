/**
 * BLOCK-119 P2 — 子智能体汇报门契约（默认关零行为/fail-open/RETRY×1 带判词重写/复判标注）。
 *
 * 契约红线（plan §P2 + helpers/report-guard.js 头注）：
 *  - 默认关：BIOF3_JEV_REPORT_GUARD≠1 → 结果对象原样返回（零出站零改动）；
 *  - 非 subagent（enabled=false）→ 同上；
 *  - 降级（决策失败）=放行 + degraded 标注；
 *  - RETRY → 恰好一次 callProvider 重写（带判词 prompt）+ 一次复判（verdictAfter）；
 *  - ESCALATE/PASS → 不重写，原样透传 + meta；
 *  - 任何异常 fail-open 原样透传。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const reportGuard = require(path.join(root, 'core', 'biof3-server', 'helpers', 'report-guard.js'));

const NO_SLEEP = async () => {};
const API_KEY_OVERRIDE = { apiKey: 'test-key-do-not-call-real-api' };

function fitFetch(score, model = 'jev-1.13.0') {
  const levels = 5;
  const center = Math.min(levels - 1, Math.max(0, Math.round(score)));
  const probs = Array.from({ length: levels }, () => 0);
  probs[center] = 0.8;
  for (let i = 0; i < levels; i++) if (i !== center) probs[i] = 0.2 / (levels - 1);
  const expected = probs.reduce((a, p, i) => a + i * p, 0);
  return async () => ({
    ok: true, status: 200,
    json: async () => ({ model, answers: { fit: { type: 'score', score: expected, probabilities: Object.fromEntries(probs.map((p, i) => [String(i), p])) } } }),
  });
}

function useEnv(t, env) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  t.after(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

test('默认关：env≠1 → 原样返回零出站', async (t) => {
  useEnv(t, { BIOF3_JEV_REPORT_GUARD: undefined });
  let calls = 0;
  const result = { assistantText: '汇报' };
  const r = await reportGuard.applyToLoopResult(result, {
    enabled: true, request: '任务',
    callProvider: async () => { calls++; return {}; },
    decisionOverrides: { ...API_KEY_OVERRIDE, fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => ({ answers: {} }) }; }, sleep: NO_SLEEP },
  });
  assert.equal(r, result);
  assert.equal(calls, 0, '关闭态零出站（决策与重写都不发生）');
  assert.equal(r.reportGuardMeta, undefined);
});

test('enabled=false（非 subagent）→ 原样返回', async (t) => {
  useEnv(t, { BIOF3_JEV_REPORT_GUARD: '1' });
  const result = { assistantText: '汇报' };
  const r = await reportGuard.applyToLoopResult(result, {
    enabled: false, request: '任务',
    decisionOverrides: { ...API_KEY_OVERRIDE, fetchImpl: async () => { throw new Error('must not call'); }, sleep: NO_SLEEP },
  });
  assert.equal(r, result);
});

test('PASS：透传 + meta（不重写）', async (t) => {
  useEnv(t, { BIOF3_JEV_REPORT_GUARD: '1' });
  let providerCalls = 0;
  const result = { assistantText: '已核对：文件 12 个，其中脚本 3 个。' };
  const r = await reportGuard.applyToLoopResult(result, {
    enabled: true, request: '列出文件并统计',
    callProvider: async () => { providerCalls++; return {}; },
    decisionOverrides: { ...API_KEY_OVERRIDE, fetchImpl: fitFetch(3.8), sleep: NO_SLEEP },
  });
  assert.equal(r.assistantText, '已核对：文件 12 个，其中脚本 3 个。', 'PASS 不重写');
  assert.equal(providerCalls, 0);
  assert.equal(r.reportGuardMeta.verdict, 'PASS');
  assert.ok(r.reportGuardMeta.fit >= 3);
});

test('RETRY：恰一次带判词重写 + 复判标注', async (t) => {
  useEnv(t, { BIOF3_JEV_REPORT_GUARD: '1' });
  let providerCalls = 0;
  let judgeCalls = 0;
  // 首判 retry 区（2.75），复判 pass 区（3.5）
  const fetchImpl = async () => {
    judgeCalls++;
    return fitFetch(judgeCalls === 1 ? 2.7 : 3.8)();
  };
  const result = { assistantText: '跑偏的汇报：与任务无关的长篇背景介绍。' };
  const r = await reportGuard.applyToLoopResult(result, {
    enabled: true, request: '列出文件并统计',
    callProvider: async (body) => {
      providerCalls++;
      assert.equal(body.messages.length, 1);
      assert.match(body.messages[0].content, /检查判词/, '重写 prompt 带判词');
      return { choices: [{ message: { content: '已核对：文件 12 个。' } }] };
    },
    decisionOverrides: { ...API_KEY_OVERRIDE, fetchImpl, sleep: NO_SLEEP },
  });
  assert.equal(providerCalls, 1, 'RETRY 恰一次重写');
  assert.equal(judgeCalls, 2, '首判+复判');
  assert.equal(r.assistantText, '已核对：文件 12 个。', '重写结果生效');
  assert.equal(r.reportGuardMeta.rewritten, true);
  assert.equal(r.reportGuardMeta.verdict, 'RETRY');
  assert.equal(r.reportGuardMeta.verdictAfter, 'PASS');
});

test('ESCALATE：不重写原样透传 + meta', async (t) => {
  useEnv(t, { BIOF3_JEV_REPORT_GUARD: '1' });
  let providerCalls = 0;
  const result = { assistantText: '完全无关内容。' };
  const r = await reportGuard.applyToLoopResult(result, {
    enabled: true, request: '列出文件并统计',
    callProvider: async () => { providerCalls++; return {}; },
    decisionOverrides: { ...API_KEY_OVERRIDE, fetchImpl: fitFetch(1.2), sleep: NO_SLEEP },
  });
  assert.equal(providerCalls, 0, 'ESCALATE 不重写（父级/用户即升级面）');
  assert.equal(r.assistantText, '完全无关内容。');
  assert.equal(r.reportGuardMeta.verdict, 'ESCALATE');
});

test('降级：决策失败=fail-open 放行 + degraded 标注', async (t) => {
  useEnv(t, { BIOF3_JEV_REPORT_GUARD: '1' });
  const impl = async () => { const e = new Error('TimeoutError'); e.name = 'TimeoutError'; throw e; };
  const result = { assistantText: '汇报' };
  const r = await reportGuard.applyToLoopResult(result, {
    enabled: true, request: '任务',
    decisionOverrides: { ...API_KEY_OVERRIDE, fetchImpl: impl, sleep: NO_SLEEP },
  });
  assert.equal(r.assistantText, '汇报');
  assert.equal(r.reportGuardMeta.degraded, true);
  assert.equal(r.reportGuardMeta.verdict, 'PASS', '降级=放行语义');
});
