/**
 * G1 首包 W2 — affected-subgraph lifecycle 产品契约核验（HK-01 红绿先行）。
 * owner 裁决 msg_77f1c1fe2cbe：本机做 affected-subgraph 契约、既有门零放宽；heatmap 挂账。
 * 核码结论：affectedScope 规划/消费/展示已在多端在场——本测试把散落契约串成可观测链，
 * 不新增第二套 planning（与 W1 同构：既有设施齐备就不造第二套）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

test('W2 HK-01：affected-subgraph 规划真实存在——workflow DAG BFS + fail-closed 缺 DAG', () => {
  const { computeResultAffectedSubgraph } = require(path.join(ROOT, 'core/shared-backend/result-edit-intent.js'));
  const bad = computeResultAffectedSubgraph({ editClass: 'scientific_recompute', workflowPlan: null });
  assert.equal(bad.ok, false);
  assert.ok(bad.diagnostics.some((d) => /workflow_dag_missing/.test(d.code || d.message || '')));
  const good = computeResultAffectedSubgraph({
    editClass: 'scientific_recompute',
    workflowPlan: {
      workflowTruthVersion: 1, authority: 'sqlite_job_artifact_truth',
      graphId: 'wfg_test', sourceDigest: 'd'.repeat(64), rootToolJobId: 'tj_deg',
      steps: [
        { id: 'deg', dependsOn: [] },
        { id: 'enrich', dependsOn: ['deg'] },
        { id: 'report', dependsOn: ['enrich'] },
      ],
    },
    sourceNodeId: 'deg',
  });
  assert.equal(good.ok, true);
  assert.equal(good.affectedScope, 'workflow_subgraph');
  assert.deepEqual(good.affectedNodeIds, ['deg', 'enrich', 'report']);
});

test('W2 HK-01：affected 契约被产品链多端消费（非 harness 拼装）', () => {
  // 规划 → 回执
  const ctxEdit = read('core/petri-server/agent-tools/result-context-edit-tools.js');
  assert.match(ctxEdit, /affectedScope:\s*planned\.intent\?\.affectedScope/);
  // 解释/门控
  const controls = read('core/shared-backend/result-edit-controls.js');
  assert.match(controls, /explainEditImpact/);
  assert.match(controls, /current_result_only.*workflow_subgraph/);
  // replay 传播
  const replay = read('core/shared-backend/result-replay-service.js');
  assert.match(replay, /createReplayIntent/);
  assert.match(replay, /affectedScope:\s*workflowSubgraph/);
  // 落 changeset validationSummary
  const changeset = read('core/shared-backend/result-changeset-service.js');
  assert.match(changeset, /affectedScope:\s*input\.intent\.affectedScope/);
  // 前端可见（产品 UI 而非只有后端）
  const ui = read('frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx');
  assert.match(ui, /validationSummary\?\.affectedScope/);
});

test('W2 HK-01：affected scope 白名单零放宽（只允许三种诚实边界）', () => {
  const { validateResultEditIntent } = require(path.join(ROOT, 'core/shared-backend/result-edit-intent.js'));
  const base = {
    contractVersion: '1', intentId: 'intent_w2', artifactRef: { artifactId: 'a', revisionId: 'r' },
    requestedOutcome: 'x', editClass: 'view_only', affectedNodeIds: ['a'],
    requiresJob: false, requiresScientificConfirmation: false,
  };
  const ok = validateResultEditIntent({ ...base, affectedScope: 'workflow_subgraph' });
  assert.equal(ok.ok, true);
  const widened = validateResultEditIntent({ ...base, affectedScope: 'whole_world_unbounded' });
  assert.equal(widened.ok, false);
  assert.ok(widened.errors.some((e) => /affected_scope_invalid/.test(e.code || e.message || '')));
});
