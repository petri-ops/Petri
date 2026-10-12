/**
 * BLOCK-169 — commitReview 三边缘修复红绿行为测（C-24 H 边缘三条）
 *
 *   H-1 键基线对称：staged 文件（indexStatus 非空）面板键来自 HEAD→index 面，
 *       commitReview 对账同源（staged 面混拼工作树面）——「staged 后再编辑」不再误判 stale。
 *   H-2 staged 删除分流：index 已删条目走 removePaths（git rm --cached 语义），
 *       不再落入 git add pathspec fatal。
 *   H-3 真实 index 对齐后移：apply 失败 fail-closed 时真实 index 不残留先行 stage
 *       （重排实现；失败注入不可廉价构造，语义由重排+既有场景 1 覆盖——见 plan §5）。
 *
 * 工区沿用 test/block152-hunk-stage.test.mjs 的临时仓 + electron mock 范式；
 * 决策键与面板同源：staged 场景一律用 git:working-tree-diff {staged:true} 取 hunk。
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

const LINES = Array.from({ length: 24 }, (_, i) => `line ${i + 1}`);
const HEAD_BODY = LINES.join('\n') + '\n';
const V2 = (() => {
  const lines = [...LINES];
  lines[2] = 'CHANGED line 3';
  lines[10] = 'CHANGED line 11';
  return lines.join('\n') + '\n';
})();
const V3 = (() => {
  const lines = [...LINES];
  lines[2] = 'CHANGED line 3';
  lines[10] = 'CHANGED line 11';
  lines[12] = 'CHANGED line 12 too';
  return lines.join('\n') + '\n';
})();
const TARGET = 'multi-hunk.txt';
const OTHER = 'other.txt';

// ---------------------------------------------------------------------------
// electron mock + 模块装载（同 block152 范式）
// ---------------------------------------------------------------------------
const handlers = new Map();
const fakeIpcMain = { handle: (name, fn) => handlers.set(name, fn) };
let currentRepo = null;
const fakeApp = {
  getPath: () => currentRepo.userDataDir,
  getAppPath: () => currentRepo.repoDir,
};

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
const callCommitReview = (args) => handlers.get('git:commit-review')(fakeEvent, args);

// ---------------------------------------------------------------------------
// 临时仓
// ---------------------------------------------------------------------------
function makeReviewRepo(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  });
  const repoDir = path.join(root, 'repo');
  const userDataDir = path.join(root, 'user-data');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  const git = (args) => execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf-8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@petri.local']);
  git(['config', 'user.name', 'petri-test']);
  fs.writeFileSync(path.join(repoDir, TARGET), HEAD_BODY);
  fs.writeFileSync(path.join(repoDir, OTHER), 'other content\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
  const repo = { root, repoDir, userDataDir, git };
  currentRepo = repo;
  return repo;
}

function hunkSignatureOf(hunk) {
  let hash = 0x811c9dc5;
  for (const line of hunk.lines) {
    const s = `${line.type.charCodeAt(0)}:${line.text}\n`;
    for (let i = 0; i < s.length; i += 1) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `h${hunk.oldStart}-${hash.toString(36)}`;
}

const keyOf = (file, hunk) => `${file}#${hunkSignatureOf(hunk)}`;
const readTarget = (repo) => fs.readFileSync(path.join(repo.repoDir, TARGET), 'utf-8');
const headTarget = (repo) => repo.git(['show', `HEAD:${TARGET}`]);

async function getStagedHunks(repo, filePath = TARGET) {
  const res = await callDiff({ paths: [filePath], staged: true });
  assert.equal(res.ok, true, `staged diff 应成功: ${JSON.stringify(res)}`);
  const file = res.data.files.find((f) => f.path === filePath);
  assert.ok(file, `${filePath} 应出现在 staged diff 中`);
  return file.hunks;
}

// ---------------------------------------------------------------------------
// H-1（红→绿）：staged 后再编辑——面板 staged 键提交成功，HEAD=staged 内容，再编辑留工作区
// ---------------------------------------------------------------------------
test('BLOCK-169 H-1: staged 后再编辑 → staged 键提交成功（HEAD=staged），再编辑留工作区', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b169-h1-staged-edit-');
  // v2 入工作树并 staged；再编辑出 v3 留工作树
  fs.writeFileSync(path.join(repo.repoDir, TARGET), V2);
  repo.git(['add', TARGET]);
  fs.writeFileSync(path.join(repo.repoDir, TARGET), V3);

  // 面板 staged 视图键（HEAD v1 → index v2）
  const hunks = await getStagedHunks(repo);
  assert.ok(hunks.length >= 1, 'staged diff 应有 hunk');
  const decisions = {};
  for (const hunk of hunks) decisions[keyOf(TARGET, hunk)] = 'accept';

  const res = await callCommitReview({ decisions, message: 'review: staged baseline' });
  assert.equal(res.ok, true, `staged 键提交应成功（键基线对称）: ${JSON.stringify(res)}`);

  assert.equal(headTarget(repo), V2, 'HEAD 应恰为 staged 内容（v2）');
  assert.equal(readTarget(repo), V3, '再编辑（v3）必须留在工作区');
});

// ---------------------------------------------------------------------------
// H-2（红→绿）：staged 删除全 accept → removePaths 分流，提交成功且树中已删
// ---------------------------------------------------------------------------
test('BLOCK-169 H-2: staged 删除全 accept → 提交成功且 HEAD 无此文件', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b169-h2-staged-del-');
  repo.git(['rm', '-q', TARGET]); // staged 删除：index D、工作树无文件

  const hunks = await getStagedHunks(repo);
  const decisions = {};
  for (const hunk of hunks) decisions[keyOf(TARGET, hunk)] = 'accept';

  const res = await callCommitReview({ decisions, message: 'review: staged deletion' });
  assert.equal(res.ok, true, `staged 删除提交应成功（rm --cached 分流）: ${JSON.stringify(res)}`);

  let gone = false;
  try { repo.git(['show', `HEAD:${TARGET}`]); } catch { gone = true; }
  assert.ok(gone, 'HEAD 应已删除该文件');
  assert.ok(!fs.existsSync(path.join(repo.repoDir, TARGET)), '工作树应保持删除');
});

// ---------------------------------------------------------------------------
// H-3（语义覆盖）：staged 部分接受 → 真实 index 对齐提交内容且不吞再编辑
// （apply 失败零遗留由「stage 后移到成功路径」的结构保证，见 plan §5）
// ---------------------------------------------------------------------------
test('BLOCK-169 H-3: staged 部分 accept → 提交恰为所接受 hunk，其余以未暂存/暂存态保留', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b169-h3-staged-partial-');
  fs.writeFileSync(path.join(repo.repoDir, TARGET), V2);
  repo.git(['add', TARGET]);
  fs.writeFileSync(path.join(repo.repoDir, TARGET), V3);

  const hunks = await getStagedHunks(repo);
  assert.equal(hunks.length, 2, 'v1→v2 应为两个 hunk（l3/l11）');
  const decisions = { [keyOf(TARGET, hunks[0])]: 'accept' };

  const res = await callCommitReview({ decisions, message: 'review: staged partial' });
  assert.equal(res.ok, true, `staged 部分接受应成功: ${JSON.stringify(res)}`);

  const head = headTarget(repo);
  assert.ok(head.includes('CHANGED line 3'), 'HEAD 应含被接受的 hunk1');
  assert.ok(!head.includes('CHANGED line 11'), 'HEAD 不应含未接受 hunk2');
  assert.equal(readTarget(repo), V3, '工作树再编辑完整保留');
});

// ---------------------------------------------------------------------------
// H-2 回归：staged 删除 + 另一文件混合 → 两文件面互不踩
// ---------------------------------------------------------------------------
test('BLOCK-169 H-2 回归: staged 删除与普通修改混合提交', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b169-h2-mixed-');
  repo.git(['rm', '-q', TARGET]);
  fs.writeFileSync(path.join(repo.repoDir, OTHER), 'other changed\n');
  repo.git(['add', OTHER]);

  const resDiff = await callDiff({ paths: [TARGET, OTHER], staged: true });
  assert.equal(resDiff.ok, true, `staged diff 应成功: ${JSON.stringify(resDiff)}`);
  const decisions = {};
  for (const file of resDiff.data.files) {
    for (const hunk of file.hunks) decisions[keyOf(file.path, hunk)] = 'accept';
  }

  const res = await callCommitReview({ decisions, message: 'review: deletion + edit' });
  assert.equal(res.ok, true, `混合删除提交应成功: ${JSON.stringify(res)}`);

  let gone = false;
  try { repo.git(['show', `HEAD:${TARGET}`]); } catch { gone = true; }
  assert.ok(gone, 'HEAD 应无被删文件');
  assert.equal(repo.git(['show', `HEAD:${OTHER}`]), 'other changed\n', 'HEAD 应含其他文件修改');
});
