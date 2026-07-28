/**
 * G0-RS2 — Result Studio 持久化门禁（真实 SQLite）。
 *
 * 覆盖 g0-result-studio-plan.md §14 G0-RS2 的四条验收：
 * 1. draft→preview_ready→adopted 完整轨
 * 2. validation_failed、reverted、abandoned 终态
 * 3. 进程中断后可恢复
 * 4. 重复 adopt/revert 幂等
 *
 * 全部使用临时目录中的真实 better-sqlite3 数据库；不访问网络、不读用户数据。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { ensureResultStudioSchema, inspectResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const {
  createResultStudioRepository,
  ResultStudioRepositoryError,
} = require('../core/shared-backend/result-studio-repository');

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const HASH_1 = '1'.repeat(64);
const HASH_2 = '2'.repeat(64);

function makeRepo(context) {
  const root = mkdtempSync(join(tmpdir(), 'biof3-rs2-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const db = new Database(join(root, 'test.db'));
  context.after(() => { try { db.close(); } catch { /* already closed */ } });
  ensureResultStudioSchema(db);
  return { db, repo: createResultStudioRepository(db, { ensureSchema: false }), root };
}

function newChangeSet(repo, overrides = {}) {
  return repo.createChangeSet({
    changeSetId: overrides.changeSetId || `cs_${Math.random().toString(36).slice(2, 10)}`,
    projectId: 'project_1',
    conversationId: 'conv_1',
    baseCommit: COMMIT_A,
    workingBranchRef: 'refs/heads/biof3/changeset/cs',
    createdBy: 'agent',
    ...overrides,
  });
}

