/**
 * nso-w5b-second-truth.test.mjs — BLOCK-366（NSO-W5b）第二真相清理契约。
 *
 *  ①ERROR_I18N 只保留在 core/src 有生产者的错误码（13 个 web 时代死码删除）；
 *  ②恒 null 桩 _loadWorkingTreeRejectEntries 删除；
 *  ③重试分类单源：provider-reliability.shouldRetry 委托网关 isRetryableProviderError，
 *    两分类矩阵逐项一致（评估 F-23「第二重试真相」收编）；
 *  ④token 账本单源：message-trimmer 不再产出第二口径 stats.categories / computeCategories /
 *    analyzeMessageTokens（唯一口径=token-estimator.computeContextBreakdown）；
 *  ⑤runLoop 上下文预算步骤外提为 context-budget-step.js，行为基线拆前拆后同套绿。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });

const spPath = path.join(ROOT, 'core', 'petri-server', 'helpers', 'system-prompt.js');
const spSrc = fs.readFileSync(spPath, 'utf8');

function extractErrorI18NKeys(src) {
  const start = src.indexOf('const ERROR_I18N = {');
  const end = src.indexOf('};', start);
  return [...src.slice(start, end).matchAll(/^\s+([A-Za-z_0-9]+):/gm)].map((m) => m[1]);
}

test('W5b ERROR_I18N 每个保留码在 core/src 都有生产者（-w 全词检索，排除本文件）', () => {
  const keys = extractErrorI18NKeys(spSrc);
  assert.ok(keys.length > 0);
  const dead = keys.filter((code) => {
    const hits = git('grep', '-l', '-w', code, '--', 'core', 'src').split('\n')
      .filter((f) => f && !f.endsWith('core/petri-server/helpers/system-prompt.js'));
    return hits.length === 0;
  });
  assert.deepEqual(dead, [], `以下错误码在 core/src 无生产者（web 时代死码）：${dead.join(', ')}`);
});

test('W5b 已删除的死码不得回潮（此前逐码实证零生产者）', () => {
  for (const code of ['missing_datasetId', 'missing_analysisId', 'parent_not_ready', 'parent_failed', 'quota_exceeded', 'too_many_inflight', 'unknown_resource', 'invalid_tab', 'code_too_long', 'need_2_datasets', 'fact_required', 'fetch_failed', 'fetch_timeout']) {
    assert.ok(!new RegExp(`^\\s+${code}:`, 'm').test(spSrc), `${code} 应已删除`);
  }
  assert.ok(!spSrc.includes('_loadWorkingTreeRejectEntries'), '恒 null 桩应已删除');
});

test('W5b 重试分类单源：provider-reliability.shouldRetry 委托网关判定，矩阵一致', () => {
  const reliabilityPath = path.join(ROOT, 'core', 'shared-backend', 'llm-providers', 'provider-reliability.js');
  const src = fs.readFileSync(reliabilityPath, 'utf8');
  assert.match(src, /isRetryableProviderError/, 'shouldRetry 必须委托网关分类器（不再自持一套阈值）');
  const { shouldRetry } = require(reliabilityPath);
  const { isRetryableProviderError } = require(path.join(ROOT, 'core', 'shared-backend', 'llm-providers', 'model-gateway.js'));
  // 绝对期望值（防「两侧都恒 false」的空洞一致——首版实现即踩此坑，被 provider-protocol 抓到）
  const expected = { 0: true, 400: false, 401: false, 403: false, 408: true, 409: true, 425: true, 429: true, 500: true, 502: true, 503: true };
  for (const [status, want] of Object.entries(expected)) {
    assert.equal(shouldRetry(Number(status)), want, `status ${status} 期望 ${want}`);
    if (Number(status) > 0) {
      assert.equal(shouldRetry(Number(status)), isRetryableProviderError({ error: 'http_error', status: Number(status) }), `status ${status} 与网关一致`);
    }
  }
  assert.equal(shouldRetry(null, new Error('x')), true, '网络层异常恒可重试');
});

test('W5b token 账本单源：trimmer 不再产出第二口径', () => {
  const trimmerPath = path.join(ROOT, 'core', 'petri-server', 'helpers', 'message-trimmer.js');
  const src = fs.readFileSync(trimmerPath, 'utf8');
  for (const symbol of ['stats.categories', 'function computeCategories', 'function analyzeMessageTokens']) {
    assert.ok(!src.includes(symbol), `${symbol} 应删除（唯一口径=computeContextBreakdown）`);
  }
  const { trimMessagesToBudget } = require(trimmerPath);
  const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }];
  const r = trimMessagesToBudget({ fullMessages: msgs, contextWindow: 10000, headroom: 500, systemPromptTokens: 5 });
  assert.equal(r.stats.categories, undefined, 'stats 不再携带第二口径');
});

test('W5b runLoop 上下文预算步骤外提为独立模块且行为一致（拆前拆后同套绿）', async () => {
  const stepPath = path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'context-budget-step.js');
  assert.ok(fs.existsSync(stepPath), 'context-budget-step.js 应存在');
  const { runContextBudgetStep } = require(stepPath);
  assert.equal(typeof runContextBudgetStep, 'function');
  const events = [];
  const messages = [{ role: 'system', content: 'sys' },
    ...Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}:${'lorem ipsum '.repeat(20)}` }))];
  const result = await runContextBudgetStep({
    messages,
    loopContextWindow: 24000,
    reqMaxTokens: 16384,
    toolDefinitionsTokens: 20000,
    modelName: 'test-model',
    contextBudgetTrims: 0,
    contextBudgetHysteresisUntil: 0,
    emit: (e) => events.push(e),
  });
  // 越线 → 预算环(false) + 修剪(true) 两条；跨轮状态以返回值交还调用方
  assert.equal(events.filter((e) => e.event === 'token_budget' && e.trimmed === false).length, 1, '预算环事件每轮发放');
  assert.equal(result.contextBudgetTrims, 1, '修剪次数以返回值交还');
  assert.ok(result.contextBudgetHysteresisUntil > 0, '滞回锚以返回值交还');
});
