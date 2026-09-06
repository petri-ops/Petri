import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const tempRoot = mkdtempSync(join(tmpdir(), 'biof3-hrt3-'));
process.env.BIOF3_DB_PATH = join(tempRoot, 'hrt3.db');

// BLOCK-49 加映清债 —— 补 migration 执行（原仅设 DB 路径未建表 → no such table）
{
  const Database = require(req(req('node:path').resolve(__dirname, '..', 'core', 'biof3-server', 'node_modules'), 'better-sqlite3'));
  const boot = new Database(process.env.BIOF3_DB_PATH);
  const migrationsDir = req('node:path').resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(req('node:path').join(migrationsDir, f), 'utf8'));
  }
  boot.close();
}
process.env.BIOF3_LOCAL_DATA_DIR = join(tempRoot, 'local-data');
const require = createRequire(import.meta.url);
const db = require('../core/biof3-server/db');
const { confirmScientificTask } = require('../core/shared-backend/scientific-task-confirmation');
const { sourceMessageDigest, validateContextCheckpoint } = require('../core/shared-backend/scientific-task-spec');
after(() => { try { db.closeDatabase(); } catch (_) {} rmSync(tempRoot, { recursive: true, force: true }); });

test('HRT-3 persists confirmed task and binds only a same-project real tool_job', () => {
  const project = db.createProject({ name: 'HRT-3', modality: 'bulk', workspacePath: join(tempRoot, 'project') });
  const hashes = { 'counts.csv': 'a'.repeat(64), 'metadata.csv': 'b'.repeat(64) };
  const taskSpec = {
    schemaVersion: 1, taskId: 'task_persist_1', projectId: project.id, conversationId: 'conv_1', originalRequest: '比较两组',
    question: { domain: 'bulk RNA-seq', analysisUnit: 'gene', questionType: 'differential_expression' },
    inputs: [
      { role: 'counts', relativePath: 'counts.csv', sha256: hashes['counts.csv'], sizeBytes: 10 },
      { role: 'metadata', relativePath: 'metadata.csv', sha256: hashes['metadata.csv'], sizeBytes: 10 },
    ],
    design: { groups: ['Control', 'Treatment'], contrast: { reference: 'Control', treatment: 'Treatment' } },
    method: { category: 'bulk RNA-seq' }, requestedDeliverables: ['deg_table'], status: 'ready_for_confirmation',
  };
  const confirmed = confirmScientificTask({
    taskSpec,
    plan: { status: 'ready_for_confirmation', recommendation: { toolId: 'deseq2' } },
    confirmation: { userId: 'local-user', method: 'bulk RNA-seq', inputHashes: hashes, requestedDeliverables: ['deg_table'], riskAcknowledged: true },
  });
  assert.equal(confirmed.ok, true);
  const saved = db.saveScientificTaskSpec({ spec: confirmed.spec, specHash: confirmed.taskSpecHash, confirmation: confirmed.confirmation });
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.confirmation.taskSpecHash, confirmed.taskSpecHash);
  assert.throws(() => db.saveScientificTaskSpec({ spec: { ...confirmed.spec, originalRequest: '被覆盖' }, specHash: 'f'.repeat(64), version: 1 }), /scientific_task_version_immutable/);

  const job = db.createToolJob({ toolId: 'deseq2', userId: 'local-user', params: {}, status: 'pending', projectId: project.id, conversationId: 'conv_1' });
  const bound = db.bindScientificTaskToolJob({ taskId: confirmed.spec.taskId, toolJobId: job.id });
  assert.equal(bound.tool_job_id, job.id);
  assert.equal(db.getScientificTaskSpec(confirmed.spec.taskId).tool_job_id, job.id);
  assert.equal(db.getScientificTaskByToolJob(job.id).spec_hash, confirmed.taskSpecHash);
});

test('HRT-6 persists immutable context checkpoints and resolves the latest handoff source', () => {
  const project = db.createProject({ name: 'HRT-6 checkpoint', modality: 'bulk', workspacePath: join(tempRoot, 'checkpoint-project') });
  const base = {
    schemaVersion: 1,
    checkpointId: 'ctxcp_persist_1',
    projectId: project.id,
    conversationId: 'conv_checkpoint',
    sourceMessageRange: { firstId: 'msg_1', lastId: 'msg_2', count: 2 },
    sourceDigest: sourceMessageDigest([{ id: 'msg_1', role: 'user', content: 'fixture' }, { id: 'msg_2', role: 'assistant', content: 'confirmed' }]),
    policyVersion: 1,
    generatedBy: { mode: 'deterministic', modelProfileId: null, rulesVersion: 1 },
    summary: 'fixture checkpoint',
    taskRefs: [], confirmedDecisions: [], rejectedOptions: [], unresolvedDecisions: [], constraints: [],
    evidenceRefs: [], toolTraceRefs: [], jobRefs: [], artifactRefs: [], editManifestRefs: [], supersedes: null,
    coverage: { requiredFieldsPresent: true, missing: [] },
    createdAt: '2026-07-22T00:00:00.000Z',
  };
  const validated = validateContextCheckpoint(base);
  assert.equal(validated.ok, true);
  assert.equal(db.saveContextCheckpoint(validated.checkpoint).sourceDigest, base.sourceDigest);
  assert.equal(db.getLatestContextCheckpoint(project.id, 'conv_checkpoint').checkpointId, base.checkpointId);
  assert.equal(db.listContextCheckpoints(project.id, 'conv_checkpoint').length, 1);
  assert.throws(() => db.saveContextCheckpoint({ ...validated.checkpoint, sourceDigest: 'f'.repeat(64) }), /context_checkpoint_immutable/);
});

test('running tool jobs survive restart as recovery-required facts', () => {
  const job = db.createToolJob({ toolId: 'fixture-tool', userId: 'local-user', params: {}, status: 'running' });
  const affected = db.markStalledToolJobsRecovery(123456);
  assert.ok(affected.includes(job.id));
  const recovered = db.getToolJob(job.id);
  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.error, 'recovery_required_after_restart');
  assert.equal(recovered.completed_at, 123456);
});
