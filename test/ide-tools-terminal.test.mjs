// test/ide-tools-terminal.test.mjs
// Phase 1 terminal operations: 5 MCP tools end-to-end tests
// Reference: G0-IDE-MCP-TOOLS Phase 1 §5
//
// Run: node --test test/ide-tools-terminal.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(__dirname, '..', 'core', 'r-server');

const ideTools = await import(
  pathToFileURL(resolve(CORE, 'mcp/ide-tools/index.js')).href
);
const { _rawHandlers } = ideTools;
const H = _rawHandlers;

const terminal = await import(
  pathToFileURL(resolve(CORE, 'mcp/ide-tools/terminal.js')).href
);

test('ide_terminal_create + write + read + list + close', async () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-term-`);
  const create = H.ide_terminal_create({ cwd: tmp, name: 't1' });
  assert.equal(create.ok, true, `create failed: ${create.error}`);
  const sessionId = create.sessionId;

  const write = H.ide_terminal_write({ sessionId, command: 'echo biof3-ide-test\r\n' });
  assert.equal(write.ok, true);
  assert.equal(write.written, 'echo biof3-ide-test\r\n'.length);

  // wait for PTY output to flow back into buffer
  await new Promise((r) => setTimeout(r, 350));

  const read = H.ide_terminal_read({ sessionId });
  assert.equal(read.ok, true);
  assert.ok(typeof read.text === 'string');
  assert.ok(read.text.includes('biof3-ide-test'), `expected output to contain token, got: ${read.text}`);

  const list = H.ide_terminal_list();
  assert.equal(list.ok, true);
  assert.ok(list.count >= 1);
  assert.ok(list.sessions.some((s) => s.id === sessionId));

  const close = H.ide_terminal_close({ sessionId, confirm: true });
  assert.equal(close.ok, true, `close failed: ${close.error}`);

  fs.rmSync(tmp, { recursive: true });
});

test('ide_terminal_close requires confirm=true', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-term-`);
  const create = H.ide_terminal_create({ cwd: tmp });
  assert.equal(create.ok, true);
  const noConfirm = H.ide_terminal_close({ sessionId: create.sessionId });
  assert.equal(noConfirm.ok, false);
  assert.match(noConfirm.error, /confirm/);
  H.ide_terminal_close({ sessionId: create.sessionId, confirm: true });
  fs.rmSync(tmp, { recursive: true });
});

test('ide_terminal_write rejects oversized command', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-term-`);
  const create = H.ide_terminal_create({ cwd: tmp });
  assert.equal(create.ok, true);
  const longCmd = 'x'.repeat(10000);
  const res = H.ide_terminal_write({ sessionId: create.sessionId, command: longCmd });
  assert.equal(res.ok, false);
  assert.match(res.error, /too long/);
  H.ide_terminal_close({ sessionId: create.sessionId, confirm: true });
  fs.rmSync(tmp, { recursive: true });
});

test('ide_terminal_create rejects out-of-allowlist cwd', () => {
  const res = H.ide_terminal_create({ cwd: '/etc' });
  assert.equal(res.ok, false);
  assert.match(res.error, /allowlist|safe|resolve under/);
});

test('ide_terminal_write rejects unknown session', () => {
  const res = H.ide_terminal_write({ sessionId: 'nonexistent', command: 'x' });
  assert.equal(res.ok, false);
  assert.match(res.error, /not found/);
});

test('terminal module exposes _resetForTest', () => {
  assert.equal(typeof terminal._resetForTest, 'function');
  terminal._resetForTest();
});
