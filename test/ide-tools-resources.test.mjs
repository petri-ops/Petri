// test/ide-tools-resources.test.mjs
// Verify MCP Resources for IDE: ide://projects and ide://git-status
// Reference: G0-IDE-MCP-TOOLS Phase 1.5 §10
//
// Run: node --test test/ide-tools-resources.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(__dirname, '..', 'core', 'r-server');

const resources = await import(
  pathToFileURL(resolve(CORE, 'mcp/ide-tools/resources.js')).href
);

test('listIdeResources returns both resources', () => {
  const list = resources.listIdeResources();
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 2);
  const uris = list.map((r) => r.uri).join(',');
  assert.ok(uris.includes('ide://projects'));
  assert.ok(uris.includes('ide://git-status'));
});

test('readIdeResource("ide://projects") returns valid JSON', () => {
  const res = resources.readIdeResource('ide://projects');
  assert.equal(res.ok, true);
  assert.equal(res.mimeType, 'application/json');
  const payload = JSON.parse(res.text);
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.projects));
  assert.ok(payload.count >= 0);
  // 每个项目字段齐全
  if (payload.projects.length > 0) {
    const p = payload.projects[0];
    assert.ok(typeof p.name === 'string');
    assert.ok(typeof p.path === 'string');
    assert.ok(typeof p.hasPackageJson === 'boolean');
    assert.ok(typeof p.hasGit === 'boolean');
  }
});

test('readIdeResource("ide://git-status?path=<tmp>") for non-git dir returns isRepo=false', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-res-`);
  const uri = `ide://git-status?path=${encodeURIComponent(tmp)}`;
  const res = resources.readIdeResource(uri);
  assert.equal(res.ok, true);
  const payload = JSON.parse(res.text);
  assert.equal(payload.ok, true);
  assert.equal(payload.isRepo, false);
  fs.rmSync(tmp, { recursive: true });
});

test('readIdeResource rejects out-of-allowlist path', () => {
  const uri = `ide://git-status?path=${encodeURIComponent('/etc/passwd')}`;
  const res = resources.readIdeResource(uri);
  // 业务校验失败时顶层 ok=false + error 透传
  assert.equal(res.ok, false);
  assert.match(res.error, /allowlist|safe|resolve under/);
});

test('readIdeResource invalid URI returns ok=false', () => {
  const res = resources.readIdeResource('foo://bar');
  assert.equal(res.ok, false);
});

test('readIdeResource missing required path param returns ok=false', () => {
  const res = resources.readIdeResource('ide://git-status');
  assert.equal(res.ok, false);
  assert.match(res.error, /path/);
});

test('readIdeResource for current desktop repo (in allowlist) returns real git status', () => {
  // desktop 仓本身是 git 仓库，应当返回 isRepo=true
  const cwd = process.cwd();
  const uri = `ide://git-status?path=${encodeURIComponent(cwd)}`;
  const res = resources.readIdeResource(uri);
  assert.equal(res.ok, true);
  const payload = JSON.parse(res.text);
  assert.equal(payload.ok, true);
  assert.equal(payload.isRepo, true);
  assert.ok(typeof payload.branch === 'string');
  assert.ok(Array.isArray(payload.staged));
  assert.ok(Array.isArray(payload.unstaged));
  assert.ok(Array.isArray(payload.untracked));
});