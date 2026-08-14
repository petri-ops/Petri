// test/ide-tools-registry.test.mjs
// Verify registry.js exposes 12 IDE tools via listTools() and routes them via callTool()
//
// Run: node --test test/ide-tools-registry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(__dirname, '..', 'core', 'r-server', 'mcp', 'registry.js');

const registry = await import(pathToFileURL(REGISTRY_PATH).href);

test('listTools includes 12 ide_* tools', async () => {
  const tools = await registry.listTools();
  const ideTools = tools.filter((t) => t.name.startsWith('ide_'));
  assert.ok(ideTools.length >= 12, `expected >=12 ide_* tools, got ${ideTools.length}`);
  const names = ideTools.map((t) => t.name).sort();
  for (const expected of [
    'ide_file_create',
    'ide_file_delete',
    'ide_file_exists',
    'ide_file_list',
    'ide_file_read',
    'ide_file_rename',
    'ide_file_write',
    'ide_terminal_close',
    'ide_terminal_create',
    'ide_terminal_list',
    'ide_terminal_read',
    'ide_terminal_write',
  ]) {
    assert.ok(names.includes(expected), `missing ${expected} in listTools()`);
  }
});

test('callTool("ide_file_exists") returns ok=true for valid path', async () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-reg-`);
  const res = await registry.callTool('ide_file_exists', { path: tmp });
  assert.equal(res.isError, false, `isError expected false, got: ${JSON.stringify(res)}`);
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.ok, true);
  assert.equal(payload.exists, true);
  fs.rmSync(tmp, { recursive: true });
});

test('callTool("ide_file_read") out-of-allowlist returns isError=true', async () => {
  const res = await registry.callTool('ide_file_read', { path: '/etc/passwd' });
  assert.equal(res.isError, true);
});

test('callTool("nonexistent") falls through to unknown_tool', async () => {
  const res = await registry.callTool('nonexistent_tool_xyz', {});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unknown_tool/);
});
