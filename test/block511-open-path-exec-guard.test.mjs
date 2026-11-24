/**
 * BLOCK-511 S3.2 HK-01 — file:open-path 不再用系统默认程序打开脚本/可执行文件。
 * ①脚本与 Windows 可执行关联类扩展名一律拒绝；②无扩展名且带可执行位的文件拒绝；
 * ③普通数据文件（.txt/.png）仍可打开（回归）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b511-openpath-'));
const handlers = new Map();
const opened = [];
const fakeElectron = {
  ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  app: { getPath: () => tmp, getAppPath: () => process.cwd() },
  shell: { openPath: async (p) => { opened.push(p); return null; } },
  dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) },
  net: {}, nativeImage: { createFromPath: () => ({}) },
};
const origLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') return fakeElectron;
  return origLoad.call(this, request, parent, isMain);
};
let mod;
try { mod = require('../src/ipc/file-dialog.js'); } finally { Module._load = origLoad; }
mod.setupFileDialogIpc({ mainWindow: null, listWorkspaceRoots: () => [] });
const callOpen = (p) => handlers.get('file:open-path')(null, p);

const DENIED = ['.sh', '.bash', '.zsh', '.fish', '.ksh', '.ps1', '.psm1', '.bat', '.cmd',
  '.command', '.scpt', '.workflow', '.vbs', '.vbe', '.wsf', '.ws', '.msi', '.msp', '.exe',
  '.com', '.scr', '.pif', '.cpl', '.hta', '.jar', '.run', '.app', '.dll', '.so', '.dylib'];

test('①脚本与可执行关联类扩展名一律拒绝（不被 shell.openPath 打开）', async () => {
  for (const ext of DENIED) {
    const file = path.join(tmp, `payload${ext}`);
    fs.writeFileSync(file, 'x');
    opened.length = 0;
    const res = await callOpen(file);
    assert.equal(res.ok, false, `${ext} 应拒绝`);
    assert.equal(opened.length, 0, `${ext} 不得打开`);
  }
});

test('②无扩展名且带可执行位的文件拒绝', async () => {
  const file = path.join(tmp, 'noext-executable');
  fs.writeFileSync(file, '#!/bin/sh\necho hi\n');
  fs.chmodSync(file, 0o755);
  opened.length = 0;
  const res = await callOpen(file);
  assert.equal(res.ok, false);
  assert.equal(opened.length, 0);
});

test('③普通数据文件仍可打开（回归）', async () => {
  for (const ext of ['.txt', '.png']) {
    const file = path.join(tmp, `data${ext}`);
    fs.writeFileSync(file, 'x');
    opened.length = 0;
    const res = await callOpen(file);
    assert.equal(res.ok, true, `${ext} 应可打开`);
    assert.ok(opened.includes(file));
  }
});
