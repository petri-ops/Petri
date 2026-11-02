/**
 * BLOCK-335 — 任务推进闭环：P0 判据驱动驾驶员 + P1 基座（verify/checkpoint 宿主与原语）
 * + P2 闭环脚本。只钉机制：
 *   - loop-decision 纯函数：瀑布序不变；验证器不在场 = 现状语义零变化；
 *     模型自报 complete + 验证红 → retry≤2 → block，永不 complete（驾驶员核心契约）。
 *   - verify 宿主：消费既有 test-affected/evals-gate 门禁退出码（0 绿 / 1、2 红 / 崩溃红），
 *     不建第二验证器；改动域越出安全前缀 → restartRequired（如实留人工）。
 *   - checkpoint 宿主：复用 shared workspace-checkpoint；回滚显式传 ref；
 *     回滚后工作树与 checkpoint 树逐字节一致。
 *   - workflow 原语：verify/checkpoint 经 deps 注入，verdict/动作落 journal；
 *     真自优化脚本（resources/workflows/self-optimize.mjs）过沙箱扫描并按红绿两路收敛。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TEMP_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'block335-'));
process.env.PETRI_DB_PATH = path.join(TEMP_DB_DIR, 'petri.db');
{
  // 决策验证器经真 db 解析项目工作区——预建库（block323 同款隔离形态）
  const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
  const boot = new Database(process.env.PETRI_DB_PATH);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
}
process.on('exit', () => {
  try { fs.rmSync(TEMP_DB_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const { decideIterationOutcome, MAX_VERIFY_RETRIES, VERIFY_VERDICTS } = require(
  path.join(ROOT, 'core/petri-server/helpers/loop-decision.js'));
const { REASON_CODES } = require(path.join(ROOT, 'core/shared-backend/loop-contract.js'));
const { createVerifyHost, createDecisionVerifier, detectRestartRequired, VERIFY_KINDS } = require(
  path.join(ROOT, 'core/petri-server/helpers/verify-host.js'));
const { createCheckpointHost } = require(
  path.join(ROOT, 'core/petri-server/helpers/checkpoint-host.js'));
const runnerMod = require(path.join(ROOT, 'core/petri-server/helpers/workflow-runner.js'));
const sandboxMod = require(path.join(ROOT, 'core/petri-server/helpers/workflow-sandbox.js'));

function tempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block335-repo-'));
  const git = (args) => execFileSync('git', ['-c', 'user.email=b335@test', '-c', 'user.name=b335', ...args], { cwd: dir, encoding: 'utf8' });
  git(['init', '-q']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'b335 base\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return { dir, git };
}

// ── P0 判据驱动驾驶员（纯函数） ──────────────────────────────

const BASE = {
  falseSuccessJobsCount: 0,
  requiresUserDecision: false,
  unresolvedFailedJobsCount: 0,
  activeJobsCount: 0,
  modelFinalized: true,
  noActivities: false,
  verifyRedStreak: 0,
  reasonCodes: REASON_CODES,
};

test('BLOCK-335 P0 无验证器 = 现状语义（瀑布序与原实现逐条对齐）', () => {
  assert.deepEqual(VERIFY_VERDICTS, ['ready', 'blocked', 'needs_restart', 'unavailable']);
  assert.equal(MAX_VERIFY_RETRIES, 2);

  // 现状五条（无投票 → 逐字节原语义）
  assert.equal(decideIterationOutcome({ ...BASE, falseSuccessJobsCount: 2 }).decision, 'block');
  assert.equal(decideIterationOutcome({ ...BASE, requiresUserDecision: true }).decision, 'wait');
  assert.equal(decideIterationOutcome({ ...BASE, unresolvedFailedJobsCount: 1 }).decision, 'retry');
  assert.equal(decideIterationOutcome({ ...BASE, activeJobsCount: 3 }).decision, 'continue');
  assert.equal(decideIterationOutcome({ ...BASE }).decision, 'complete');
  // 无工具活动也算收尾（原实现 activities.length === 0）
  assert.equal(decideIterationOutcome({ ...BASE, modelFinalized: false, noActivities: true }).decision, 'complete');
  // 验证器在场但不抛红时零行为变化
  assert.equal(decideIterationOutcome({ ...BASE, verifyVote: { verdict: 'ready' } }).decision, 'complete');
  // 伪投票（未注册 verdict）按无投票处理，不炸
  assert.equal(decideIterationOutcome({ ...BASE, verifyVote: { verdict: 'nonsense' } }).decision, 'complete');
});

test('BLOCK-335 P0 模型自报 complete 但验证红 → 不得终态 ready（retry≤2→block）', () => {
  const red = (detail) => ({ verdict: 'blocked', detail });

  // 连续 0/1 次红 → 强制 retry，publicConclusion 点名「模型自报完成不被采纳」
  const first = decideIterationOutcome({ ...BASE, verifyVote: red('test exit=1'), verifyRedStreak: 0 });
  assert.equal(first.decision, 'retry');
  assert.equal(first.decisionReasonCode, 'VERIFY_RED_RETRY');
  assert.ok(first.publicConclusion.includes('不被采纳'), first.publicConclusion);
  assert.equal(first.verifyVoteConsumed, true);

  const second = decideIterationOutcome({ ...BASE, verifyVote: red('test exit=1'), verifyRedStreak: 1 });
  assert.equal(second.decision, 'retry');

  // 连续 2 次红 → block（上限达成，宁慢勿腐）
  const third = decideIterationOutcome({ ...BASE, verifyVote: red('test exit=1'), verifyRedStreak: 2 });
  assert.equal(third.decision, 'block');
  assert.equal(third.decisionReasonCode, 'VERIFY_RED_BLOCK');
  assert.ok(third.publicConclusion.includes('转人工复盘'), third.publicConclusion);

  // needs_restart → block 留人工（不是 retry，也不 complete）
  const restart = decideIterationOutcome({ ...BASE, verifyVote: { verdict: 'needs_restart', detail: 'src/foo.js' } });
  assert.equal(restart.decision, 'block');
  assert.equal(restart.decisionReasonCode, 'VERIFY_RESTART_REQUIRED');

  // 验证器故障（unavailable）= 无投票 → 现状 complete（闭环外 phase 级 verify 兜底）
  assert.equal(decideIterationOutcome({ ...BASE, verifyVote: { verdict: 'unavailable' } }).decision, 'complete');
});

// ── P1 verify 宿主 ──────────────────────────────────────────

test('BLOCK-335 P1 verify 宿主：门禁退出码映射（0 绿 / 1、2 红）+ 改动域越界 → restartRequired', async () => {
  const fakeRepo = tempGitRepo();
  fs.mkdirSync(path.join(fakeRepo.dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(fakeRepo.dir, 'scripts', 'test-affected.mjs'), [
    "import fs from 'node:fs';",
    "const reportIdx = process.argv.indexOf('--report');",
    "if (reportIdx > 0) {",
    "  const files = JSON.parse(process.env.FAKE_CHANGED || '[]');",
    "  fs.writeFileSync(process.argv[reportIdx + 1], JSON.stringify({ schemaVersion: 1, plan: { changedFiles: files }, tests: ['a.test.mjs'], unknown: [] }));",
    "  process.exit(0);",
    "}",
    "process.exit(Number(process.env.FAKE_EXIT ?? '0'));",
  ].join('\n'));

  const verify = createVerifyHost({ getProject: () => ({ workspace_path: fakeRepo.dir }) });

  process.env.FAKE_EXIT = '0';
  const ready = await verify({ kind: 'test-affected', projectId: 'p1' });
  assert.equal(ready.verdict, 'ready');
  assert.equal(ready.restartRequired, false);
  assert.equal(ready.testsCount, 1);

  process.env.FAKE_CHANGED = JSON.stringify(['src/server.js']);
  const restart = await verify({ kind: 'test-affected', projectId: 'p1' });
  assert.equal(restart.verdict, 'ready');
  assert.equal(restart.restartRequired, true);
  assert.equal(restart.restartReason, 'src/server.js');
  assert.deepEqual(detectRestartRequired(['test/foo.mjs', 'docs/x.md']), { restartRequired: false, restartReason: null });

  process.env.FAKE_CHANGED = '[]';
  process.env.FAKE_EXIT = '1';
  const red = await verify({ kind: 'test-affected', projectId: 'p1' });
  assert.equal(red.verdict, 'blocked');
  assert.equal(red.exitCode, 1);

  process.env.FAKE_EXIT = '2';
  const unmapped = await verify({ kind: 'test-affected', projectId: 'p1' });
  assert.equal(unmapped.verdict, 'blocked', 'exit 2 未映射 ≠ fail-closed，但无法证明绿 → 按红处理');
  delete process.env.FAKE_EXIT;
  delete process.env.FAKE_CHANGED;

  // 无项目 → workspace_required（红，不伪装绿）；未知 kind 归一 test-affected
  const noWs = await createVerifyHost({ getProject: () => null })({ kind: 'test-affected', projectId: 'ghost' });
  assert.equal(noWs.verdict, 'blocked');
  assert.equal(noWs.errorHead, 'workspace_required');
  assert.deepEqual(VERIFY_KINDS, ['test-affected', 'evals-gate']);
});

test('BLOCK-335 P1 决策验证器：spec 缺失=无投票（零变化），红票如实透传', async () => {
  assert.equal(createDecisionVerifier(null), null);
  assert.equal(createDecisionVerifier({}), null);
  assert.equal(createDecisionVerifier({ kind: 'nonsense' }), null);

  const fakeRepo = tempGitRepo();
  fs.mkdirSync(path.join(fakeRepo.dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(fakeRepo.dir, 'scripts', 'test-affected.mjs'),
    "process.exit(Number(process.env.FAKE_EXIT ?? '0'));");
  // 项目行落库：验证器经 projects 表解析工作区（不信任调用方传 cwd）
  const dbMod = require(path.join(ROOT, 'core/petri-server/db.js'));
  const projectRow = dbMod.createProject({ name: 'b335 verifier', userId: 'u1', workspacePath: fakeRepo.dir });
  const verifier = createDecisionVerifier({ kind: 'test-affected', projectId: projectRow.id }, { userId: 'u1' });
  assert.equal(typeof verifier, 'function');

  process.env.FAKE_EXIT = '1';
  const redVote = await verifier({});
  assert.equal(redVote.verdict, 'blocked');
  process.env.FAKE_EXIT = '0';
  const greenVote = await verifier({});
  assert.equal(greenVote.verdict, 'ready');
  delete process.env.FAKE_EXIT;
});

// ── P1 checkpoint 宿主（真 git 仓库，回滚逐字节一致） ────────

test('BLOCK-335 P1 checkpoint 宿主：create→ref；改动后 rollback→逐字节一致；回滚须显式 ref', async () => {
  const repo = tempGitRepo();
  const checkpoint = createCheckpointHost({
    dbMod: { getProject: () => ({ workspace_path: repo.dir }) },
  });

  // 无 ref 的 rollback 拒绝（显式红线）
  const noRef = await checkpoint({ projectId: 'p1', action: 'rollback' });
  assert.equal(noRef.ok, false);
  assert.equal(noRef.error, 'ref_required');

  // 基线改动 → checkpoint 产 ref
  fs.writeFileSync(path.join(repo.dir, 'README.md'), 'b335 base + edit A\n');
  const snap = await checkpoint({ projectId: 'p1', action: 'create' });
  assert.equal(snap.ok, true);
  assert.ok(snap.ref, `应产出 ref：${JSON.stringify(snap)}`);

  // checkpoint 之后再改 + 新增未跟踪文件 → 回滚 → 工作树与 checkpoint 树逐字节一致
  fs.writeFileSync(path.join(repo.dir, 'README.md'), 'b335 base + edit A + BREAKING EDIT\n');
  fs.writeFileSync(path.join(repo.dir, 'stray-new.txt'), 'untracked stray\n');
  const rolled = await checkpoint({ projectId: 'p1', action: 'rollback', ref: snap.ref });
  assert.equal(rolled.ok, true, JSON.stringify(rolled));
  assert.equal(fs.readFileSync(path.join(repo.dir, 'README.md'), 'utf8'), 'b335 base + edit A\n', '跟踪文件恢复到快照态');
  assert.equal(fs.existsSync(path.join(repo.dir, 'stray-new.txt')), false, '快照后的未跟踪新增被清理');

  // list 落账形态
  const list = await checkpoint({ projectId: 'p1', action: 'list' });
  assert.ok(Array.isArray(list.checkpoints) && list.checkpoints.some((c) => c.ref === snap.ref && c.rolledBack === true));

  // 重复回滚同一 ref → fail-closed（登记表标记 rolled-back）
  const twice = await checkpoint({ projectId: 'p1', action: 'rollback', ref: snap.ref });
  assert.equal(twice.ok, false);

  // 无 projectId → 拒绝
  assert.equal((await checkpoint({})).error, 'project_required');
});

// ── P2 真闭环脚本（沙箱装载 + 红/绿两路） ────────────────────

const SELF_OPTIMIZE_SRC = fs.readFileSync(path.join(ROOT, 'resources', 'workflows', 'self-optimize.mjs'), 'utf8');

test('BLOCK-335 P2 自优化脚本过沙箱扫描（禁词/导出形态/meta 形状）', () => {
  const scan = sandboxMod.scanWorkflowSource(SELF_OPTIMIZE_SRC);
  assert.equal(scan.ok, true, JSON.stringify(scan));
  const loaded = sandboxMod.loadWorkflowModule(SELF_OPTIMIZE_SRC, { host: {}, seed: 0 });
  assert.equal(loaded.ok, true, `${loaded.error || ''} ${loaded.message || ''}`);
  assert.equal(loaded.meta.name, 'self-optimize');
});

test('BLOCK-335 P2 闭环两路：verify 绿 → ready 留改动；verify 红 → 显式 ref 回滚', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block335-wf-'));
  const makeDeps = (verifyVerdict) => ({
    launchSubAgent: () => ({ ok: true, agentId: 'stub-1' }),
    waitAgentTerminal: async () => ({ status: 'completed', summary: 'stub edit' }),
    requestCancellation: () => {},
    verify: async () => verifyVerdict === 'ready'
      ? { ok: true, verdict: 'ready', kind: 'test-affected', exitCode: 0, durationMs: 3, changedFiles: [], testsCount: 0, restartRequired: false }
      : { ok: false, verdict: 'blocked', kind: 'test-affected', exitCode: 1, durationMs: 3, errorHead: 'red' },
    checkpoint: async (payload) => {
      if (payload.action === 'create') return { ok: true, action: 'create', created: true, ref: 'ckpt-abc' };
      if (payload.action === 'rollback') return { ok: true, action: 'rollback', ref: payload.ref };
      return { ok: true, action: 'list', checkpoints: [] };
    },
  });
  const readJournal = (runId) => fs.readFileSync(path.join(root, runId, 'journal.jsonl'), 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line));

  const green = runnerMod.startWorkflowRun({
    source: SELF_OPTIMIZE_SRC, args: { projectId: 'p1', taskPrompt: 'x' }, userId: 'u1', deps: makeDeps('ready'), root,
  });
  const greenResult = await green.promise;
  assert.equal(greenResult.status, 'completed', JSON.stringify(greenResult));
  assert.equal(greenResult.returned.outcome, 'ready');
  assert.equal(greenResult.returned.checkpointRef, 'ckpt-abc');
  const greenJournal = readJournal(green.runId);
  assert.ok(greenJournal.some((row) => row.kind === 'checkpoint' && row.action === 'create' && row.ref === 'ckpt-abc'), 'checkpoint ref 落 journal');
  assert.ok(greenJournal.some((row) => row.kind === 'verify' && row.status === 'ready'), 'verify verdict 落 journal');
  assert.ok(!greenJournal.some((row) => row.action === 'rollback'), '绿路不回滚');

  const red = runnerMod.startWorkflowRun({
    source: SELF_OPTIMIZE_SRC, args: { projectId: 'p1', taskPrompt: 'x' }, userId: 'u1', deps: makeDeps('blocked'), root,
  });
  const redResult = await red.promise;
  assert.equal(redResult.returned.outcome, 'rolled_back');
  assert.equal(redResult.returned.rollback.ref, 'ckpt-abc', '回滚显式携带 phase 1 ref');
  const redJournal = readJournal(red.runId);
  const rollbackRow = redJournal.find((row) => row.action === 'rollback');
  assert.ok(rollbackRow, '红路 rollback 落 journal');
  assert.equal(rollbackRow.ref, 'ckpt-abc');
});

test('BLOCK-335 P2 原语宿主缺席 → 诚实 unavailable（不伪造绿）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block335-wf2-'));
  const script = [
    "export const meta = { name: 'p1p', version: 1, budget: { maxAgents: 1 }, concurrency: 1 };",
    'export default async function run() {',
    '  const v = await verify({ kind: "test-affected" });',
    '  const c = await checkpoint({ action: "create" });',
    '  return { v: v && v.verdict, c: c && c.error };',
    '}',
  ].join('\n');
  const run = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps: {}, root });
  const result = await run.promise;
  assert.equal(result.returned.v, 'unavailable');
  assert.equal(result.returned.c, 'checkpoint_host_unavailable');
});
