/**
 * item 85 HK-01 — file:open-path 允许常见视频媒体扩展名走系统默认播放器。
 * ①.mp4/.webm/.mov/.m4v 在白名单内（generate.video 产物一键系统播放器打开）；
 * ②脚本/可执行类仍然拒绝（BLOCK-511 S3.2 边界不松动）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-item85-openpath-'));
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

test('①视频媒体扩展名走系统播放器（item 85）', async () => {
  for (const ext of ['.mp4', '.webm', '.mov', '.m4v']) {
    const file = path.join(tmp, `clip${ext}`);
    fs.writeFileSync(file, 'x');
    opened.length = 0;
    const res = await callOpen(file);
    assert.equal(res.ok, true, `${ext} 应可打开`);
    assert.ok(opened.includes(file), `${ext} 应交给 shell.openPath`);
  }
});

test('②脚本/可执行边界不松动（BLOCK-511 回归）', async () => {
  for (const ext of ['.sh', '.bat', '.exe']) {
    const file = path.join(tmp, `payload${ext}`);
    fs.writeFileSync(file, 'x');
    opened.length = 0;
    const res = await callOpen(file);
    assert.equal(res.ok, false, `${ext} 仍应拒绝`);
    assert.equal(opened.length, 0);
  }
});
