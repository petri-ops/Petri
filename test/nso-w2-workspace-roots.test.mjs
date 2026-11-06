/**
 * nso-w2-workspace-roots.test.mjs — BLOCK-360（NSO-W2-1）workspace 根由主进程反查。
 *
 * 缺口（评估 F-05）：workspace:write-text-file 只校验「相对路径不跳出 workspacePath」，
 * 而 workspacePath 本身由渲染层任意指定 → 任何能发 IPC 的页面可把 root 指向 ~ 覆写任意已存在文件。
 * 契约：root 必须是 projects 表登记过的 workspace_path（realpath 归一后精确相等），否则
 * workspace_not_registered；open/showInFolder/writeTextFile 共用同一解析边界。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isRegisteredWorkspaceRoot } = require('../src/ipc/_workspace-roots.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-w2-roots-'));
const registered = path.join(tmp, 'proj-a');
const stranger = path.join(tmp, 'outside');
fs.mkdirSync(registered, { recursive: true });
fs.mkdirSync(stranger, { recursive: true });
fs.writeFileSync(path.join(registered, 'note.md'), 'orig\n');
fs.writeFileSync(path.join(stranger, 'victim.txt'), 'keep\n');

test('W2-1 纯判定：只认 realpath 归一后精确相等的登记根', () => {
  const real = fs.realpathSync(registered);
  assert.equal(isRegisteredWorkspaceRoot(real, [real]), true);
  assert.equal(isRegisteredWorkspaceRoot(fs.realpathSync(stranger), [real]), false);
  assert.equal(isRegisteredWorkspaceRoot(path.dirname(real), [real]), false, '登记根的父目录不得冒充');
  assert.equal(isRegisteredWorkspaceRoot(real, []), false, '空登记集 fail-closed');
});

function loadFileDialogWithMock() {
  const handles = new Map();
  const electronMock = {
    app: { getPath: () => tmp },
    ipcMain: { handle: (c, fn) => handles.set(c, fn), on: () => {} },
    dialog: {}, net: {}, nativeImage: {},
    shell: { openPath: async () => '', showItemInFolder: () => {} },
  };
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return electronMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const modPath = require.resolve('../src/ipc/file-dialog.js');
    delete require.cache[modPath];
    const { setupFileDialogIpc } = require(modPath);
    return { setupFileDialogIpc, handles };
  } finally {
    Module._load = originalLoad;
  }
}

test('W2-1 负测：未登记 root 的写入被拒，受害文件字节不变', async () => {
  const { setupFileDialogIpc, handles } = loadFileDialogWithMock();
  const CHANNELS = require('../src/ipc/channels.js');
  setupFileDialogIpc({ mainWindow: null, listWorkspaceRoots: () => [fs.realpathSync(registered)] });
  const write = handles.get(CHANNELS.workspace.writeTextFile);
  const denied = await write({}, stranger, 'victim.txt', 'pwned\n');
  assert.deepEqual(denied, { ok: false, error: 'workspace_not_registered' });
  assert.equal(fs.readFileSync(path.join(stranger, 'victim.txt'), 'utf8'), 'keep\n');
  const ok = await write({}, registered, 'note.md', 'edited\n');
  assert.equal(ok.ok, true);
  assert.equal(fs.readFileSync(path.join(registered, 'note.md'), 'utf8'), 'edited\n');
  const escape = await write({}, registered, '../outside/victim.txt', 'pwned\n');
  assert.equal(escape.ok, false, '登记根内的路径穿越仍拒');
});

test('W2-1 负测：open/showInFolder 共用同一登记根边界', async () => {
  const { setupFileDialogIpc, handles } = loadFileDialogWithMock();
  const CHANNELS = require('../src/ipc/channels.js');
  setupFileDialogIpc({ mainWindow: null, listWorkspaceRoots: () => [fs.realpathSync(registered)] });
  const open = await handles.get(CHANNELS.file.openWorkspaceFile)({}, stranger, 'victim.txt');
  assert.deepEqual(open, { ok: false, error: 'workspace_not_registered' });
  const show = await handles.get(CHANNELS.file.showInFolder)({}, stranger, 'victim.txt');
  assert.deepEqual(show, { ok: false, error: 'workspace_not_registered' });
});

test('W2-1 登记根解析失败 fail-closed（不回落为放行）', async () => {
  const { setupFileDialogIpc, handles } = loadFileDialogWithMock();
  const CHANNELS = require('../src/ipc/channels.js');
  setupFileDialogIpc({ mainWindow: null, listWorkspaceRoots: () => { throw new Error('db down'); } });
  const r = await handles.get(CHANNELS.workspace.writeTextFile)({}, registered, 'note.md', 'x\n');
  assert.equal(r.ok, false);
  assert.match(String(r.error), /workspace_roots_unavailable/);
});
