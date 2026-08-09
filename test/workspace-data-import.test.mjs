import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const express = require('express');
const db = require('../core/r-server/db.js');
const registerFileRoutes = require('../core/r-server/routes/files.js');

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

test('project data import is isolated, non-overwriting, profiled, and origin guarded', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-sdc1-import-'));
  const project = db.createProject({
    name: 'SDC1 import route',
    modality: 'bulk-rna',
    workspacePath: workspace,
  });
  const app = express();
  app.use(express.json());
  registerFileRoutes(app);
  const server = await listen(app);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const trustedHeaders = { Origin: 'http://localhost:3000' };

  try {
    const form = new FormData();
    form.append('files', new Blob(['gene,S1,S2\nG1,10,12\nG2,3,4\n'], { type: 'text/csv' }), 'counts.csv');
    form.append('files', new Blob(['sample,condition\nS1,control\nS2,treated\n'], { type: 'text/csv' }), 'metadata.csv');
    const importedResponse = await fetch(`${base}/api/workspaces/${project.id}/import`, {
      method: 'POST',
      headers: trustedHeaders,
      body: form,
    });
    assert.equal(importedResponse.status, 201);
    const importedBody = await importedResponse.json();
    assert.equal(importedBody.ok, true);
    assert.deepEqual(importedBody.imported.map((item) => item.relativePath), [
      'data/counts.csv',
      'data/metadata.csv',
    ]);
    assert.ok(importedBody.imported.every((item) => item.profile.snapshot.sha256.length === 64));
    assert.equal(fs.readFileSync(path.join(workspace, 'data/counts.csv'), 'utf8').includes('G1,10,12'), true);

    const duplicate = new FormData();
    duplicate.append('files', new Blob(['gene,S1\nG9,99\n'], { type: 'text/csv' }), 'counts.csv');
    const duplicateResponse = await fetch(`${base}/api/workspaces/${project.id}/import`, {
      method: 'POST',
      headers: trustedHeaders,
      body: duplicate,
    });
    assert.equal(duplicateResponse.status, 201);
    const duplicateBody = await duplicateResponse.json();
    assert.equal(duplicateBody.imported[0].relativePath, 'data/counts-2.csv');
    assert.equal(fs.readFileSync(path.join(workspace, 'data/counts.csv'), 'utf8').includes('G9,99'), false);

    const profileResponse = await fetch(`${base}/api/workspaces/${project.id}/profile`, {
      method: 'POST',
      headers: { ...trustedHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['data/counts.csv', 'data/metadata.csv'] }),
    });
    assert.equal(profileResponse.status, 200);
    const profileBody = await profileResponse.json();
    assert.equal(profileBody.profiles.length, 2);
    assert.ok(profileBody.profiles.every((profile) => profile.status === 'ok'));

    const hostile = await fetch(`${base}/api/workspaces/${project.id}/profile`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:6666', 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['data/counts.csv'] }),
    });
    assert.equal(hostile.status, 403);

    const traversal = await fetch(`${base}/api/workspaces/${project.id}/profile`, {
      method: 'POST',
      headers: { ...trustedHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['../outside.csv'] }),
    });
    assert.equal(traversal.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.deleteProject(project.id);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('project data import refuses a symlinked data directory', { skip: process.platform === 'win32' }, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-sdc1-import-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-sdc1-import-outside-'));
  fs.symlinkSync(outside, path.join(workspace, 'data'));
  const project = db.createProject({
    name: 'SDC1 symlink boundary',
    modality: 'bulk-rna',
    workspacePath: workspace,
  });
  const app = express();
  app.use(express.json());
  registerFileRoutes(app);
  const server = await listen(app);
  const { port } = server.address();
  try {
    const form = new FormData();
    form.append('files', new Blob(['gene,S1\nG1,10\n'], { type: 'text/csv' }), 'counts.csv');
    const response = await fetch(`http://127.0.0.1:${port}/api/workspaces/${project.id}/import`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000' },
      body: form,
    });
    assert.equal(response.status, 500);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.deleteProject(project.id);
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
