// test/ide-tools-path-allowlist.test.mjs
// Path allowlist unit tests - verify resolveAllowlisted / resolveAllowlistedPair
// Reference: G0-IDE-MCP-TOOLS Phase 1 §5 (docs/g0-ide-mcp-tools-plan.md)
//
// Run: node --test test/ide-tools-path-allowlist.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(__dirname, '..', 'core', 'biof3-server');

const allowlist = await import(
  pathToFileURL(resolve(CORE, 'mcp/ide-tools/path-allowlist.js')).href
);

test('cwd path is allowed', () => {
  const cwd = process.cwd();
  const result = allowlist.resolveAllowlisted('.');
  assert.equal(result.ok, true, `reason: ${result.reason}`);
  assert.equal(result.absolutePath, cwd);
});

test('absolute path within allowlist is allowed', () => {
  const result = allowlist.resolveAllowlisted(os.tmpdir());
  assert.equal(result.ok, true);
});

test('"../" path traversal is rejected', () => {
  const result = allowlist.resolveAllowlisted('../../../etc/passwd');
  assert.equal(result.ok, false);
  assert.match(result.reason, /allowlist|safe|resolve under/);
});

test('null byte path is rejected', () => {
  const result = allowlist.resolveAllowlisted('foo\0bar');
  assert.equal(result.ok, false);
  assert.match(result.reason, /null/);
});

test('empty string is rejected', () => {
  const result = allowlist.resolveAllowlisted('');
  assert.equal(result.ok, false);
});

test('non-string path is rejected', () => {
  const result = allowlist.resolveAllowlisted(null);
  assert.equal(result.ok, false);
});

test('.git segment is deny-listed', () => {
  const result = allowlist.resolveAllowlisted('.git/config');
  assert.equal(result.ok, false);
  assert.match(result.reason, /deny/);
});

test('.ssh segment is deny-listed', () => {
  const result = allowlist.resolveAllowlisted('.ssh/id_rsa');
  assert.equal(result.ok, false);
});

test('resolveAllowlistedPair validates both paths', () => {
  const cwd = process.cwd();
  const oldPath = `${cwd}/a.txt`;
  const newPath = `${cwd}/b.txt`;
  const result = allowlist.resolveAllowlistedPair(oldPath, newPath);
  assert.equal(result.ok, true);
  assert.equal(result.oldPath, oldPath);
  assert.equal(result.newPath, newPath);
});

test('resolveAllowlistedPair rejects when one path escapes', () => {
  const result = allowlist.resolveAllowlistedPair('/etc/passwd', '/tmp/x');
  assert.equal(result.ok, false);
  assert.match(result.reason, /oldPath/);
});

test('allowedRoots includes cwd and tmpdir', () => {
  const roots = allowlist.allowedRoots();
  assert.ok(roots.length >= 2);
  assert.ok(roots.some((r) => r === process.cwd()));
  assert.ok(roots.some((r) => r === os.tmpdir()));
});
