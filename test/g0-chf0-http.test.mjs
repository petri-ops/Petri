import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const express = require('express');
const boundary = require('../core/shared-backend/local-request-boundary.js');
const registerFileRoutes = require('../core/r-server/routes/files.js');
const { registerRCompute } = require('../core/r-server/routes/r-compute.js');
const { registerPythonRawExecution } = require('../core/py-server/routes/raw-execution.js');
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

test('CHF0 SEC-1 trusts only declared BioF3 renderer origins', () => {
  const previous = {
    trusted: process.env.BIOF3_TRUSTED_DESKTOP_ORIGINS,
    dev: process.env.BIOF3_RENDERER_DEV_URL,
    renderer: process.env.BIOF3_RENDERER_ORIGIN,
  };
  try {
    delete process.env.BIOF3_TRUSTED_DESKTOP_ORIGINS;
    delete process.env.BIOF3_RENDERER_DEV_URL;
    delete process.env.BIOF3_RENDERER_ORIGIN;
    assert.equal(boundary.isTrustedDesktopOrigin('http://localhost:3000'), true);
    assert.equal(boundary.isTrustedDesktopOrigin('http://127.0.0.1:3002'), true);
    process.env.BIOF3_TRUSTED_DESKTOP_ORIGINS = 'http://localhost:4100';
    assert.equal(boundary.isTrustedDesktopOrigin('http://localhost:4100'), true);
    assert.equal(boundary.isTrustedDesktopOrigin('http://localhost:3000'), false);
    assert.equal(boundary.isTrustedDesktopOrigin('http://localhost:6666'), false);
    assert.equal(boundary.isTrustedDesktopOrigin('https://localhost:3000'), false);
    assert.equal(boundary.isTrustedDesktopOrigin('https://evil.example'), false);
    assert.equal(boundary.isTrustedDesktopOrigin('null'), false);
    assert.equal(boundary.isTrustedDesktopOrigin(undefined), true);
  } finally {
    for (const [key, value] of [
      ['BIOF3_TRUSTED_DESKTOP_ORIGINS', previous.trusted],
      ['BIOF3_RENDERER_DEV_URL', previous.dev],
      ['BIOF3_RENDERER_ORIGIN', previous.renderer],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('CHF0 SEC-1 R and Python raw execution routes fail closed', () => {
  for (const [runtime, register, expectedRoutes, expectedError] of [
    ['R', registerRCompute, ['/api/run', '/api/replot/run'], 'raw_r_execution_disabled'],
    ['Python', registerPythonRawExecution, ['/api/run'], 'raw_python_execution_disabled'],
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-chf0-http-storage-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-chf0-http-outside-'));
  const previous = process.env.BIOF3_LOCAL_RESULTS_DIR;
  process.env.BIOF3_LOCAL_RESULTS_DIR = root;
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
    if (previous === undefined) delete process.env.BIOF3_LOCAL_RESULTS_DIR;
    else process.env.BIOF3_LOCAL_RESULTS_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
