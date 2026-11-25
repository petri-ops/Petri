/**
 * G1 首包 W1 — selection→enrichment derived-result candidate cohort，HK-01 红绿先行。
 * owner 裁决 msg_ac7093fe2a26：单一 ChangeSet/Revision Truth、不新增第二套 enrichment 工具、
 * 不放宽 cohort 安全门、legacyAutoAdopt 默认关。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('W1 HK-01：cohort 决策 helper 存在，默认 candidate（不自动 current），legacyAutoAdopt 显式开启才回溯旧行为', () => {
  const f = path.join(ROOT, 'core/shared-backend/result-enrichment-cohort.js');
  assert.ok(fs.existsSync(f), 'result-enrichment-cohort.js 必须新建');
  const { planEnrichmentCohort } = require(f);
  const executed = { ok: true, toolJobId: 'job_enrichment', artifactTruth: { status: 'valid' } };
  const planned = planEnrichmentCohort({ executed });
  assert.equal(planned.mode, 'pending_candidate');
  assert.equal(planned.autoAdopt, false);
  assert.equal(planned.legacy, false);
  assert.deepEqual(planned.requiredStages, ['candidate', 'compare', 'adopt_or_revert', 'replay']);
  // 显式开关才保留旧 dev 行为（默认关）
  const legacy = planEnrichmentCohort({ executed, legacyAutoAdopt: true });
  assert.equal(legacy.mode, 'legacy_auto_current');
  assert.equal(legacy.autoAdopt, true);
  assert.equal(legacy.legacy, true);
});

test('W1 HK-01：cohort 决策 fail-closed——执行失败/证据不全不得登记候选', () => {
  const { planEnrichmentCohort } = require(path.join(ROOT, 'core/shared-backend/result-enrichment-cohort.js'));
  const bad = planEnrichmentCohort({ executed: { ok: false } });
  assert.equal(bad.eligible, false);
  assert.match(bad.reason, /fail_closed|not_ok/i);
  const noTruth = planEnrichmentCohort({ executed: { ok: true } });
  assert.equal(noTruth.eligible, false);
  assert.match(noTruth.reason, /truth|artifact/i);
});

test('W1 HK-01：enrichment 路径接既有 ensureChainRevisions（单一 Truth），不新增第二套工具', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/result-selection-tools.js'), 'utf-8');
  // 既有 Truth 管线（W1 接线点）
  assert.match(src, /ensureChainRevisions/, 'enrichment 路径必须复用既有 candidate cohort 管线');
  // 不新增第二套 enrichment 工具：派生入口仍只有原工具
  const defs = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs/result-studio.js'), 'utf-8');
  const enrichmentDefs = (defs.match(/result_enrichment/g) || []).length;
  assert.ok(enrichmentDefs <= 2, `不得新增第二套 enrichment 工具（当前匹配=${enrichmentDefs}）`);
});

test('W1 HK-01：cohort 安全门零放宽（adopt 仍要求 preview_ready/adopted + 完整 cohort）', () => {
  const repo = fs.readFileSync(path.join(ROOT, 'core/shared-backend/result-studio-repository.js'), 'utf-8');
  assert.match(repo, /draft.*running.*preview_ready.*adopted|preview_ready.*adopted/);
  assert.match(repo, /replay_proof_source_not_adopted/);
  assert.match(repo, /exact complete adopted Revision cohort/i);
});