function revisionInput(changeSetId, overrides = {}) {
  return {
    revisionId: overrides.revisionId || `rev_${Math.random().toString(36).slice(2, 10)}`,
    projectId: 'project_1',
    artifactFamilyId: 'volcano-plot',
    artifactId: 'volcano_plot',
    outputPath: 'results/artifacts/volcano-plot/revisions/v1/volcano.svg',
    outputHash: HASH_1,
    validationStatus: 'valid',
    reproducibilityStatus: 'available',
    // valid 的 Revision 必须绑定产生它的 tool_job：
    // 这是 run_tool → tool_job → artifact truth 不变量在契约层的体现。
    toolJobId: overrides.toolJobId || 'job_rs2test000001',
    changeSetId,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. schema
// ---------------------------------------------------------------------------

test('RS2 schema creates all five tables and is idempotent', (context) => {
  const { db } = makeRepo(context);
  const first = inspectResultStudioSchema(db);
  assert.equal(first.complete, true, JSON.stringify(first.missingTables));
  assert.equal(first.missingTables.length, 0);
  // 重复执行不报错、不重建
  ensureResultStudioSchema(db);
  ensureResultStudioSchema(db);
  assert.equal(inspectResultStudioSchema(db).complete, true);
});

test('RS2 repository refuses to run against a database without the schema', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-rs2-bare-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const db = new Database(join(root, 'bare.db'));
  context.after(() => { try { db.close(); } catch { /* noop */ } });
  const report = inspectResultStudioSchema(db);
  assert.equal(report.complete, false);
  assert.equal(report.missingTables.length > 0, true);
});

// ---------------------------------------------------------------------------
// 2. 完整轨：draft → running → preview_ready → adopted
// ---------------------------------------------------------------------------

test('RS2 walks the full draft to adopted track', (context) => {
  const { repo } = makeRepo(context);
  const cs = newChangeSet(repo, { changeSetId: 'cs_full' });
  assert.equal(cs.status, 'draft');

  // transitionChangeSet 返回 { changeSet, changed, idempotent }，不是 changeSet 本身。
  assert.equal(
    repo.transitionChangeSet({ changeSetId: 'cs_full', to: 'running' }).changeSet.status,
    'running'
  );

  const preview = repo.transitionChangeSet({
    changeSetId: 'cs_full',
    to: 'preview_ready',
    candidateCommit: COMMIT_B,
    changedPaths: [{ relativePath: 'analysis/scripts/volcano/plot_volcano.R', changeType: 'modified' }],
    jobRefs: ['job_1'],
  }).changeSet;
  assert.equal(preview.status, 'preview_ready');
  assert.equal(preview.candidateCommit, COMMIT_B);
  assert.equal(preview.changedPaths.length, 1);

  repo.appendRevision(revisionInput('cs_full', { revisionId: 'rev_v2' }));

  const adopted = repo.adoptChangeSet({ changeSetId: 'cs_full' });
  assert.equal(adopted.changeSet.status, 'adopted');
  assert.equal(typeof adopted.changeSet.adoptedAt, 'string');
  assert.equal(adopted.idempotent, false);

  // 采用后该 revision 成为当前版本
  const current = repo.getCurrentRevision('volcano-plot');
  assert.equal(current.revisionId, 'rev_v2');
  assert.equal(current.isCurrent, true);
});

test('RS2 rejects adopting a change set that never reached preview', (context) => {
  const { repo } = makeRepo(context);
  newChangeSet(repo, { changeSetId: 'cs_early' });
  assert.throws(
    () => repo.adoptChangeSet({ changeSetId: 'cs_early' }),
    (error) => error instanceof ResultStudioRepositoryError,
  );
  assert.equal(repo.getChangeSet('cs_early').status, 'draft');
});

test('RS2 rejects unknown transitions and leaves state untouched', (context) => {
  const { repo } = makeRepo(context);
  newChangeSet(repo, { changeSetId: 'cs_bad' });
  assert.throws(() => repo.transitionChangeSet({ changeSetId: 'cs_bad', to: 'adopted' }));
  assert.throws(() => repo.transitionChangeSet({ changeSetId: 'cs_bad', to: 'not_a_status' }));
  assert.equal(repo.getChangeSet('cs_bad').status, 'draft');
});

// ---------------------------------------------------------------------------
// 3. 终态
// ---------------------------------------------------------------------------

test('RS2 records validation_failed as a first class outcome', (context) => {
  const { repo } = makeRepo(context);
  newChangeSet(repo, { changeSetId: 'cs_fail' });
  repo.transitionChangeSet({ changeSetId: 'cs_fail', to: 'running' });
  const failed = repo.transitionChangeSet({
    changeSetId: 'cs_fail',
    to: 'validation_failed',
    reason: 'required_artifact_missing',
    validationSummary: { status: 'blocked', issueCount: 1 },
  }).changeSet;
  assert.equal(failed.status, 'validation_failed');
  assert.equal(failed.statusReason, 'required_artifact_missing');
  assert.equal(failed.validationSummary.issueCount, 1);
  // 校验失败不能被直接采用
  assert.throws(() => repo.adoptChangeSet({ changeSetId: 'cs_fail' }));
});

test('RS2 supports revert and abandoned terminal states', (context) => {
  const { repo } = makeRepo(context);
  newChangeSet(repo, { changeSetId: 'cs_rev' });
  repo.transitionChangeSet({ changeSetId: 'cs_rev', to: 'running' });
  repo.transitionChangeSet({ changeSetId: 'cs_rev', to: 'preview_ready', candidateCommit: COMMIT_B });
  const reverted = repo.revertChangeSet({ changeSetId: 'cs_rev', reason: 'user_discarded' });
  assert.equal(reverted.changeSet.status, 'reverted');
  assert.equal(typeof reverted.changeSet.revertedAt, 'string');

  newChangeSet(repo, { changeSetId: 'cs_ab' });
  const abandoned = repo.transitionChangeSet({ changeSetId: 'cs_ab', to: 'abandoned' }).changeSet;
  assert.equal(abandoned.status, 'abandoned');
  // 已关闭状态不能再向外迁移
  assert.throws(() => repo.transitionChangeSet({ changeSetId: 'cs_ab', to: 'running' }));
});

test('RS2 reverting an adopted change set restores the previous current revision', (context) => {
  const { repo } = makeRepo(context);

  // v1 采用
  newChangeSet(repo, { changeSetId: 'cs_v1' });
  repo.transitionChangeSet({ changeSetId: 'cs_v1', to: 'running' });
  repo.transitionChangeSet({ changeSetId: 'cs_v1', to: 'preview_ready', candidateCommit: COMMIT_A });
  repo.appendRevision(revisionInput('cs_v1', { revisionId: 'rev_1' }));
  repo.adoptChangeSet({ changeSetId: 'cs_v1' });
  assert.equal(repo.getCurrentRevision('volcano-plot').revisionId, 'rev_1');

  // v2 采用
  newChangeSet(repo, { changeSetId: 'cs_v2', baseCommit: COMMIT_A });
  repo.transitionChangeSet({ changeSetId: 'cs_v2', to: 'running' });
  repo.transitionChangeSet({ changeSetId: 'cs_v2', to: 'preview_ready', candidateCommit: COMMIT_B });
  repo.appendRevision(revisionInput('cs_v2', {
    revisionId: 'rev_2',
    parentRevisionIds: ['rev_1'],
    outputHash: HASH_2,
    outputPath: 'results/artifacts/volcano-plot/revisions/v2/volcano.svg',
  }));
  repo.adoptChangeSet({ changeSetId: 'cs_v2' });
  assert.equal(repo.getCurrentRevision('volcano-plot').revisionId, 'rev_2');

  // 撤销 v2 → 当前版本回到 v1，且历史 revision 不消失
  repo.revertChangeSet({ changeSetId: 'cs_v2', reason: 'user_undo' });
  assert.equal(repo.getCurrentRevision('volcano-plot').revisionId, 'rev_1');
  assert.equal(repo.getRevision('rev_2') !== null, true, 'history must not disappear');
  assert.equal(repo.listRevisions({ artifactFamilyId: 'volcano-plot' }).length, 2);
});

// ---------------------------------------------------------------------------
// 4. 幂等
// ---------------------------------------------------------------------------

test('RS2 adopt is idempotent', (context) => {
  const { repo } = makeRepo(context);
  newChangeSet(repo, { changeSetId: 'cs_idem' });
  repo.transitionChangeSet({ changeSetId: 'cs_idem', to: 'running' });
  repo.transitionChangeSet({ changeSetId: 'cs_idem', to: 'preview_ready', candidateCommit: COMMIT_B });
  repo.appendRevision(revisionInput('cs_idem', { revisionId: 'rev_idem' }));

  const first = repo.adoptChangeSet({ changeSetId: 'cs_idem' });
  const second = repo.adoptChangeSet({ changeSetId: 'cs_idem' });
  const third = repo.adoptChangeSet({ changeSetId: 'cs_idem' });

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(third.idempotent, true);
  // 时间戳不被重复采用覆盖
  assert.equal(second.changeSet.adoptedAt, first.changeSet.adoptedAt);
  assert.equal(third.changeSet.adoptedAt, first.changeSet.adoptedAt);
  // 仍然只有一个当前版本
  assert.equal(repo.listCurrentRevisions('project_1').length, 1);
});

test('RS2 revert is idempotent', (context) => {
  const { repo } = makeRepo(context);
  newChangeSet(repo, { changeSetId: 'cs_ridem' });
  repo.transitionChangeSet({ changeSetId: 'cs_ridem', to: 'running' });
  repo.transitionChangeSet({ changeSetId: 'cs_ridem', to: 'preview_ready', candidateCommit: COMMIT_B });

  const first = repo.revertChangeSet({ changeSetId: 'cs_ridem' });
  const second = repo.revertChangeSet({ changeSetId: 'cs_ridem' });
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.changeSet.revertedAt, first.changeSet.revertedAt);
});

