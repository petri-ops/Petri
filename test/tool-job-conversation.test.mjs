import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const tempRoot = mkdtempSync(join(tmpdir(), 'biof3-ux1g1-'));
process.env.BIOF3_DB_PATH = join(tempRoot, 'ux1g1.db');
process.env.BIOF3_LOCAL_DATA_DIR = join(tempRoot, 'local-data');

const require = createRequire(import.meta.url);
const db = require('../core/r-server/db');
const BetterSqlite = require('better-sqlite3');
const dbModulePath = resolve(new URL('../core/r-server/db.js', import.meta.url).pathname);

after(() => {
  if (db.db?.open) db.db.close();
  rmSync(tempRoot, { recursive: true, force: true });
});

function seedLegacyDb(dbPath, { withConversationColumn = false } = {}) {
  const legacy = new BetterSqlite(dbPath);
  legacy.exec(`
    CREATE TABLE scientific_task_specs (
      task_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      spec_hash TEXT NOT NULL,
      confirmation_json TEXT,
      tool_job_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (task_id, version)
    );
    CREATE TABLE tool_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      params_json TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      name TEXT DEFAULT '',
      is_test_run INTEGER DEFAULT 0,
      is_public INTEGER DEFAULT 0,
      result_json TEXT,
      completed_at BIGINT,
      error TEXT,
      project_id TEXT${withConversationColumn ? ', conversation_id TEXT' : ''}
    );
  `);

  const insertJob = withConversationColumn
    ? legacy.prepare(`INSERT INTO tool_jobs
        (id, user_id, tool_id, params_json, status, created_at, name, is_test_run, project_id, conversation_id)
        VALUES (?, ?, ?, '{}', 'done', ?, '', 0, ?, ?)`)
    : legacy.prepare(`INSERT INTO tool_jobs
        (id, user_id, tool_id, params_json, status, created_at, name, is_test_run, project_id)
        VALUES (?, ?, ?, '{}', 'done', ?, '', 0, ?)`);

  if (withConversationColumn) {
    insertJob.run('job_existing', 'legacy-user', 'fixture', 1, 'project-1', 'already-bound');
  } else {
    insertJob.run('job_ambiguous', 'legacy-user', 'fixture', 1, 'project-1');
    insertJob.run('job_bound', 'legacy-user', 'fixture', 2, 'project-1');
    insertJob.run('job_cross_project', 'legacy-user', 'fixture', 3, 'project-1');
    insertJob.run('job_unknown', 'legacy-user', 'fixture', 4, 'project-1');
    insertJob.run('job_wrong_owner', 'legacy-user', 'fixture', 5, 'project-1');
    insertJob.run('job_wrong_tool', 'legacy-user', 'fixture', 6, 'project-1');
  }

  const insertSpec = legacy.prepare(`INSERT INTO scientific_task_specs
    (task_id, version, project_id, conversation_id, status, spec_json, spec_hash, confirmation_json, tool_job_id, created_at, updated_at)
    VALUES (?, 1, ?, ?, 'confirmed', '{}', ?, ?, ?, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z')`);
  const confirmation = (userId = 'legacy-user', selectedToolId = 'fixture') => JSON.stringify({
    userId,
    selectedToolId,
    params: {},
  });
  if (withConversationColumn) {
    insertSpec.run('task_existing', 'project-1', 'would-overwrite', 'hash-existing', confirmation(), 'job_existing');
  } else {
    insertSpec.run('task_ambiguous_a', 'project-1', 'conversation-a', 'hash-ambiguous-a', confirmation(), 'job_ambiguous');
    insertSpec.run('task_ambiguous_b', 'project-1', 'conversation-b', 'hash-ambiguous-b', confirmation(), 'job_ambiguous');
    insertSpec.run('task_bound', 'project-1', 'conversation-bound', 'hash-bound', confirmation(), 'job_bound');
    insertSpec.run('task_cross_project', 'project-2', 'conversation-cross', 'hash-cross', confirmation(), 'job_cross_project');
    insertSpec.run('task_wrong_owner', 'project-1', 'conversation-wrong-owner', 'hash-wrong-owner', confirmation('other-user'), 'job_wrong_owner');
    insertSpec.run('task_wrong_tool', 'project-1', 'conversation-wrong-tool', 'hash-wrong-tool', confirmation('legacy-user', 'other-tool'), 'job_wrong_tool');
  }
  legacy.close();
}

