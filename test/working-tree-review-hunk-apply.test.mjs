/**
 * working-tree-review-hunk-apply.test.mjs — UI-LEDGER-CLOSEOUT UI-180 实机验收发现缺陷的回归
 *
 * 缺陷（2026-09-08 实机 CDP 验收发现）：parseDiffFiles 把 diff 文本末尾 split('\n')
 * 产生的零长度行当作空 ctx 行吸进 hunk，行数虚增 1 → buildReversePatchForReject
 * 产出的反向 patch pre-image 行数与文件不符 → git apply "patch does not apply"。
 * 触发条件：hunk 位于文件末尾（追加型改动，极常见）。
 *
 * 本测试在 tmpfs git 仓库上走真实 handler：
 *  - git:working-tree-diff 解析出 hunk（末尾追加型）
 *  - git:hunk-apply action=reject → 磁盘内容还原为 HEAD
 *  - git:hunk-apply action=accept → 仅记录决策，不写盘（回归）
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-wtr-hunkapply-'));
const repoDir = path.join(tmpRoot, 'repo');
const userDataDir = path.join(tmpRoot, 'user-data');
fs.mkdirSync(repoDir, { recursive: true });
fs.mkdirSync(userDataDir, { recursive: true });

const git = (args, opts = {}) =>
  execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf-8', ...opts });

const HEAD_BODY = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const TARGET = 'append-at-eof.txt';

// ---- tmp 仓库：提交 10 行文件，然后工作区末尾追加 3 行（hunk 位于 EOF）----
git(['init', '-q']);
git(['config', 'user.email', 'test@petri.local']);
git(['config', 'user.name', 'petri-test']);
fs.writeFileSync(path.join(repoDir, TARGET), HEAD_BODY);
git(['add', '-A']);
git(['commit', '-qm', 'init']);
fs.writeFileSync(path.join(repoDir, TARGET), HEAD_BODY + 'tail a\n.tail b\ntail c\n');

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
const fakeWindow = { isDestroyed: () => false, webContents: { isDestroyed: () => false } };
setupWorkingTreeReviewIpc({ mainWindow: fakeWindow });
const fakeEvent = { sender: fakeWindow.webContents };

const callDiff = (args) => handlers.get('git:working-tree-diff')(fakeEvent, args);
const callHunkApply = (args) => handlers.get('git:hunk-apply')(fakeEvent, args);
const callRevert = (args) => handlers.get('git:working-tree-revert')(fakeEvent, args);
const readTarget = () => fs.readFileSync(path.join(repoDir, TARGET), 'utf-8');

test('UI-180: working-tree-diff 解析末尾追加 hunk 不含 phantom 空 ctx 行', async () => {
  const res = await callDiff({ paths: [TARGET] });
  assert.equal(res.ok, true);
  const file = res.data.files.find((f) => f.path === TARGET);
  assert.ok(file, 'target file in diff');
  assert.equal(file.hunks.length, 1);
  const hunk = file.hunks[0];
  // 3 ctx + 3 add，且最后一条不是零长度伪影 ctx
  assert.equal(hunk.lines.filter((l) => l.type === 'ctx').length, 3);
  assert.equal(hunk.lines.filter((l) => l.type === 'add').length, 3);
  assert.notEqual(hunk.lines[hunk.lines.length - 1].text, '');
});

test('UI-180: hunk-apply reject（EOF 追加型 hunk）→ git apply 成功且磁盘还原 HEAD', async () => {
  const diffRes = await callDiff({ paths: [TARGET] });
  const file = diffRes.data.files.find((f) => f.path === TARGET);
  const hunk = file.hunks[0];

  const res = await callHunkApply({ file: TARGET, hunkIndex: 0, action: 'reject', hunk });
  assert.equal(res.ok, true, `reject 应成功: ${JSON.stringify(res)}`);
  assert.equal(res.data.action, 'reject');
  assert.equal(readTarget(), HEAD_BODY, 'reject 后磁盘内容应还原为 HEAD');
});

test('UI-180: hunk-apply accept → 仅决策不写盘（回归）', async () => {
  // 重新制造改动
  fs.writeFileSync(path.join(repoDir, TARGET), HEAD_BODY + 'tail a\ntail b\ntail c\n');
  const diffRes = await callDiff({ paths: [TARGET] });
  const file = diffRes.data.files.find((f) => f.path === TARGET);
  const hunk = file.hunks[0];

  const res = await callHunkApply({ file: TARGET, hunkIndex: 0, action: 'accept', hunk });
  assert.equal(res.ok, true);
  assert.equal(res.data.action, 'accept');
  assert.equal(readTarget(), HEAD_BODY + 'tail a\ntail b\ntail c\n', 'accept 不修改磁盘');
});

test('UI-180: working-tree-revert 混合 tracked+untracked → tracked 还原 + untracked 删除', async () => {
  // tracked 文件制造改动 + 一个未跟踪文件（「全部还原」把两类一起传入）
  fs.writeFileSync(path.join(repoDir, TARGET), HEAD_BODY + 'dirty\n');
  const untrackedName = 'untracked-revert-fixture.txt';
  fs.writeFileSync(path.join(repoDir, untrackedName), 'to be deleted\n');

  const res = await callRevert({ paths: [TARGET, untrackedName] });
  assert.equal(res.ok, true, `revert 应成功: ${JSON.stringify(res)}`);
  assert.deepEqual(res.data.reverted, [TARGET]);
  assert.deepEqual(res.data.deletedUntracked, [untrackedName]);
  assert.equal(readTarget(), HEAD_BODY, 'tracked 文件还原为 HEAD');
  assert.equal(fs.existsSync(path.join(repoDir, untrackedName)), false, 'untracked 文件被删除');
});
