/**
 * K7 总收口契约（32 条逐件终态、十一维六列复评、边界项不冒充）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectFinalTruth, adjudicateFinal, REVIEW_TABLE, WIP_ASSETS, PROGRAM_DIR,
} from '../scripts/lib/post-h9-k7-final.mjs';
import { validateLedger } from '../scripts/lib/post-h9-gap-ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const truth = collectFinalTruth(ROOT);

test('K7：32 条缺口全部定终态，零 in_progress，计数机械汇总', () => {
  const v = adjudicateFinal(truth);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.equal(v.verdict, 'post-h9-program-final-closeout-verified-with-open-boundaries');
  assert.equal(Object.values(v.terminalCounts).reduce((a, b) => a + b, 0), 32);
  assert.equal(v.terminalCounts.in_progress, undefined);
  const ledgerCheck = validateLedger(truth.ledger, { root: ROOT, requireAllClosed: true });
  assert.equal(ledgerCheck.ok, true, ledgerCheck.issues.join(' / '));
});

test('K7：八阶段门禁证据齐全且全部 passed', () => {
  assert.equal(Object.keys(truth.gates).length, 7);
  for (const [k, g] of Object.entries(truth.gates)) assert.equal(g.verdict, 'passed', k);
});

test('K7：十一维六列复评完整，差值逐条归因，零降分', () => {
  assert.equal(REVIEW_TABLE.length, 11);
  const v = adjudicateFinal(truth);
  assert.equal(v.reviewSummary.up, 4);
  assert.equal(v.reviewSummary.flat, 7);
  assert.equal(v.reviewSummary.down, 0);
  for (const r of REVIEW_TABLE) {
    assert.ok(r.final >= r.h9, `${r.dim} 不得回溯调参`);
    assert.ok(r.attribution.length >= 20, `${r.dim} 归因过短`);
    assert.match(r.attribution, /K[0-6]|证据|提交|未|挂起|平/);
  }
});

test('K7：前五列沿用蓝图 §0.3，不回溯改写历史评分', () => {
  const by = Object.fromEntries(REVIEW_TABLE.map((r) => [r.dim, r]));
  assert.equal(by['功能完整性'].atEval, 4.2);
  assert.equal(by['性能表现'].nso, 3.8);
  assert.equal(by['代码质量'].h9, 4.0);
  assert.equal(by['文档完善度'].h7, 4.7);
  assert.equal(by['依赖与架构合理性'].h9, 4.0);
});

test('K7：真实任务当次证据为 external-blocked，不冒充 8/8 或真实任务成功', () => {
  const t = truth.taskSuite;
  assert.equal(t.verdict, 'external-blocked');
  assert.equal(t.evidenceClass, 'decision-material');
  assert.equal(t.tasksClaimed8of8, false);
  assert.equal(t.realTaskSuccess, false);
  assert.equal(t.humanEyeSignaturePresent, false);
  assert.equal(t.evalsRealAttempt.exitCode, 124);
  assert.equal(t.eightTaskAttempt.exitCode, 124);
  assert.match(t.externalBlockedReason, /ETIMEDOUT|超时/);
});

test('K7：凭据口径按运行时读数校准（本机 keychain 可用，非 0 key）', () => {
  const c = truth.taskSuite.credentialFacts;
  assert.equal(c.credentialBackend, 'keychain');
  assert.equal(c.deepseekConfigured, true);
  assert.equal(c.credentialStatusDeepseek, true);
  assert.equal(c.chatModelPresets, 4);
  assert.equal(c.envCredentialLikeKeys, 0);
  assert.match(c.calibration, /纠正|不成立/);
});

test('K7：出网归因区分 HTTP 401/200 与 provider 端点 TCP ETIMEDOUT', () => {
  const o = truth.taskSuite.outboundFacts;
  assert.equal(o.deepseekApiHttpCode, 401);
  assert.equal(o.genericOutboundHttpCode, 200);
  assert.match(o.providerEndpointConnect, /ETIMEDOUT/);
});

test('K7：人眼路线签名区仍空，Agent 不代答', () => {
  assert.equal(truth.humanEyeRouteSigned, false);
  assert.equal(truth.taskSuite.humanEyePending, 8);
  const route = fs.readFileSync(path.join(ROOT, 'docs/post-s7-h7-human-eye-route.md'), 'utf8');
  assert.match(route, /确认人：\s*\n日期：/);
});

test('K7：10 项用户资产与蓝图原件零触碰', () => {
  assert.equal(WIP_ASSETS.length, 10);
  assert.ok(WIP_ASSETS.includes('docs/post-h9-optimization-blueprint-2026-11-10.md'));
  const l = JSON.parse(fs.readFileSync(path.join(ROOT, PROGRAM_DIR, 'gap-terminal-ledger.json'), 'utf8'));
  assert.equal(l.program, 'post-h9-2026-11-10');
  assert.equal(l.gaps.length, 32);
});

// ---- 负测 ----
test('负测：冒充 8/8 成功 → 判红', () => {
  const v = adjudicateFinal({ ...truth, taskSuite: { ...truth.taskSuite, tasksClaimed8of8: true } });
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.includes('8/8')));
});

test('负测：伪造人眼签字 → 判红', () => {
  const v = adjudicateFinal({ ...truth, humanEyeRouteSigned: true });
  assert.equal(v.ok, false);
});

test('负测：删一条缺口 / 残留 in_progress → 判红', () => {
  const l = { ...truth.ledger, gaps: truth.ledger.gaps.slice(0, 31) };
  assert.equal(adjudicateFinal({ ...truth, ledger: l }).ok, false);
  const l2 = { ...truth.ledger, gaps: truth.ledger.gaps.map((g) => (g.id === 'K-30' ? { ...g, terminal: 'in_progress' } : g)) };
  assert.equal(adjudicateFinal({ ...truth, ledger: l2 }).ok, false);
});

test('负测：复评少一列 / 删归因 / 回溯降分 / 门禁 verdict 改红 → 判红', () => {
  const r0 = REVIEW_TABLE[0];
  assert.equal(adjudicateFinal({ ...truth, review: REVIEW_TABLE.slice(0, 10) }).ok, false);
  assert.equal(adjudicateFinal({ ...truth, review: [{ ...r0, attribution: '' }, ...REVIEW_TABLE.slice(1)] }).ok, false);
  assert.equal(adjudicateFinal({ ...truth, review: [{ ...r0, final: 4.3 }, ...REVIEW_TABLE.slice(1)] }).ok, false);
  assert.equal(adjudicateFinal({ ...truth, gates: { ...truth.gates, k0: { verdict: 'failed' } } }).ok, false);
});

test('负测：事实整体缺席 → fail-closed 判红', () => {
  assert.equal(adjudicateFinal({}).ok, false);
});