function runDbAgainst(dbPath) {
  const script = `
    process.env.BIOF3_DB_PATH = ${JSON.stringify(dbPath)};
    const db = require(${JSON.stringify(dbModulePath)});
    const rows = db.db.prepare('SELECT id, project_id, conversation_id FROM tool_jobs ORDER BY id').all();
    const columns = db.db.prepare('PRAGMA table_info(tool_jobs)').all().map((column) => column.name);
    const indexes = db.db.prepare('PRAGMA index_list(tool_jobs)').all().map((index) => index.name);
    process.stdout.write(JSON.stringify({ rows, columns, indexes }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, BIOF3_DB_PATH: dbPath },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('legacy tool jobs get an exact same-project conversation backfill and index', () => {
  const dbPath = join(tempRoot, 'legacy-backfill.db');
  seedLegacyDb(dbPath);
  const state = runDbAgainst(dbPath);
  const byId = new Map(state.rows.map((row) => [row.id, row]));

  assert.ok(state.columns.includes('conversation_id'));
  assert.ok(state.indexes.includes('idx_tool_jobs_project_conversation'));
  assert.equal(byId.get('job_bound').conversation_id, 'conversation-bound');
  assert.equal(byId.get('job_unknown').conversation_id, null);
  assert.equal(byId.get('job_cross_project').conversation_id, null);
  assert.equal(byId.get('job_ambiguous').conversation_id, null);
  assert.equal(byId.get('job_wrong_owner').conversation_id, null);
  assert.equal(byId.get('job_wrong_tool').conversation_id, null);
});

test('legacy migration never overwrites an already scoped job', () => {
  const dbPath = join(tempRoot, 'legacy-existing-conversation.db');
  seedLegacyDb(dbPath, { withConversationColumn: true });
  const state = runDbAgainst(dbPath);
  assert.equal(state.rows.find((row) => row.id === 'job_existing').conversation_id, 'already-bound');
});

test('project job listing isolates conversations while keeping unscoped history in the default view', () => {
  const project = db.createProject({
    name: 'UX1G-1 jobs',
    modality: 'bulk',
    workspacePath: join(tempRoot, 'jobs-project'),
  });
  const otherProject = db.createProject({
    name: 'UX1G-1 other project',
    modality: 'bulk',
    workspacePath: join(tempRoot, 'other-project'),
  });

  const conversationA1 = db.createToolJob({ toolId: 'fixture', projectId: project.id, conversationId: 'conversation-a' });
  const conversationA2 = db.createToolJob({ toolId: 'fixture', projectId: project.id, conversationId: 'conversation-a' });
  const conversationB = db.createToolJob({ toolId: 'fixture', projectId: project.id, conversationId: 'conversation-b' });
  const unscoped = db.createToolJob({ toolId: 'fixture', projectId: project.id });
  db.createToolJob({ toolId: 'fixture', projectId: otherProject.id, conversationId: 'conversation-a' });

  const all = db.listProjectToolJobs(project.id);
  assert.deepEqual(new Set(all.map((job) => job.id)), new Set([
    conversationA1.id,
    conversationA2.id,
    conversationB.id,
    unscoped.id,
  ]));
  assert.equal(all.find((job) => job.id === unscoped.id).conversation_id, null);

  const onlyA = db.listProjectToolJobs(project.id, 'conversation-a');
  assert.deepEqual(new Set(onlyA.map((job) => job.id)), new Set([conversationA1.id, conversationA2.id]));
  assert.equal(db.listProjectToolJobs(project.id, 'conversation-b').length, 1);
  assert.equal(db.listProjectToolJobs(otherProject.id, 'conversation-a').length, 1);
});

test('tool job creation normalizes blank conversation identity to null', () => {
  const job = db.createToolJob({
    toolId: 'fixture',
    projectId: 'normalization-project',
    conversationId: '   ',
  });
  assert.equal(job.conversation_id, null);

  const scoped = db.createToolJob({
    toolId: 'fixture',
    projectId: 'normalization-project',
    conversationId: '  conversation-normalized  ',
  });
  assert.equal(scoped.conversation_id, 'conversation-normalized');
});

test('scientific task binding requires an exact project and conversation match', () => {
  const project = db.createProject({
    name: 'UX1G-1 binding',
    modality: 'bulk',
    workspacePath: join(tempRoot, 'binding-project'),
  });
  const task = {
    taskId: 'ux1g1_binding_task',
    projectId: project.id,
    conversationId: 'conversation-task',
    status: 'confirmed',
    originalRequest: 'fixture',
  };
  db.saveScientificTaskSpec({
    spec: task,
    specHash: 'a'.repeat(64),
    confirmation: {
      userId: 'agent',
      selectedToolId: 'fixture',
      params: {},
    },
  });

  const wrongConversationJob = db.createToolJob({
    toolId: 'fixture',
    projectId: project.id,
    conversationId: 'conversation-other',
  });
  assert.throws(
    () => db.bindScientificTaskToolJob({ taskId: task.taskId, toolJobId: wrongConversationJob.id }),
    /scientific_task_job_conversation_mismatch/,
  );
  assert.equal(db.getScientificTaskSpec(task.taskId).tool_job_id, null);

  const wrongUserJob = db.createToolJob({
    toolId: 'fixture',
    userId: 'other-user',
    projectId: project.id,
    conversationId: task.conversationId,
  });
  assert.throws(
    () => db.bindScientificTaskToolJob({ taskId: task.taskId, toolJobId: wrongUserJob.id }),
    /scientific_task_job_user_mismatch/,
  );

  const wrongToolJob = db.createToolJob({
    toolId: 'other-tool',
    projectId: project.id,
    conversationId: task.conversationId,
  });
  assert.throws(
    () => db.bindScientificTaskToolJob({ taskId: task.taskId, toolJobId: wrongToolJob.id }),
    /scientific_task_tool_changed/,
  );

  const matchingJob = db.createToolJob({
    toolId: 'fixture',
    projectId: project.id,
    conversationId: task.conversationId,
  });
  const bound = db.bindScientificTaskToolJob({ taskId: task.taskId, toolJobId: matchingJob.id });
  assert.equal(bound.tool_job_id, matchingJob.id);
});

test('approval acknowledgement can enforce the same user, project, and conversation scope', () => {
  const project = db.createProject({
    name: 'UX1G-1 approval scope',
    modality: 'bulk',
    workspacePath: join(tempRoot, 'approval-project'),
  });
  const job = db.createToolJob({
    toolId: 'fixture',
    userId: 'approval-user',
    projectId: project.id,
    conversationId: 'conversation-approval',
    status: 'pending',
  });
  db.setToolJobApproval(job.id, 'ack-ux1g1', Date.now() + 60_000);

  assert.equal(db.ackToolJob('ack-ux1g1', true, {
    userId: 'approval-user',
    projectId: project.id,
    conversationId: 'conversation-other',
  }), null);
  assert.equal(db.getToolJob(job.id).ack_status, 'pending');

  const approved = db.ackToolJob('ack-ux1g1', true, {
    userId: 'approval-user',
    projectId: project.id,
    conversationId: 'conversation-approval',
  });
  assert.equal(approved.ack_status, 'approved');
  assert.equal(approved.conversation_id, 'conversation-approval');
});

test('HTTP approval acknowledgement requires and verifies project/conversation scope', () => {
  const project = db.createProject({
    name: 'UX1G-1 approval route',
    modality: 'bulk',
    workspacePath: join(tempRoot, 'approval-route-project'),
  });
  const job = db.createToolJob({
    toolId: 'fixture',
    userId: 'approval-route-user',
    projectId: project.id,
    conversationId: 'approval-route-conversation',
    status: 'pending',
  });
  db.setToolJobApproval(job.id, 'ack-ux1g1-route', Date.now() + 60_000);

  const handlers = new Map();
  require('../core/r-server/routes/ai-legacy')({
    post(path, ...callbacks) { handlers.set(path, callbacks.at(-1)); },
  });
  const handler = handlers.get('/api/ai/run-tool-ack/:token');
  const invoke = (body) => {
    const response = { statusCode: 200, body: null };
    const res = {
      status(code) { response.statusCode = code; return this; },
      json(value) { response.body = value; return this; },
    };
    handler({
      user: { id: 'approval-route-user' },
      params: { token: 'ack-ux1g1-route' },
      body,
    }, res);
    return response;
  };

  assert.equal(invoke({ approve: true }).statusCode, 400);
  assert.equal(invoke({
    approve: true,
    projectId: project.id,
    conversationId: 'other-conversation',
  }).statusCode, 404);
  assert.equal(db.getToolJob(job.id).ack_status, 'pending');
  const approved = invoke({
    approve: true,
    projectId: project.id,
    conversationId: 'approval-route-conversation',
  });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.ackStatus, 'approved');
});

test('all-job history projections retain project and conversation identity', () => {
  const historyUser = 'history-conversation-user';
  const projectId = 'history-conversation-project';
  db.createToolJob({
    toolId: 'fixture',
    userId: historyUser,
    projectId,
    conversationId: 'history-conversation',
  });
  const pyBridge = require('../core/py-server/r-server-db');
  const rows = pyBridge.listToolJobsByUser(historyUser);
  assert.equal(rows[0].project_id, projectId);
  assert.equal(rows[0].conversation_id, 'history-conversation');

  const routeSource = readFileSync(resolve(new URL('../core/r-server/routes/tools-metadata.js', import.meta.url).pathname), 'utf8');
  assert.match(routeSource, /SELECT id, tool_id,[^']*project_id, conversation_id FROM tool_jobs/);
});
