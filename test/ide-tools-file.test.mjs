// test/ide-tools-file.test.mjs
// Phase 1 file operations: 7 MCP tools end-to-end tests
// Reference: G0-IDE-MCP-TOOLS Phase 1 §5
//
// Run: node --test test/ide-tools-file.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(__dirname, '..', 'core', 'petri-server');

const ideTools = await import(
  pathToFileURL(resolve(CORE, 'mcp/ide-tools/index.js')).href
);
const { _rawHandlers } = ideTools;
const H = _rawHandlers;

test('ide_file_create + ide_file_read normal path', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-test-`);
  const filePath = `${tmp}/new.txt`;
  const createRes = H.ide_file_create({ path: filePath, content: 'hello\n' });
  assert.equal(createRes.ok, true);
  assert.ok(fs.existsSync(filePath));

  const readRes = H.ide_file_read({ path: filePath });
  assert.equal(readRes.ok, true);
  assert.equal(readRes.content, 'hello\n');
  assert.equal(readRes.size, 6);

  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_create rejects existing file', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-test-`);
  const filePath = `${tmp}/dup.txt`;
  H.ide_file_create({ path: filePath, content: 'a' });
  const res = H.ide_file_create({ path: filePath, content: 'b' });
  assert.equal(res.ok, false);
  assert.match(res.error, /already exists/);
  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_write overwrite requires confirm=true', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-test-`);
  const filePath = `${tmp}/w.txt`;
  H.ide_file_create({ path: filePath, content: 'old' });
  const noConfirm = H.ide_file_write({ path: filePath, content: 'new' });
  assert.equal(noConfirm.ok, false);
  assert.match(noConfirm.error, /confirm/);
  const confirm = H.ide_file_write({ path: filePath, content: 'new', confirm: true });
  assert.equal(confirm.ok, true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'new');
  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_write append mode', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-test-`);
  const filePath = `${tmp}/a.txt`;
  H.ide_file_create({ path: filePath, content: 'a' });
  const res = H.ide_file_write({ path: filePath, content: 'b', mode: 'append' });
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'ab');
  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_delete requires confirm=true', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-test-`);
  const filePath = `${tmp}/d.txt`;
  H.ide_file_create({ path: filePath, content: 'x' });
  const noConfirm = H.ide_file_delete({ path: filePath });
  assert.equal(noConfirm.ok, false);
  assert.match(noConfirm.error, /confirm/);
  const confirm = H.ide_file_delete({ path: filePath, confirm: true });
  assert.equal(confirm.ok, true);
  assert.ok(!fs.existsSync(filePath));
  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_delete non-empty dir requires recursive=true', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-test-`);
  const dir = `${tmp}/dir`;
  fs.mkdirSync(dir);
  fs.writeFileSync(`${dir}/inside.txt`, 'x');
  const noRecur = H.ide_file_delete({ path: dir, confirm: true });
  assert.equal(noRecur.ok, false);
  assert.match(noRecur.error, /recursive/);
  const recur = H.ide_file_delete({ path: dir, recursive: true, confirm: true });
  assert.equal(recur.ok, true);
  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_rename moves file', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-test-`);
  const oldPath = `${tmp}/old.txt`;
  const newPath = `${tmp}/new.txt`;
  H.ide_file_create({ path: oldPath, content: 'r' });
  const res = H.ide_file_rename({ oldPath, newPath });
  assert.equal(res.ok, true);
  assert.ok(!fs.existsSync(oldPath));
  assert.ok(fs.existsSync(newPath));
  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_rename overwrite requires confirm=true', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-test-`);
  const oldPath = `${tmp}/o.txt`;
  const newPath = `${tmp}/n.txt`;
  H.ide_file_create({ path: oldPath, content: 'o' });
  H.ide_file_create({ path: newPath, content: 'n' });
  const noConfirm = H.ide_file_rename({ oldPath, newPath, overwrite: true });
  assert.equal(noConfirm.ok, false);
  assert.match(noConfirm.error, /confirm/);
  const confirm = H.ide_file_rename({
    oldPath,
    newPath,
    overwrite: true,
    confirm: true,
  });
  assert.equal(confirm.ok, true);
  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_exists returns correct state', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-test-`);
  const filePath = `${tmp}/e.txt`;
  let res = H.ide_file_exists({ path: filePath });
  assert.equal(res.ok, true);
  assert.equal(res.exists, false);
  H.ide_file_create({ path: filePath, content: 'x' });
  res = H.ide_file_exists({ path: filePath });
  assert.equal(res.exists, true);
  assert.equal(res.isFile, true);
  assert.equal(res.isDirectory, false);
  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_list with and without filter', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-test-`);
  H.ide_file_create({ path: `${tmp}/a.txt`, content: 'a' });
  H.ide_file_create({ path: `${tmp}/b.md`, content: 'b' });
  fs.mkdirSync(`${tmp}/sub`);
  const res = H.ide_file_list({ path: tmp });
  assert.equal(res.ok, true);
  assert.equal(res.count, 3);
  const filtered = H.ide_file_list({ path: tmp, filter: '.md' });
  assert.equal(filtered.count, 1);
  fs.rmSync(tmp, { recursive: true });
});

test('ide_file_read rejects out-of-allowlist path', () => {
  const res = H.ide_file_read({ path: '/etc/passwd' });
  assert.equal(res.ok, false);
  assert.match(res.error, /allowlist|safe|resolve under/);
});

test('ide_file_read rejects oversized file via maxSize', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-test-`);
  const filePath = `${tmp}/big.txt`;
  const big = 'x'.repeat(1024);
  H.ide_file_create({ path: filePath, content: big });
  const res = H.ide_file_read({ path: filePath, maxSize: 100 });
  assert.equal(res.ok, false);
  assert.match(res.error, /too large/);
  fs.rmSync(tmp, { recursive: true });
});