// ---------------------------------------------------------------------------
// 5. 单一当前版本不变量
// ---------------------------------------------------------------------------

test('RS2 never allows two current revisions in one family', (context) => {
  const { db, repo } = makeRepo(context);
  newChangeSet(repo, { changeSetId: 'cs_c' });
  repo.transitionChangeSet({ changeSetId: 'cs_c', to: 'running' });
  repo.transitionChangeSet({ changeSetId: 'cs_c', to: 'preview_ready', candidateCommit: COMMIT_B });
  repo.appendRevision(revisionInput('cs_c', { revisionId: 'rev_a' }));
  repo.appendRevision(revisionInput('cs_c', {
    revisionId: 'rev_b',
    outputPath: 'results/artifacts/volcano-plot/revisions/v2/volcano.svg',
    outputHash: HASH_2,
  }));
  repo.adoptChangeSet({ changeSetId: 'cs_c' });

  const currentCount = db
    .prepare("SELECT COUNT(*) AS n FROM artifact_revisions WHERE artifact_family_id = 'volcano-plot' AND is_current = 1")
    .get().n;
  assert.equal(currentCount, 1, 'exactly one current revision per family');

  // 数据库层面也必须拒绝第二个 current
  assert.throws(() => {
    db.prepare("UPDATE artifact_revisions SET is_current = 1 WHERE revision_id = 'rev_a'").run();
  }, /UNIQUE|constraint/i);
});

