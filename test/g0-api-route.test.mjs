import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'biof3-g0-api-'));
process.env.BIOF3_DB_PATH = join(tempRoot, 'g0-api.db');
process.env.BIOF3_LOCAL_DATA_DIR = join(tempRoot, 'local-data');

const require = createRequire(import.meta.url);
const express = require('express');
const db = require('../core/r-server/db');
const g0 = require('../core/shared-backend/g0-baseline');
const apiData = require('../core/r-server/api-data');

let server;
let baseUrl;

async function request(pathname, { method = 'GET', body, userId = 'g0-api-user' } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-user': userId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: String(req.headers['x-test-user'] || 'g0-api-user'),
      role: 'user',
    };
    next();
  });
  app.use('/api/data', apiData);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db.db?.open) db.db.close();
  rmSync(tempRoot, { recursive: true, force: true });
});

test('current G0 baseline endpoint exposes the bounded public identity', async () => {
  const response = await request('/api/data/g0-baseline');
  const current = g0.getCurrentG0Baseline();
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.baseline.baselineId, current.baselineId);
  assert.equal(response.body.baseline.baselineVersion, current.baselineVersion);
  assert.equal(response.body.baseline.bundleDigest, current.bundleDigest);
  assert.equal('constitution' in response.body.baseline, false);
});

test('project API creates and reopens a project with its persisted G0 identity', async () => {
  const created = await request('/api/data/projects', {
    method: 'POST',
    body: {
      name: 'G0 API project',
      modality: 'bulk',
      workspacePath: join(tempRoot, 'api-project'),
    },
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.status, 'ok');
  assert.equal(created.body.project.g0_baseline.compatibilityStatus, 'compatible');

  const projectId = created.body.project.id;
  const reopened = await request(`/api/data/projects/${projectId}/g0-baseline`);
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.projectId, projectId);
  assert.equal(reopened.body.baseline.createdBaselineId, g0.manifest.baselineId);
  assert.equal(reopened.body.baseline.executionAllowed, true);
  assert.equal(reopened.body.currentBaseline.baselineId, g0.manifest.baselineId);
});

test('project baseline endpoint reports a future identity as blocked without hiding the project', async () => {
  const project = db.createProject({
    name: 'Future G0 API project',
    modality: 'bulk',
    userId: 'g0-api-user',
    workspacePath: join(tempRoot, 'future-api-project'),
  });
  db.db.prepare(
    `UPDATE project_g0_baselines SET
      created_baseline_id = ?,
      created_baseline_version = ?,
      created_manifest_digest = ?
     WHERE project_id = ?`,
  ).run('g0-future-2', '2.0.0', 'f'.repeat(64), project.id);

  const response = await request(`/api/data/projects/${project.id}/g0-baseline`);
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.baseline.compatibilityStatus, 'blocked');
  assert.equal(response.body.baseline.compatibilityReason, 'future_baseline_unsupported');
  assert.equal(response.body.baseline.executionAllowed, false);
});

test('project jobs enforce ownership, project all conversations, and filter exactly by conversation', async () => {
  const ownerId = 'g0-jobs-owner';
  const created = await request('/api/data/projects', {
    method: 'POST',
    userId: ownerId,
    body: {
      name: 'G0 jobs API project',
      modality: 'bulk',
      workspacePath: join(tempRoot, 'jobs-api-project'),
    },
  });
  assert.equal(created.body.status, 'ok');
  const projectId = created.body.project.id;

  const jobA1 = db.createToolJob({ toolId: 'fixture', userId: ownerId, projectId, conversationId: 'conversation-a' });
  const jobA2 = db.createToolJob({ toolId: 'fixture', userId: ownerId, projectId, conversationId: 'conversation-a' });
  const jobB = db.createToolJob({ toolId: 'fixture', userId: ownerId, projectId, conversationId: 'conversation-b' });
  const jobUnscoped = db.createToolJob({ toolId: 'fixture', userId: ownerId, projectId });

  const all = await request(`/api/data/projects/${projectId}/jobs`, { userId: ownerId });
  assert.equal(all.status, 200);
  assert.equal(all.body.status, 'ok');
  assert.deepEqual(new Set(all.body.jobs.map((job) => job.id)), new Set([
    jobA1.id,
    jobA2.id,
    jobB.id,
    jobUnscoped.id,
  ]));
  assert.equal(all.body.jobs.find((job) => job.id === jobA1.id).conversationId, 'conversation-a');
  assert.equal(all.body.jobs.find((job) => job.id === jobUnscoped.id).conversationId, null);

  const filtered = await request(`/api/data/projects/${projectId}/jobs?conversationId=conversation-a`, { userId: ownerId });
  assert.equal(filtered.body.status, 'ok');
  assert.deepEqual(new Set(filtered.body.jobs.map((job) => job.id)), new Set([jobA1.id, jobA2.id]));
  assert.ok(filtered.body.jobs.every((job) => job.conversationId === 'conversation-a'));

  const denied = await request(`/api/data/projects/${projectId}/jobs`, { userId: 'g0-jobs-other' });
  assert.equal(denied.body.status, 'error');
  assert.equal(denied.body.error, '无权访问此资源');
  assert.equal(denied.body.jobs, undefined);
});
