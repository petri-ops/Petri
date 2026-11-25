/**
 * G1 首包 W3 — historical alternative compare 可观测契约（HK-01 红绿先行）。
 * owner 裁决 msg_d8df1b1e636f 第③项：本机做 W3 前提成立子项，HK-01 红绿+既有门零放宽，
 * 不新增第二套 compare；Git consent 按 UI-462 失效挂账（见 W3-SCOPE-NOTE）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

test('W3 HK-01：historical alternative = 真 restore 为新 Revision cohort（非 harness 拼装）', () => {
  const { restoreArtifactRevision } = require(path.join(ROOT, 'core/shared-backend/result-compare-service.js'));
  assert.equal(typeof restoreArtifactRevision, 'function');
  const src = read('core/shared-backend/result-compare-service.js');
  assert.match(src, /restoredFromChangeSetId/);
  assert.match(src, /restoredCohortRevisionIds|cohortRevisionIds/);
  assert.match(src, /historical_changeset_cohort/);
  // 已有机械回归（RS6）：restore 不改写目标、生成新 commit+Revision cohort
  const t = read('test/result-compare-service.test.mjs');
  assert.match(t, /RS6 restores history as a new commit and Revision without rewriting the target/);
});

test('W3 HK-01：historical restore 门零放宽——只能从正式 adopted cohort 恢复', () => {
  const src = read('core/shared-backend/result-studio-repository.js');
  assert.match(src, /Revision cannot be restored from ChangeSet status/);
  assert.match(src, /\['adopted',\s*'reverted'\]/);
  assert.match(src, /revision_restore_never_adopted/);
  const cmp = read('core/shared-backend/result-compare-service.js');
  assert.match(cmp, /restore_cohort_family_duplicate/);
});

test('W3 HK-01：Git consent 按 UI-462 失效——不加前端 consent UI、不复活退役能力', () => {
  const bind = read('core/shared-backend/git-repository-binding.js');
  assert.match(bind, /接入用户自有仓库.*退役|只剩 managed/);
  const note = read('acceptance/g1-rs-requalification/W3-SCOPE-NOTE.md');
  assert.match(note, /UI-462/);
  assert.match(note, /失效挂账|不复活/);
  // 勘误注记已补在 G1-READINESS 防下一读者踩旧表述
  const readiness = read('acceptance/g1-readiness/G1-READINESS-2026-11-24.md');
  assert.match(readiness, /勘误注记/);
  assert.match(readiness, /UI-462/);
});
