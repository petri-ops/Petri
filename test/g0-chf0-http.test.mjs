import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

// BLOCK-49 加映清债 —— 统一临时 DB 自举（存量：单跑/全量缺 projects 表）
//（PETRI_DB_PATH 须在 require db.js 前生效；与 agent-tool-registry.test 同一修法）
{
  const fsx = require('node:fs');
  const osx = require('node:os');
  const pth = require('node:path');
  const urlx = require('node:url');
  const hereDir = pth.dirname(urlx.fileURLToPath(import.meta.url));
  const Database = require(pth.resolve(hereDir, '..', 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const tempDbDir = fsx.mkdtempSync(pth.join(osx.tmpdir(), 'petri-sweep-db-'));
  const boot = new Database(pth.join(tempDbDir, 'petri.db'));
  const migrationsDir = pth.resolve(hereDir, '..', 'src', 'migrations');
  for (const f of fsx.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fsx.readFileSync(pth.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = pth.join(tempDbDir, 'petri.db');
  process.on('exit', () => { try { fsx.rmSync(tempDbDir, { recursive: true, force: true }); } catch {} });
}
const express = require('express');
const boundary = require('../core/shared-backend/local-request-boundary.js');
const registerFileRoutes = require('../core/petri-server/routes/files.js');
const { LocalFileStorage } = require('../core/shared-backend/storage/local-storage.js');
const { registerStorage } = require('../core/shared-backend/storage/index.js');

function fakeResponse() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function collectPostRoutes(register) {
  const routes = new Map();
  register({
    post(route, ...handlers) { routes.set(route, handlers); },
    get() {},
  });
  return routes;
}

function invokeHandlers(handlers, req, res, index = 0) {
  return handlers[index](req, res, () => invokeHandlers(handlers, req, res, index + 1));
}

test('CHF0 SEC-1 trusts only declared Petri renderer origins', () => {
  const previous = {
    trusted: process.env.PETRI_TRUSTED_DESKTOP_ORIGINS,
    dev: process.env.PETRI_RENDERER_DEV_URL,
    renderer: process.env.PETRI_RENDERER_ORIGIN,
  };
  try {
    delete process.env.PETRI_TRUSTED_DESKTOP_ORIGINS;
    delete process.env.PETRI_RENDERER_DEV_URL;
    delete process.env.PETRI_RENDERER_ORIGIN;
    assert.equal(boundary.isTrustedDesktopOrigin('http://localhost:3000'), true);
    assert.equal(boundary.isTrustedDesktopOrigin('http://127.0.0.1:3002'), true);
    process.env.PETRI_TRUSTED_DESKTOP_ORIGINS = 'http://localhost:4100';
    assert.equal(boundary.isTrustedDesktopOrigin('http://localhost:4100'), true);
    assert.equal(boundary.isTrustedDesktopOrigin('http://localhost:3000'), false);
    assert.equal(boundary.isTrustedDesktopOrigin('http://localhost:6666'), false);
    assert.equal(boundary.isTrustedDesktopOrigin('https://localhost:3000'), false);
    assert.equal(boundary.isTrustedDesktopOrigin('https://evil.example'), false);
    assert.equal(boundary.isTrustedDesktopOrigin('null'), false);
    assert.equal(boundary.isTrustedDesktopOrigin(undefined), true);
  } finally {
    for (const [key, value] of [
      ['PETRI_TRUSTED_DESKTOP_ORIGINS', previous.trusted],
      ['PETRI_RENDERER_DEV_URL', previous.dev],
      ['PETRI_RENDERER_ORIGIN', previous.renderer],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('CHF0 SEC-1 R raw execution routes fail closed', () => {
  // BLOCK-30 P1: Python 裸执行 410 守卫随独立 Python 后端摘除——
  // 该入口在单后端拓扑下已不存在。
  for (const [runtime, register, expectedRoutes, expectedError] of [
  ]) {
    const routes = collectPostRoutes(register);
    for (const route of expectedRoutes) {
      const handlers = routes.get(route);
      assert.ok(handlers, `${runtime} ${route}`);
      const trusted = fakeResponse();
      invokeHandlers(handlers, { headers: { origin: 'http://localhost:3000' } }, trusted);
      assert.equal(trusted.statusCode, 410, `${runtime} ${route}`);
      assert.equal(trusted.body.error, expectedError);

      const hostile = fakeResponse();
      invokeHandlers(handlers, { headers: { origin: 'http://localhost:6666' } }, hostile);
      assert.equal(hostile.statusCode, 403, `${runtime} hostile ${route}`);
      assert.equal(hostile.body.error, 'untrusted_origin');
    }
  }
});

test('CHF0 SEC-2 real /api/files route rejects origins and traversal while serving valid nested keys', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-chf0-http-storage-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-chf0-http-outside-'));
  const previous = process.env.PETRI_LOCAL_RESULTS_DIR;
  process.env.PETRI_LOCAL_RESULTS_DIR = root;
  let server;
  try {
    const source = path.join(root, 'source.txt');
    fs.writeFileSync(source, 'nested-ok');
    registerStorage('local', new LocalFileStorage());
    await new LocalFileStorage().upload(source, 'results/job-1/plot.txt');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');

    const app = express();
    registerFileRoutes(app);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const trustedHeaders = { Origin: 'http://localhost:3000' };

    const valid = await fetch(`${base}/api/files/results/job-1/plot.txt`, { headers: trustedHeaders });
    assert.equal(valid.status, 200);
    assert.equal(await valid.text(), 'nested-ok');

    const hostile = await fetch(`${base}/api/files/results/job-1/plot.txt`, {
      headers: { Origin: 'http://localhost:6666' },
    });
    assert.equal(hostile.status, 403);

    for (const encoded of ['..%2Fsecret.txt', '%2Fetc%2Fpasswd', 'escape%2Fsecret.txt']) {
      const response = await fetch(`${base}/api/files/${encoded}`, { headers: trustedHeaders });
      assert.notEqual(response.status, 200, encoded);
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.PETRI_LOCAL_RESULTS_DIR;
    else process.env.PETRI_LOCAL_RESULTS_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