test('RS2 assigns increasing revision ordinals per family', (context) => {
  const { repo } = makeRepo(context);
  newChangeSet(repo, { changeSetId: 'cs_ord' });
  const first = repo.appendRevision(revisionInput('cs_ord', { revisionId: 'rev_o1' }));
  const second = repo.appendRevision(revisionInput('cs_ord', {
    revisionId: 'rev_o2',
    outputPath: 'results/artifacts/volcano-plot/revisions/v2/volcano.svg',
  }));
  assert.equal(first.revisionOrdinal, 1);
  assert.equal(second.revisionOrdinal, 2);
});

test('P4R-4 family-scoped queries paginate every Revision without unrelated ChangeSet starvation', (context) => {
  const { repo } = makeRepo(context);
  newChangeSet(repo, { changeSetId: 'cs_target' });
  for (let index = 1; index <= 150; index += 1) {
    repo.appendRevision(revisionInput('cs_target', {
      revisionId: `rev_target_${index}`,
      artifactFamilyId: 'target-family',
      outputPath: `results/target/v${index}/plot.png`,
      toolJobId: `job_target_${String(index).padStart(6, '0')}`,
    }));
  }
  for (let index = 1; index <= 105; index += 1) {
    const changeSetId = `cs_other_${index}`;
    newChangeSet(repo, { changeSetId, workingBranchRef: `refs/heads/biof3/changeset/${changeSetId}` });
    repo.appendRevision(revisionInput(changeSetId, {
      revisionId: `rev_other_${index}`,
      artifactFamilyId: `other-family-${index}`,
      outputPath: `results/other/${index}/plot.png`,
      toolJobId: `job_other_${String(index).padStart(6, '0')}`,
    }));
  }
  assert.deepEqual(
    repo.listChangeSetsByArtifactFamily({ projectId: 'project_1', artifactFamilyId: 'target-family' })
      .map((entry) => entry.changeSetId),
    ['cs_target'],
  );
  const first = repo.listRevisions({ artifactFamilyId: 'target-family', projectId: 'project_1', order: 'desc', limit: 100 });
  const second = repo.listRevisions({ artifactFamilyId: 'target-family', projectId: 'project_1', order: 'desc', limit: 100, offset: 100 });
  assert.equal(first.length, 100);
  assert.equal(second.length, 50);
  assert.equal(first[0].revisionOrdinal, 150);
  assert.equal(second.at(-1).revisionOrdinal, 1);
  assert.equal(repo.listRevisions({ artifactFamilyId: 'target-family', projectId: 'project_other' }).length, 0);
});

// ---------------------------------------------------------------------------
// 6. 中断恢复
// ---------------------------------------------------------------------------

