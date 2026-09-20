// test/ide-tools-registry-resources.test.mjs
// Verify registry.js exposes IDE MCP Resources (Phase 1.5)
//
// Run: node --test test/ide-tools-registry-resources.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(__dirname, '..', 'core', 'biof3-server', 'mcp', 'registry.js');

const registry = await import(pathToFileURL(REGISTRY_PATH).href);

test('listIdeMcpResources exposes ide://projects and ide://git-status', () => {
  const list = registry.listIdeMcpResources();
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 2);
  const uris = list.map((r) => r.uri).join(',');
  assert.ok(uris.includes('ide://projects'));
  assert.ok(uris.includes('ide://git-status'));
});

test('readIdeMcpResource for ide://projects returns text payload', () => {
  const res = registry.readIdeMcpResource('ide://projects');
  assert.equal(res.ok, true);
  assert.equal(res.mimeType, 'application/json');
  const payload = JSON.parse(res.text);
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.projects));
});

test('readIdeMcpResource rejects out-of-allowlist git-status path', () => {
  const res = registry.readIdeMcpResource(
    `ide://git-status?path=${encodeURIComponent('/etc/passwd')}`
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /allowlist|safe|resolve under/);
});

test('listTools still includes all 18 ide_* tools after Phase 1.5 + Phase 3 extension', async () => {
  const tools = await registry.listTools();
  const ideTools = tools.filter((t) => t.name.startsWith('ide_'));
  // 7 file + 5 terminal + 1 search + 1 diff + 4 git = 18
  assert.equal(ideTools.length, 18, `expected 18 ide_* tools, got ${ideTools.length}: ${ideTools.map((t) => t.name).join(',')}`);
  for (const expected of [
    'ide_file_diff',
    'ide_file_search_text',
    'ide_file_read',
    'ide_file_write',
    'ide_terminal_create',
  ]) {
    assert.ok(ideTools.some((t) => t.name === expected), `missing ${expected}`);
  }
});