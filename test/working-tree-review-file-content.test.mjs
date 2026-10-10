/**
 * working-tree-review-file-content.test.mjs — BLOCK-50
 *
 * 验证 git:working-tree-file-content 对「工作区已删除/已消失文件」的结构化兜底：
 *  - HEAD 有、工作区无（D 删除）→ { ok:true, data:{ content:'', deleted:true } }
 *  - HEAD 无、工作区无（历史残留）→ { ok:true, data:{ content:'', missing:true } }
 *  - 工作区存在 → 正常内容（回归）
 *
 * 通过 Module._load 注入 electron mock（ipcMain/app），在 tmpfs git 仓库上
 * 走真实 handler（safeInvoke + resolveGitAdapter 无 projectId 路径）。
 */

import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-wtr-b50-'));
const repoDir = path.join(tmpRoot, 'repo');
const userDataDir = path.join(tmpRoot, 'user-data');
fs.mkdirSync(repoDir, { recursive: true });
fs.mkdirSync(userDataDir, { recursive: true });

const git = (args, opts = {}) =>
  execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf-8', ...opts });

// 初始化 tmp 仓库：a.txt 已提交后从工作区删除（D）；b-only.txt 提交后彻底改名消失不适用，
// 用 c-gone.txt：提交后从磁盘删除且从索引移除（模拟历史残留：HEAD 与工作区均无）
git(['init', '-q']);
git(['config', 'user.email', 'test@petri.local']);
git(['config', 'user.name', 'petri-test']);
fs.writeFileSync(path.join(repoDir, 'a.txt'), 'head a line\n');
fs.writeFileSync(path.join(repoDir, 'c-gone.txt'), 'gone content\n');
fs.writeFileSync(path.join(repoDir, 'live.txt'), 'live content\n');
git(['add', '-A']);
git(['commit', '-qm', 'init']);
// a.txt：工作区删除（HEAD 仍有）
fs.rmSync(path.join(repoDir, 'a.txt'));
// c-gone.txt：git rm（HEAD 与工作区在当前 HEAD 中仍存在——模拟「彻底消失」需用从未跟踪的文件：
// 历史会话改动卡片引用的已删未跟踪文件，HEAD 无、工作区无）
fs.rmSync(path.join(repoDir, 'c-gone.txt'));
// live.txt 保留在工作区（回归场景）

// ---- electron mock（必须在 require 目标模块前注入）----
const handlers = new Map();
const fakeIpcMain = { handle: (name, fn) => handlers.set(name, fn) };
const fakeApp = { getPath: () => userDataDir, getAppPath: () => repoDir };

const origLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return { ipcMain: fakeIpcMain, app: fakeApp, BrowserWindow: class {} };
  }
  return origLoad.call(this, request, parent, isMain);
};

let mod;
try {
  mod = require('../src/ipc/working-tree-review.js');
} finally {
  Module._load = origLoad;
}

const { setupWorkingTreeReviewIpc } = mod;

// 注册 handlers（捕获到 handlers Map）
const fakeWindow = { isDestroyed: () => false, webContents: { isDestroyed: () => false } };
setupWorkingTreeReviewIpc({ mainWindow: fakeWindow });
const fakeEvent = { sender: fakeWindow.webContents };

const callFileContent = (args) => handlers.get('git:working-tree-file-content')(fakeEvent, args);

beforeEach(() => {});
afterEach(() => {});

test('BLOCK-50: 工作区已删除（HEAD 有）→ deleted:true 空内容', async () => {
  const res = await callFileContent({ path: 'a.txt' });
  assert.equal(res.ok, true);
  assert.equal(res.data.deleted, true);
  assert.equal(res.data.content, '');
  assert.equal(res.data.missing, undefined);
});

test('BLOCK-50: HEAD 与工作区均无（历史残留）→ missing:true', async () => {
  const res = await callFileContent({ path: 'docs/archive/.git-quick-ref.md' });
  assert.equal(res.ok, true);
  assert.equal(res.data.missing, true);
  assert.equal(res.data.content, '');
  assert.equal(res.data.deleted, undefined);
});

test('BLOCK-50: 工作区存在 → 正常内容（回归）', async () => {
  const res = await callFileContent({ path: 'live.txt' });
  assert.equal(res.ok, true);
  assert.equal(res.data.content, 'live content\n');
  assert.equal(res.data.deleted, undefined);
  assert.equal(res.data.missing, undefined);
});

test('BLOCK-50: ref=HEAD 请求已删除文件 → 仍返回 HEAD 内容（回归）', async () => {
  const res = await callFileContent({ path: 'a.txt', ref: 'HEAD' });
  assert.equal(res.ok, true);
  assert.equal(res.data.content, 'head a line\n');
});
