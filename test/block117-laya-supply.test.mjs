/**
 * BLOCK-117 P0 — 本地 Laya 供给线兼容契约（plan docs/block-117-laya-supply-validation-plan.md §1.1 P0）。
 *
 * 契约红线：
 *  - 真实 Laya 响应 fixtures（laya_decide serve /v1/systemone 捕获）必须通过 decision-api.js
 *    现行 validateAnswers 全题型校验——Petri 客户端零改动消费本地供给的机械承载；
 *  - 七接点 Jev 注册表零漂移：本包不改变任何 Jev 供给阈值/gates/model/证据绑定
 *    （「无证据不改阈值」红线；Laya 裁决走 P1 证据与 P2 写回，不在此偷换）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const decisionApi = require(path.join(root, 'core', 'petri-server', 'helpers', 'decision-api.js'));
const thresholds = require(path.join(root, 'core', 'petri-server', 'helpers', 'decision-thresholds.js'));

const FIXTURES_DIR = path.join(root, 'acceptance', 'block-117', 'fixtures');
const FIXTURES = ['laya-answers-stuck-loop.json', 'laya-answers-test-weakening.json'];

test('P0 线兼容：真实 Laya 响应 fixtures 通过 decision-api 请求/响应全量校验', () => {
  for (const name of FIXTURES) {
    const doc = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
    assert.equal(doc.capture, 'block117-p0', `${name} 捕获标记在位`);
    assert.ok(doc.response && doc.response.answers, `${name} 含 answers`);

    const shape = decisionApi.validateQuestions(doc.questions);
    assert.equal(shape.ok, true, `${name} 请求形状：${shape.reason || 'ok'}`);

    const verdict = decisionApi.validateAnswers(doc.questions, doc.response.answers);
    assert.equal(verdict.ok, true, `${name} 响应校验：${verdict.reason || 'ok'}`);

    // 每题型至少一例真实覆盖（choice/noul 在 stuck-loop，score 在 test-weakening）
    for (const qid of Object.keys(doc.questions)) {
      assert.equal(doc.response.answers[qid].type, doc.questions[qid].type, `${name}.${qid} 题型一致`);
    }
  }
  const allTypes = new Set(FIXTURES.flatMap((name) =>
    Object.values(JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')).questions)
      .map((q) => q.type)));
  for (const t of ['choice', 'noul', 'score']) {
    assert.ok(allTypes.has(t), `fixtures 覆盖题型 ${t}`);
  }
});

test('P0 红线：Jev 注册表零漂移（本包不改任何 Jev 供给阈值/证据绑定）', () => {
  const PINNED = {
    'topic-shift': { gates: { yes: 0.85, no: 0.5 }, evidence: 'acceptance/block-110/calibration.json', model: 'jev-1.13.0' },
    'knowledge-guard': { gates: { relevantMin: 0.5, injectionMax: 0.7 }, evidence: 'acceptance/block-110/calibration.json', model: 'jev-1.13.0' },
    'marker-celltype': { threshold: 0.55, evidence: 'acceptance/block-111/calibration.json', model: 'jev-1.13.0' },
    'intent-route': { threshold: 0.7, evidence: 'acceptance/block-112/calibration.json', model: 'jev-1.13.0' },
    'tool-route': { threshold: 0.8, evidence: 'acceptance/block-113/calibration.json', model: 'jev-1.13.0' },
    'failure-triage': { threshold: 0.7, evidence: 'acceptance/block-114/calibration.json', model: 'jev-1.13.0' },
    'test-suggest': { threshold: 0.8, evidence: 'acceptance/block-115/calibration.json', model: 'jev-1.13.0' },
    // BLOCK-118 P1 起注册表实际含 doc-suggest（当时钉住未随更，BLOCK-165 全量复验对账补齐）
    'doc-suggest': { gates: { planDoc: 0.5 }, evidence: 'acceptance/block-118/calibration-doc-suggest-cloud.json', model: 'jev-1.13.0' },
    // BLOCK-119 起注册表实际含 output-judge（同上对账补齐）
    'output-judge': {
      evidence: 'acceptance/block-119/calibration-judge-fit.json',
      evidenceFaithfulGoal: 'acceptance/block-119/calibration-judge-faithful-goal.json',
      evidenceFitVolatility: 'acceptance/block-119/fit-volatility-review.json',
      gates: { faithfulPass: 0.3, fitPass: 3, fitRetry: 2.5, fitReviewBand: 0.5, goalPass: 0.5 },
      model: 'jev-1.13.0'
    },
  };
  assert.deepEqual(thresholds, { thresholdForPoint: thresholds.thresholdForPoint, configForPoint: thresholds.configForPoint, ...PINNED },
    '注册表与钉住值逐键一致（含函数成员外的全部接点）');
  for (const [point, entry] of Object.entries(PINNED)) {
    assert.ok(fs.existsSync(path.join(root, entry.evidence)), `${point} 证据文件在位`);
  }
});
