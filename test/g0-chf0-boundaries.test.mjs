import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const boundary = await import('../core/shared-backend/local-request-boundary.js');
const { isSafeStorageKey } = await import('../core/r-server/routes/files.js');
const { LocalFileStorage } = await import('../core/shared-backend/storage/local-storage.js');
const { registerRCompute } = await import('../core/r-server/routes/r-compute.js');
const { terminateChildProcess } = await import('../core/r-server/helpers/process-lifecycle.js');

test('CHF0 origin boundary accepts BioF3 loopback and rejects foreign/null origins', () => {
  assert.equal(boundary.isTrustedDesktopOrigin('http://localhost:3000'), true);
  assert.equal(boundary.isTrustedDesktopOrigin('http://127.0.0.1:3002'), true);
  assert.equal(boundary.isTrustedDesktopOrigin(undefined), true);
  assert.equal(boundary.isTrustedDesktopOrigin('null'), false);
  assert.equal(boundary.isTrustedDesktopOrigin('https://evil.example'), false);
});

test('CHF0 storage keys reject traversal and absolute paths', () => {
  for (const key of ['../secret', 'a/../../secret', '..%2Fsecret', '/etc/passwd', '\\etc\\passwd', 'a/./b']) {
    assert.equal(isSafeStorageKey(key), false, key);
  }
  assert.equal(isSafeStorageKey('results/job-1/plot.png'), true);
});

test('CHF0 local storage refuses symlink escape and still serves nested valid keys', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-chf0-storage-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-chf0-outside-'));
  const previous = process.env.BIOF3_LOCAL_RESULTS_DIR;
  process.env.BIOF3_LOCAL_RESULTS_DIR = root;
  try {
    const source = path.join(root, 'source.txt');
    fs.writeFileSync(source, 'ok');
    const storage = new LocalFileStorage();
    await storage.upload(source, 'results/job-1/plot.png');
    assert.equal(storage.read('results/job-1/plot.png').toString(), 'ok');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');
    assert.equal(storage.exists('escape/secret.txt'), false);
    assert.throws(() => storage.read('escape/secret.txt'), /invalid_storage_key/);
  } finally {
    if (previous === undefined) delete process.env.BIOF3_LOCAL_RESULTS_DIR;
    else process.env.BIOF3_LOCAL_RESULTS_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('CHF0 raw R and replot code routes are fail-closed', () => {
  const routes = new Map();
  const app = {
    post(route, ...handlers) { routes.set(route, handlers); },
    get() {},
  };
  registerRCompute(app);
  for (const route of ['/api/run', '/api/replot/run']) {
    const handlers = routes.get(route);
    assert.ok(handlers, route);
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    const req = { headers: { origin: 'http://localhost:3000' } };
    handlers[0](req, response, () => handlers[1](req, response));
    assert.equal(response.statusCode, 410, route);
    assert.equal(response.body.error, 'raw_r_execution_disabled');
  }
});

test('CHF0 process termination escalates from SIGTERM to SIGKILL', async () => {
  const events = [];
  const listeners = {};
  const child = {
    exitCode: null,
    signalCode: null,
    once(name, fn) { listeners[name] = fn; },
    kill(signal) {
      events.push(signal);
      if (signal === 'SIGTERM') return true;
      listeners.exit?.(null, 'SIGKILL');
      return true;
    },
  };
  const result = await terminateChildProcess(child, { graceMs: 1 });
  assert.deepEqual(events, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.terminated, true);
  assert.equal(result.escalated, true);
  const executorSource = fs.readFileSync('core/r-server/helpers/tools-executor.js', 'utf8');
  assert.match(executorSource, /heartbeat_at/);
  assert.match(executorSource, /COALESCE\(heartbeat_at, created_at\)/);
  assert.match(executorSource, /BIOF3_TOOL_HARD_TIMEOUT_MS/);
});

test('CHF0 PCA runtime does not invent groups or align by position', () => {
  const source = fs.readFileSync('resources/built-in-plugins/pca-explorer/scripts/pca-explorer.py', 'utf8');
  assert.match(source, /grouping_status\s*=\s*["']unassigned["']/);
  assert.match(source, /sample_ids\.duplicated\(\)\.any\(\)/);
  assert.match(source, /set\(sample_ids\)\s*!=\s*set\(expr_ids\)/);
  assert.match(source, /groups_by_sample/);
  assert.doesNotMatch(source, /mid\s*=\s*len\(expr\.index\).*groups\s*=\s*\["A"\]/s);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-chf0-pca-'));
  try {
    const expr = path.join(root, 'expr.csv');
    const params = path.join(root, 'params.json');
    fs.writeFileSync(expr, 'sample,g1,g2\ns1,1,2\ns2,2,1\ns3,3,4\n');
    fs.writeFileSync(params, JSON.stringify({ expr_matrix: expr }));
    execFileSync('python', ['resources/built-in-plugins/pca-explorer/scripts/pca-explorer.py', root], { stdio: 'pipe' });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.summary.grouping, 'unassigned');
    const groups = path.join(root, 'groups.csv');
    fs.writeFileSync(groups, 'group\nA\nB\nA\n');
    fs.writeFileSync(params, JSON.stringify({ expr_matrix: expr, group_file: groups }));
    assert.throws(() => execFileSync('python', ['resources/built-in-plugins/pca-explorer/scripts/pca-explorer.py', root], { stdio: 'pipe' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CHF0 volcano defaults to padj and classifies on adjusted significance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-chf0-volcano-'));
  try {
    const table = path.join(root, 'deg.csv');
    fs.writeFileSync(table, 'gene,log2FoldChange,padj,pvalue\ng1,2,0.01,0.9\ng2,-2,0.01,0.9\ng3,2,0.9,0.001\n');
    fs.writeFileSync(path.join(root, 'params.json'), JSON.stringify({ deg_table: table, fc_threshold: 1, pval_threshold: 1.3 }));
    execFileSync('Rscript', ['resources/built-in-plugins/volcano-plot/scripts/volcano-plot.R', root], { stdio: 'pipe' });
    const rows = fs.readFileSync(path.join(root, 'classified_table.csv'), 'utf8');
    assert.match(rows, /"g1",2,"Up"/);
    assert.match(rows, /"g3",2,"NS"/);
    assert.doesNotMatch(rows, /"g1",2,0\.9,"Up"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