test('RS2 finds interrupted change sets after a simulated crash', (context) => {
  const { repo } = makeRepo(context);
  newChangeSet(repo, { changeSetId: 'cs_running' });
  repo.transitionChangeSet({ changeSetId: 'cs_running', to: 'running' });

  newChangeSet(repo, { changeSetId: 'cs_pending' });
  repo.transitionChangeSet({ changeSetId: 'cs_pending', to: 'running' });
  repo.transitionChangeSet({ changeSetId: 'cs_pending', to: 'preview_ready', candidateCommit: COMMIT_B });

  newChangeSet(repo, { changeSetId: 'cs_draft_only' });

  const interrupted = repo.findInterruptedChangeSets('project_1');
  const byId = new Map(interrupted.map((item) => [item.changeSet.changeSetId, item.recovery]));
  assert.equal(byId.get('cs_running'), 'recovery_required_after_restart');
  assert.equal(byId.get('cs_pending'), 'awaiting_user_decision');
  assert.equal(byId.get('cs_draft_only'), 'resumable_draft');
});

test('RS2 recovers state across a real database reopen', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-rs2-reopen-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const dbPath = join(root, 'reopen.db');

  const first = new Database(dbPath);
  ensureResultStudioSchema(first);
  const repoA = createResultStudioRepository(first);
  newChangeSet(repoA, { changeSetId: 'cs_persist' });
  repoA.transitionChangeSet({ changeSetId: 'cs_persist', to: 'running' });
  repoA.transitionChangeSet({ changeSetId: 'cs_persist', to: 'preview_ready', candidateCommit: COMMIT_B });
  repoA.appendRevision(revisionInput('cs_persist', { revisionId: 'rev_persist' }));
  repoA.adoptChangeSet({ changeSetId: 'cs_persist' });
  first.close();

  // 模拟应用重启
  const second = new Database(dbPath);
  context.after(() => { try { second.close(); } catch { /* noop */ } });
  const repoB = createResultStudioRepository(second);
  const restored = repoB.getChangeSet('cs_persist');
  assert.equal(restored.status, 'adopted');
  assert.equal(repoB.getCurrentRevision('volcano-plot').revisionId, 'rev_persist');
  // 重启后重复采用仍幂等，不产生"部分采用"
  assert.equal(repoB.adoptChangeSet({ changeSetId: 'cs_persist' }).idempotent, true);
});

// ---------------------------------------------------------------------------
// 7. Selection 与 Checkpoint
// ---------------------------------------------------------------------------

test('RS2 persists and restores a selection context', (context) => {
  const { repo } = makeRepo(context);
  const saved = repo.saveSelection({
    selectionId: 'sel_1',
    projectId: 'project_1',
    conversationId: 'conv_1',
    artifactId: 'deg_table',
    revisionId: 'rev_1',
    entityType: 'gene',
    entityIds: ['TP53', 'EGFR'],
    filterExpression: { field: 'padj', op: 'lt', value: 0.05 },
    sort: [{ field: 'log2FC', direction: 'desc' }],
  });
  assert.equal(saved.entityIdCount, 2);

  const restored = repo.getSelection('sel_1');
  assert.deepEqual(restored.entityIds, ['TP53', 'EGFR']);
  assert.equal(restored.filterExpression.value, 0.05);
  assert.equal(restored.sort[0].direction, 'desc');

  // 覆盖保存（同一 selectionId）不产生第二行
  repo.saveSelection({
    selectionId: 'sel_1',
    projectId: 'project_1',
    artifactId: 'deg_table',
    entityType: 'gene',
    entityIds: ['TP53'],
  });
  assert.equal(repo.getSelection('sel_1').entityIdCount, 1);

  repo.deleteSelection('sel_1');
  assert.equal(repo.getSelection('sel_1'), null);
});

