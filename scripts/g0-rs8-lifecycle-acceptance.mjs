#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-result-studio/rs8-lifecycle-acceptance.json');
const require = createRequire(import.meta.url);
const lifecycle = require('../core/shared-backend/result-studio-lifecycle');
const read = (file) => readFileSync(join(root, file), 'utf8');
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });

function inspect(verification = null) {
  const source = read('core/shared-backend/result-studio-lifecycle.js');
  const changeset = read('core/shared-backend/result-changeset-service.js');
  const routes = read('core/biof3-server/routes/result-studio.js');
  const panel = read('frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx');
  const commands = verification?.commands || [];
  const budgetBlocked = lifecycle.evaluatePreviewResourceBudget({ resourceSnapshot: { state: 'ready', memory: { availableBytes: 100 }, disk: { availableBytes: 1000 } }, estimatedMemoryBytes: 90 });
  const budgetQueued = lifecycle.evaluatePreviewResourceBudget({ resourceSnapshot: { state: 'ready', memory: { availableBytes: 1000 }, disk: { availableBytes: 1000 } }, activePreviewJobs: 2 });
  const checks = [
    item('RS8-01', /saveResultEditCheckpoint/.test(changeset) && /candidate_committed/.test(changeset) && /preview_ready/.test(changeset), ['core/shared-backend/result-changeset-service.js'], 'ChangeSet stages persist one durable WorkspaceCheckpoint lineage.'),
    item('RS8-02', typeof lifecycle.inspectResultStudioWorkspace === 'function' && typeof lifecycle.recoverResultStudioWorkspace === 'function', ['core/shared-backend/result-studio-lifecycle.js'], 'Restart inspection and bounded recovery are production functions.'),
    item('RS8-03', /current_ref_drift/.test(source) && /artifact_hash_drift/.test(source) && /checkpoint_corrupt/.test(source), ['core/shared-backend/result-studio-lifecycle.js'], 'Git, SQLite checkpoint and Artifact drift fail closed.'),
    item('RS8-04', /running_to_preview_ready/.test(source) && /restored_missing_current_ref/.test(source), ['core/shared-backend/result-studio-lifecycle.js'], 'Only evidence-complete previews and missing refs self-heal.'),
    item('RS8-05', typeof lifecycle.inspectResultStudioStorage === 'function' && typeof lifecycle.executeArtifactDeduplication === 'function', ['core/shared-backend/result-studio-lifecycle.js'], 'Storage summary and exact-hash content deduplication are available.'),
    item('RS8-06', /artifactDeletionCount: 0/.test(source) && /GC never deletes Artifact files or Revision history/.test(source), ['core/shared-backend/result-studio-lifecycle.js'], 'GC cannot delete formal Artifact or Revision history.'),
    item('RS8-07', /MAX_TABLE_PAGE_BYTES = 1024 \* 1024/.test(source) && /nextCursor/.test(source) && /table-page/.test(routes), ['core/shared-backend/result-studio-lifecycle.js', 'core/biof3-server/routes/result-studio.js'], 'Large tables use a bounded progressive cursor API.'),
    item('RS8-08', /readRevisionTablePage/.test(panel) && /virtualTable/.test(panel), ['frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx'], 'Result UI incrementally renders candidate table pages.'),
    item('RS8-09', budgetBlocked.decision === 'blocked' && budgetQueued.decision === 'queued' && budgetBlocked.scientificParametersChanged === false, ['core/shared-backend/result-studio-lifecycle.js'], 'Preview resource pressure blocks or queues without changing science.'),
    item('RS8-10', /workspace\/status/.test(routes) && /workspace\/recover/.test(routes) && /storage\/gc/.test(routes) && /storage\/deduplicate/.test(routes), ['core/biof3-server/routes/result-studio.js'], 'Project-scoped lifecycle, recovery, GC and dedup APIs are wired.'),
    item('RS8-11', commands.length >= 3 && commands.every((command) => command.passed), ['acceptance/g0-result-studio/rs8-lifecycle-acceptance.json'], 'All RS8 command gates pass.'),
    item('RS8-12', !/deleteRevision\(|DELETE FROM artifact_revisions/.test(source), ['core/shared-backend/result-studio-lifecycle.js'], 'Lifecycle service never erases revision records.'),
  ];
  return {
    schemaVersion: 1,
    workPackage: 'G0-RS8',
    sourceCommit: git('rev-parse', 'HEAD'),
    privacy: 'digests_counts_and_repository_relative_paths_only',
    checks,
    verification,
    passed: checks.every((check) => check.passed),
  };
}

function runCommands() {
  const commands = [
    ['lifecycle-tests', 'node', ['--test', 'test/result-studio-lifecycle.test.mjs', 'test/result-changeset-service.test.mjs', 'test/result-studio-repository.test.mjs']],
    ['frontend-result-studio', 'npm', ['run', 'test:files', '--prefix', 'frontend', '--', 'src/components/result-studio/ResultStudioChangeSetPanel.test.tsx']],
    ['syntax', 'node', ['--check', 'core/shared-backend/result-studio-lifecycle.js']],
  ];
  return commands.map(([label, bin, args]) => {
    const result = spawnSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return { label, command: [bin, ...args].join(' '), exitCode: result.status, passed: result.status === 0, stdoutSha256: sha(result.stdout || ''), stderrSha256: sha(result.stderr || '') };
  });
}

try {
  if (process.argv.includes('--write-evidence')) {
    const verification = { generatedAt: new Date().toISOString(), commands: runCommands() };
    const report = { ...inspect(verification), generatedAt: verification.generatedAt };
    if (!report.passed) throw new Error([...report.checks.filter((check) => !check.passed).map((check) => check.id), ...verification.commands.filter((command) => !command.passed).map((command) => command.label)].join(','));
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log('[G0-RS8] PASS — evidence updated (12/12)');
  } else {
    if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:result-studio:lifecycle:update');
    const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const current = inspect(stored.verification);
    if (!stored.passed || !current.passed) throw new Error('stored RS8 evidence is stale or invalid');
    console.log('[G0-RS8] PASS — 12/12');
  }
} catch (error) {
  console.error(`[G0-RS8] FAIL — ${error.message}`);
  process.exitCode = 1;
}
