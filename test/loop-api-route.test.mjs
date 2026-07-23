#!/usr/bin/env node

/**
 * HLE-C3R: Loop REST API — REAL router integration tests.
 *
 * Unlike loop-api.test.mjs (which mirrors the projection helpers offline) and
 * loop-iterate-route.test.mjs (which simulates guards with mock req/res), this
 * suite mounts the ACTUAL registerAiLoopRoutes() Express router on a real HTTP
 * server with an isolated SQLite database and a mock auth middleware, then
 * issues real HTTP requests. This is the only layer that catches integration
 * bugs such as the recovery endpoint reading a field name (loopStatusJson) that
 * getLoopRun never returns, or a missing project-ownership check.
 *
 * Covers:
 *   - project-ownership isolation (owner 200, other user 403, public 200, admin 200)
 *   - GET /api/loop/recovery surfaces recovery_required from the run record
 *     (regression: previously read run.loopStatusJson which is always undefined)
 *   - GET /api/loop/runs/:id?expanded=1 surfaces recoveryRequired/abortedByUser
 *   - POST /api/loop/runs/:id/abort writes abortedByUser into the durable record
 *   - GET /api/loop/actions returns persisted actions (previously-dead endpoint)
 *   - unauthenticated requests are rejected 401
 *
 * Run via: node --test test/loop-api-route.test.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-loop-route-int-'));
process.env.BIOF3_DB_PATH = path.join(TMP_DIR, 'test.db');

let db;
let lc;
let server;
let baseUrl;

// Fixture identity
const OWNER_ID = 'user_owner';
const OTHER_ID = 'user_other';
const ADMIN_ID = 'user_admin';
let ownedProjectId;
let publicProjectId;

function nowIso() { return new Date().toISOString(); }

let runSeq = 0;
function persistRun({
  projectId,
  conversationId,
  automationMode = 'trusted',
  executionIntent = 'task_execute',
  loopStatus = 'running',
}) {
  runSeq += 1;
  return db.persistLoopRun(lc.buildLoopRun({
    loopRunId: `loop_route_${Date.now()}_${runSeq}`,
    projectId,
    conversationId,
    taskSpecRef: lc.stableHash({ projectId, conversationId, executionIntent }),
    automationMode,
    executionIntent,
    loopStatus,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
}

async function apiGet(pathname, { userId, role } = {}) {
  return apiRequest('GET', pathname, { userId, role });
}
async function apiPost(pathname, { userId, role } = {}) {
  return apiRequest('POST', pathname, { userId, role });
}

function apiRequest(method, pathname, { userId, role, userObjectOnly = false } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (userId) headers['x-mock-user'] = userId;
    if (role) headers['x-mock-role'] = role;
    if (userObjectOnly) headers['x-mock-user-object-only'] = '1';
    const req = http.request(baseUrl + pathname, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let body = null;
        try { body = data ? JSON.parse(data) : null; } catch { body = data; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  db = (await import('../core/r-server/db.js')).default || (await import('../core/r-server/db.js'));
  lc = (await import('../core/shared-backend/loop-contract.js')).default;

  // Fixtures: an owned project and a public project.
  const owned = db.createProject({ name: 'Owned', modality: 'bulk-rna', userId: OWNER_ID });
  ownedProjectId = owned.id;
  db.setProjectUserId(ownedProjectId, OWNER_ID);

  const pub = db.createProject({ name: 'Public', modality: 'bulk-rna', userId: OWNER_ID });
  publicProjectId = pub.id;
  db.setProjectUserId(publicProjectId, OWNER_ID);
  db.setProjectPublic(publicProjectId, true);

  // Mount the REAL router on a real Express app with a mock-auth middleware.
  const express = require('express');
  const { registerAiLoopRoutes } = require('../core/r-server/routes/ai-loop.js');
  const app = express();
  app.use(express.json());
  // Mock auth: translate test headers into req.userId / req.user
  app.use((req, _res, next) => {
    const uid = req.headers['x-mock-user'];
    const role = req.headers['x-mock-role'];
    if (uid) {
      if (!req.headers['x-mock-user-object-only']) req.userId = String(uid);
      req.user = { id: String(uid), role: role ? String(role) : 'user' };
    }
    next();
  });
  registerAiLoopRoutes(app);

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  try { if (server) await new Promise((r) => server.close(r)); } catch {}
  try { if (db && db.db && db.db.open) db.db.close(); } catch {}
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

test('RT-1 unauthenticated request is rejected 401', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_auth' });
  const res = await apiGet(`/api/loop/runs/${run.loopRunId}`);
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'unauthenticated');
});

// ---------------------------------------------------------------------------
// Ownership isolation
// ---------------------------------------------------------------------------

test('RT-2 owner can read their own run', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_own' });
  const res = await apiGet(`/api/loop/runs/${run.loopRunId}`, { userId: OWNER_ID });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.run.loopRunId, run.loopRunId);
  assert.strictEqual(res.body.run.projectId, ownedProjectId);
});

test('RT-3 a different user is forbidden (403) from another owner\'s run', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_forbidden' });
  const res = await apiGet(`/api/loop/runs/${run.loopRunId}`, { userId: OTHER_ID });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error, 'forbidden');
});

test('RT-4 any authenticated user can read a run in a public project', async () => {
  const run = persistRun({ projectId: publicProjectId, conversationId: 'conv_public' });
  const res = await apiGet(`/api/loop/runs/${run.loopRunId}`, { userId: OTHER_ID });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.run.loopRunId, run.loopRunId);
});

test('RT-5 admin can read any run', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_admin' });
  const res = await apiGet(`/api/loop/runs/${run.loopRunId}`, { userId: ADMIN_ID, role: 'admin' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.run.loopRunId, run.loopRunId);
});

test('RT-6 unknown run is 404', async () => {
  const res = await apiGet('/api/loop/runs/no_such_run', { userId: OWNER_ID });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, 'loop_run_not_found');
});

test('RT-7 list runs filters out runs the user may not access', async () => {
  const conversationId = 'conv_list_iso';
  persistRun({ projectId: ownedProjectId, conversationId });
  const res = await apiGet(`/api/loop/runs?projectId=${ownedProjectId}&conversationId=${conversationId}`, { userId: OTHER_ID });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.count, 0, 'other user must not see owner-only runs in the list');
});

// ---------------------------------------------------------------------------
// Recovery projection — regression: field must be read from run.record
// ---------------------------------------------------------------------------

test('RT-8 recovery surfaces recovery_required from the durable record', async () => {
  // Simulate a server-restart reconcile: running -> failed(recovery_required)
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_recovery' });
  db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'failed',
    hash: run.hash,
    json: JSON.stringify({ recovery_required: true, recovery_reason: 'server_restart_during_active_loop' }),
    updatedAt: nowIso(),
  });
  const res = await apiGet(`/api/loop/recovery/${run.loopRunId}`, { userId: OWNER_ID });
  assert.strictEqual(res.status, 200);
  const rec = res.body.recovery;
  assert.strictEqual(rec.loopStatus, 'failed');
  assert.strictEqual(rec.isTerminal, true);
  // Regression assertions: statusJson must carry the reconcile flags. Before the
  // fix the endpoint read run.loopStatusJson (undefined) so this was always {}.
  assert.strictEqual(rec.statusJson.recovery_required, true);
  assert.strictEqual(rec.statusJson.recovery_reason, 'server_restart_during_active_loop');
  assert.strictEqual(rec.recoveryRequired, true);
  assert.strictEqual(rec.canResume, false, 'a failed(recovery_required) run must not be auto-resumable');
});

test('RT-9 recovery is 403 for a non-owner', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_recovery_iso' });
  const res = await apiGet(`/api/loop/recovery/${run.loopRunId}`, { userId: OTHER_ID });
  assert.strictEqual(res.status, 403);
});

// ---------------------------------------------------------------------------
// Expanded projection
// ---------------------------------------------------------------------------

test('RT-10 expanded run projection surfaces durable recovery detail', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_expanded' });
  db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'failed',
    hash: run.hash,
    json: JSON.stringify({ recovery_required: true, recovery_reason: 'server_restart_during_active_loop' }),
    updatedAt: nowIso(),
  });
  const res = await apiGet(`/api/loop/runs/${run.loopRunId}?expanded=1`, { userId: OWNER_ID });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.run.recoveryRequired, true);
  assert.strictEqual(res.body.run.recoveryReason, 'server_restart_during_active_loop');
  assert.ok(Array.isArray(res.body.run.recentIterations));
});

// ---------------------------------------------------------------------------
// Abort — regression: must write into the durable record and keep status
// ---------------------------------------------------------------------------

test('RT-11 abort writes abortedByUser into the durable record', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_abort' });
  // Move to running so abort is allowed (not terminal)
  db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'running', hash: run.hash, json: JSON.stringify({}), updatedAt: nowIso(),
  });
  const res = await apiPost(`/api/loop/runs/${run.loopRunId}/abort`, { userId: OWNER_ID });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.aborted, true);
  // Verify durably persisted in the record (not lost due to wrong field read)
  const reloaded = db.getLoopRun(run.loopRunId);
  assert.strictEqual(reloaded.record.abortedByUser, true);
  assert.strictEqual(reloaded.loopStatus, 'running', 'abort keeps the run running until the loop observes it');
});

test('RT-12 abort is 403 for a non-owner', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_abort_iso' });
  db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'running', hash: run.hash, json: JSON.stringify({}), updatedAt: nowIso(),
  });
  const res = await apiPost(`/api/loop/runs/${run.loopRunId}/abort`, { userId: OTHER_ID });
  assert.strictEqual(res.status, 403);
});

test('RT-13 abort on a terminal run is 409', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_abort_terminal' });
  db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'running', hash: run.hash, json: JSON.stringify({}), updatedAt: nowIso(),
  });
  db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'completed', hash: run.hash, json: JSON.stringify({}), updatedAt: nowIso(),
  });
  const res = await apiPost(`/api/loop/runs/${run.loopRunId}/abort`, { userId: OWNER_ID });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error, 'loop_already_terminal');
});

// ---------------------------------------------------------------------------
// /actions — previously-dead endpoint
// ---------------------------------------------------------------------------

test('RT-14 actions endpoint returns persisted actions', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_actions' });
  for (let s = 1; s <= 2; s += 1) {
    const it = lc.buildIteration({
      loopRunId: run.loopRunId,
      sequence: s,
      observedStateDigest: `st_${s}`,
      decision: 'continue',
      decisionReasonCode: 'NORMAL_PLAN_GENERATED',
      proposedAction: {
        loopRunId: run.loopRunId,
        sequence: s,
        actionType: 'run_tool',
        toolId: 'deseq2',
        params: { step: s },
      },
      publicConclusion: `step ${s}`,
    });
    db.persistLoopIteration(it);
  }
  const res = await apiGet(`/api/loop/actions/${run.loopRunId}`, { userId: OWNER_ID });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.count, 2);
  assert.ok(res.body.actions.every((a) => a.toolId === 'deseq2'));
});

test('RT-15 actions endpoint is 403 for a non-owner', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_actions_iso' });
  const res = await apiGet(`/api/loop/actions/${run.loopRunId}`, { userId: OTHER_ID });
  assert.strictEqual(res.status, 403);
});

test('RT-16 project-only list returns complete normalized contract fields', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_project_only' });
  const res = await apiGet(`/api/loop/runs?projectId=${ownedProjectId}`, { userId: OWNER_ID });
  assert.strictEqual(res.status, 200);
  const found = res.body.runs.find((item) => item.loopRunId === run.loopRunId);
  assert.ok(found);
  assert.strictEqual(found.automationMode, 'trusted');
  assert.strictEqual(found.executionIntent, 'task_execute');
  assert.ok(found.taskSpecRef);
});

test('RT-17 session summary replays public iterations, activity and conversation usage', async () => {
  const conversationId = 'conv_session_summary';
  const run = persistRun({ projectId: ownedProjectId, conversationId });
  const iteration = lc.buildIteration({
    loopRunId: run.loopRunId,
    sequence: 1,
    observedStateDigest: 'state',
    decision: 'continue',
    decisionReasonCode: 'TOOL_SUCCEEDED',
    publicConclusion: '表达矩阵质控完成',
  });
  db.persistLoopIteration(iteration);
  const { recordAiUsage } = require('../core/r-server/helpers/ai-usage.js');
  recordAiUsage({
    userId: OWNER_ID,
    conversationId,
    kind: 'agent_iter',
    model: 'deepseek-chat',
    promptTokens: 100,
    completionTokens: 25,
    cacheReadTokens: 40,
    costCny: 0.001,
    costStatus: 'estimated',
  });
  const res = await apiGet(
    `/api/loop/session-summary?projectId=${ownedProjectId}&conversationId=${conversationId}`,
    { userId: OWNER_ID },
  );
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.summary.run.loopRunId, run.loopRunId);
  assert.strictEqual(res.body.summary.iterations[0].publicConclusion, '表达矩阵质控完成');
  assert.ok(res.body.summary.activeCount >= 1);
  assert.strictEqual(res.body.summary.usage.inputTokens, 100);
  assert.strictEqual(res.body.summary.usage.outputTokens, 25);
  assert.strictEqual(res.body.summary.usage.cacheReadTokens, 40);
});

test('RT-18 session summary enforces project ownership', async () => {
  const res = await apiGet(
    `/api/loop/session-summary?projectId=${ownedProjectId}&conversationId=conv_forbidden_summary`,
    { userId: OTHER_ID },
  );
  assert.strictEqual(res.status, 403);
});

test('RT-19 production route registry mounts bounded Loop API before the legacy catch-all', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = fs.readFileSync(path.join(repoRoot, 'core/r-server/routes/index.js'), 'utf8');
  const loopApi = source.indexOf("['AI Loop API'");
  const harness = source.indexOf("['Harness'");
  assert.ok(loopApi >= 0 && harness >= 0);
  assert.ok(loopApi < harness, 'AI Loop API must mount before Harness legacy /api/loop/:loopRunId');
});

test('RT-20 desktop req.user identity is normalized without req.userId', async () => {
  const run = persistRun({ projectId: ownedProjectId, conversationId: 'conv_desktop_identity' });
  const res = await apiGet(`/api/loop/runs/${run.loopRunId}`, {
    userId: OWNER_ID,
    userObjectOnly: true,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.run.loopRunId, run.loopRunId);
});