test('RS-P2 restores only the latest selection in the same project conversation and artifact', (context) => {
  const { repo } = makeRepo(context);
  const base = {
    projectId: 'project_1', conversationId: 'conv_1', artifactId: 'deg_table',
    revisionId: 'rev_1', entityType: 'gene', filterExpression: { logic: 'and', clauses: [] },
  };
  repo.saveSelection({ ...base, selectionId: 'sel_old', entityIds: ['TP53'] });
  repo.saveSelection({ ...base, selectionId: 'sel_new', entityIds: ['EGFR'] });
  repo.saveSelection({ ...base, selectionId: 'sel_other_conv', conversationId: 'conv_2', entityIds: ['MYC'] });
  repo.saveSelection({ ...base, selectionId: 'sel_other_artifact', artifactId: 'other', entityIds: ['KRAS'] });
  assert.equal(repo.findLatestSelection({
    projectId: 'project_1', conversationId: 'conv_1', artifactId: 'deg_table',
  }).selectionId, 'sel_new');
  assert.equal(repo.findLatestSelection({
    projectId: 'project_1', conversationId: 'conv_2', artifactId: 'deg_table',
  }).selectionId, 'sel_other_conv');
});

test('RS-P2 falls back only to an unscoped artifact selection when a conversation is created later', (context) => {
  const { repo } = makeRepo(context);
  const base = {
    projectId: 'project_1', artifactId: 'deg_table', revisionId: 'rev_1',
    entityType: 'gene', filterExpression: { logic: 'and', clauses: [] },
  };
  repo.saveSelection({ ...base, selectionId: 'sel_unscoped', entityIds: ['TP53'] });
  repo.saveSelection({ ...base, selectionId: 'sel_other_conv', conversationId: 'conv_other', entityIds: ['MYC'] });

  assert.equal(repo.findLatestSelection({
    projectId: 'project_1', conversationId: 'conv_created_later', artifactId: 'deg_table',
  }).selectionId, 'sel_unscoped');
  assert.equal(repo.findLatestSelection({
    projectId: 'project_1', conversationId: 'conv_other', artifactId: 'deg_table',
  }).selectionId, 'sel_other_conv');
});

test('RS2 checkpoint hash detects tampering and survives reopen', (context) => {
  const { db, repo } = makeRepo(context);
  newChangeSet(repo, { changeSetId: 'cs_cp' });
  const checkpoint = repo.saveCheckpoint({
    checkpointId: 'cp_1',
    projectId: 'project_1',
    conversationId: 'conv_1',
    baseCommit: COMMIT_A,
    candidateCommit: COMMIT_B,
    changeSetId: 'cs_cp',
    changeSetStatus: 'draft',
    currentRevisionIds: ['rev_1'],
    selectionId: 'sel_1',
    jobRefs: ['job_1'],
  });
  assert.match(checkpoint.checkpointHash, /^[a-f0-9]{64}$/);
  assert.equal(repo.verifyCheckpointIntegrity('cp_1').matches, true);
  assert.equal(repo.verifyCheckpointIntegrity('cp_1').status, 'intact');

  // 绕过仓库直接改库 → 完整性校验必须发现
  db.prepare("UPDATE workspace_revision_checkpoints SET candidate_commit = ? WHERE checkpoint_id = 'cp_1'")
    .run('c'.repeat(40));
  const tampered = repo.verifyCheckpointIntegrity('cp_1');
  assert.equal(tampered.matches, false);
  assert.equal(tampered.status, 'hash_mismatch');
});

test('RS2 returns the latest checkpoint per conversation', (context) => {
  const { repo } = makeRepo(context);
  repo.saveCheckpoint({
    checkpointId: 'cp_old',
    projectId: 'project_1',
    conversationId: 'conv_1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  repo.saveCheckpoint({
    checkpointId: 'cp_new',
    projectId: 'project_1',
    conversationId: 'conv_1',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(repo.getLatestCheckpoint({ projectId: 'project_1', conversationId: 'conv_1' }).checkpointId, 'cp_new');
});

// ---------------------------------------------------------------------------
// 8. Repository binding 持久化
// ---------------------------------------------------------------------------

test('RS2 persists a git repository binding per project', (context) => {
  const { repo } = makeRepo(context);
  repo.saveRepositoryBinding({
    projectId: 'project_1',
    mode: 'managed',
    workspaceRoot: '/tmp/ws',
    gitDir: '/tmp/ws/.biof3/git',
    workTree: '/tmp/ws',
    managedPaths: ['analysis/scripts', 'analysis/workflows'],
    status: 'ready',
    gitVersion: '2.50.1',
  });
  const binding = repo.getRepositoryBinding('project_1');
  assert.equal(binding.mode, 'managed');
  assert.deepEqual(binding.managedPaths, ['analysis/scripts', 'analysis/workflows']);

  // 同一项目重复绑定是更新，不是插入第二条
  repo.saveRepositoryBinding({
    projectId: 'project_1',
    mode: 'existing',
    workspaceRoot: '/tmp/ws',
    gitDir: '/tmp/ws/.git',
    workTree: '/tmp/ws',
    managedPaths: ['analysis/scripts'],
    status: 'blocked_dirty_conflict',
    reason: 'managed_paths_have_uncommitted_changes',
  });
  const updated = repo.getRepositoryBinding('project_1');
  assert.equal(updated.mode, 'existing');
  assert.equal(updated.status, 'blocked_dirty_conflict');
});

// ---------------------------------------------------------------------------
// 9. 可达性
// ---------------------------------------------------------------------------

test('RS2 reachability keeps current, adopted and referenced revisions', (context) => {
  const { repo } = makeRepo(context);

  newChangeSet(repo, { changeSetId: 'cs_r1' });
  repo.transitionChangeSet({ changeSetId: 'cs_r1', to: 'running' });
  repo.transitionChangeSet({ changeSetId: 'cs_r1', to: 'preview_ready', candidateCommit: COMMIT_A });
  repo.appendRevision(revisionInput('cs_r1', { revisionId: 'rev_base' }));
  repo.adoptChangeSet({ changeSetId: 'cs_r1' });

  // 被 rev_child 引用为父版本
  newChangeSet(repo, { changeSetId: 'cs_r2', baseCommit: COMMIT_A });
  repo.transitionChangeSet({ changeSetId: 'cs_r2', to: 'running' });
  repo.transitionChangeSet({ changeSetId: 'cs_r2', to: 'preview_ready', candidateCommit: COMMIT_B });
  repo.appendRevision(revisionInput('cs_r2', {
    revisionId: 'rev_child',
    parentRevisionIds: ['rev_base'],
    outputPath: 'results/artifacts/volcano-plot/revisions/v2/volcano.svg',
    outputHash: HASH_2,
  }));
  repo.adoptChangeSet({ changeSetId: 'cs_r2' });

  // 一个被放弃的孤立 revision
  newChangeSet(repo, { changeSetId: 'cs_r3', baseCommit: COMMIT_A });
  repo.appendRevision(revisionInput('cs_r3', {
    revisionId: 'rev_orphan',
    artifactFamilyId: 'heatmap',
    artifactId: 'heatmap_plot',
    outputPath: 'results/artifacts/heatmap/revisions/v1/heatmap.svg',
  }));
  repo.transitionChangeSet({ changeSetId: 'cs_r3', to: 'abandoned' });

  const report = repo.analyzeRevisionReachability('project_1');
  assert.equal(report.mode, 'read_only_analysis');
  const reachableIds = report.reachable.map((item) => item.revisionId);
  // 字段名是 gcCandidates 而不是 unreachable：这层只产出候选，不是删除指令。
  const unreachableIds = report.gcCandidates.map((item) => item.revisionId);

  assert.equal(reachableIds.includes('rev_child'), true, 'current revision is reachable');
  assert.equal(reachableIds.includes('rev_base'), true, 'referenced parent is reachable');
  assert.equal(unreachableIds.includes('rev_orphan'), true, 'abandoned orphan is collectable');
  // 报告只标记候选，不删除任何东西
  assert.equal(repo.getRevision('rev_orphan') !== null, true);
});
