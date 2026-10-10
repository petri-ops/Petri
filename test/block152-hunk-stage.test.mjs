/**
 * BLOCK-152 H 轨 — commitReview hunk 级 stage 根修复（红绿行为测）
 *
 * 根修复语义（docs/block-152-refactor-candidates-plan.md §2/§6）：
 *   - 全 hunk accept 文件 = 整文件 git add（现状保绿）
 *   - 混合（有 accept 有 reject/未决）= 仅含 accept hunk 的 per-hunk patch 经
 *     git apply --cached 精确入隔离 index，工作树不动
 *   - 全 reject/未决 = 不 stage（治本；前端 BLOCK-147 拦截保留为第二道防线）
 *   - git apply 失败 = fail-closed 结构化错误（列文件与原因），不静默整文件降级
 *
 * 断言纪律（plan §6）：断言 index 内容（git show :path）而非仅退出码，
 * 防 hunk 上下文行取舍错位导致 index 与工作树静默分叉。
 *
 * 工区沿用 test/working-tree-review-hunk-apply.test.mjs 的
 * 临时仓（os.tmpdir）+ electron mock 走真实 handler 的路径策略。
 * 决策键用前端 reviewModeHelpers.ts hunkSignature 同算法独立复算（跨端 parity 锁）。
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

// ---------------------------------------------------------------------------
// 基线夹具：24 行文件；改动 l3 / l11 / EOF 追加 → 3 个互不合并的 hunk
// （改动点间隔 > 2×3 上下文行，git 必然切分）
// ---------------------------------------------------------------------------
const LINES = Array.from({ length: 24 }, (_, i) => `line ${i + 1}`);
const HEAD_BODY = LINES.join('\n') + '\n';

const withLineReplaced = (idx, replacement) => {
  const next = [...LINES];
  next[idx] = replacement;
  return next.join('\n') + '\n';
};
const HEAD_WITH_L3_ONLY = withLineReplaced(2, 'CHANGED line 3');
// 组合：l3 改 + l11 改 + EOF 追加（三个 hunk 全量）
const WORK_MODIFIED = (() => {
  const lines = LINES.map((l, i) => (i === 2 ? 'CHANGED line 3' : i === 10 ? 'CHANGED line 11' : l));
  return lines.join('\n') + '\nline 25 appended\n';
})();
// h2（l11）被 reject 回退后：仅剩 h1 + h3
const WORK_AFTER_REJECT_H2 = (() => {
  const lines = LINES.map((l, i) => (i === 2 ? 'CHANGED line 3' : l));
  return lines.join('\n') + '\nline 25 appended\n';
})();

const TARGET = 'multi-hunk.txt';

// ---------------------------------------------------------------------------
// electron mock（必须在 require 目标模块前注入；app 指针可按测试切换仓库）
// ---------------------------------------------------------------------------
const handlers = new Map();
const fakeIpcMain = { handle: (name, fn) => handlers.set(name, fn) };
let currentRepo = null; // { repoDir, userDataDir }
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
const callHunkApply = (args) => handlers.get('git:hunk-apply')(fakeEvent, args);
const callCommitReview = (args) => handlers.get('git:commit-review')(fakeEvent, args);

// ---------------------------------------------------------------------------
// 临时仓 + 决策键复算（前端 reviewModeHelpers.ts:30-45 同算法独立副本）
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
const indexContent = (repo, filePath) => repo.git(['show', `:${filePath}`]);
const headSha = (repo) => repo.git(['rev-parse', 'HEAD']).trim();

async function getHunks(repo, filePath = TARGET) {
  const res = await callDiff({ paths: [filePath] });
  assert.equal(res.ok, true, `diff 应成功: ${JSON.stringify(res)}`);
  const file = res.data.files.find((f) => f.path === filePath);
  assert.ok(file, `${filePath} 应出现在 diff 中`);
  return file.hunks;
}

// ---------------------------------------------------------------------------
// 场景 1（核心红）：混合 accept/未决 → index 只含 accept hunk，工作树不动
// ---------------------------------------------------------------------------
test('BLOCK-152 H: 混合 accept/未决 → git show :path 只含 accept hunk，工作树不动', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b152-hunk-mixed-');
  fs.writeFileSync(path.join(repo.repoDir, TARGET), WORK_MODIFIED);

  const hunks = await getHunks(repo);
  assert.equal(hunks.length, 3, '夹具应产出 3 个 hunk');

  const res = await callCommitReview({
    decisions: { [keyOf(TARGET, hunks[0])]: 'accept' },
    message: 'review: partial accept',
  });
  assert.equal(res.ok, true, `commitReview 应成功: ${JSON.stringify(res)}`);

  assert.equal(indexContent(repo, TARGET), HEAD_WITH_L3_ONLY,
    'index 应恰好是 HEAD+accept hunk1（不含未决 hunk2/h3 的改动）');
  assert.equal(readTarget(repo), WORK_MODIFIED, '工作树必须保持不动（未决改动留在工作区）');
});

// ---------------------------------------------------------------------------
// 场景 2（保绿）：全 hunk accept → 整文件 stage，提交后文件干净
// ---------------------------------------------------------------------------
test('BLOCK-152 H: 全 hunk accept → 整文件 stage（现状保绿），提交后干净', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b152-hunk-whole-');
  fs.writeFileSync(path.join(repo.repoDir, TARGET), WORK_MODIFIED);

  const hunks = await getHunks(repo);
  const decisions = {};
  for (const hunk of hunks) decisions[keyOf(TARGET, hunk)] = 'accept';

  const res = await callCommitReview({ decisions, message: 'review: accept all' });
  assert.equal(res.ok, true, `commitReview 应成功: ${JSON.stringify(res)}`);

  assert.equal(indexContent(repo, TARGET), WORK_MODIFIED, 'index 应含全部改动');
  assert.equal(readTarget(repo), WORK_MODIFIED);
  const dirty = repo.git(['status', '--porcelain', '--', TARGET]);
  assert.equal(dirty, '', '全 accept 提交后该文件应干净');
});

// ---------------------------------------------------------------------------
// 场景 3（回归）：reject 已回退工作树后提交 → 提交含且仅含幸存 hunk（BLOCK-16 reject 链回归）
// ---------------------------------------------------------------------------
test('BLOCK-152 H: reject 回退后 commitReview → 提交含且仅含幸存 hunk', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b152-hunk-reject-');
  fs.writeFileSync(path.join(repo.repoDir, TARGET), WORK_MODIFIED);

  const hunks = await getHunks(repo);
  const rej = await callHunkApply({
    file: TARGET, hunkIndex: 1, action: 'reject', hunk: hunks[1],
  });
  assert.equal(rej.ok, true, `reject 应成功: ${JSON.stringify(rej)}`);
  assert.equal(readTarget(repo), WORK_AFTER_REJECT_H2, 'reject 应把 h2 从工作树回退');

  const res = await callCommitReview({
    decisions: { [keyOf(TARGET, hunks[0])]: 'accept', [keyOf(TARGET, hunks[2])]: 'accept' },
    message: 'review: accept surviving hunks',
  });
  assert.equal(res.ok, true, `commitReview 应成功: ${JSON.stringify(res)}`);
  assert.equal(indexContent(repo, TARGET), WORK_AFTER_REJECT_H2, '提交应含且仅含幸存改动');
  assert.equal(repo.git(['status', '--porcelain', '--', TARGET]), '', 'reject 链收口后文件干净');
});

// ---------------------------------------------------------------------------
// 场景 4：git apply 失败 → fail-closed 结构化错误，HEAD 不动，临时 index 清理
// ---------------------------------------------------------------------------
test('BLOCK-152 H: patch 不可应用 → review_patch_apply_failed 结构化错误且不产生提交', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b152-hunk-applyfail-');
  const { createGitAdapter } = require('../core/shared-backend/git-adapter');
  const adapter = createGitAdapter({
    gitDir: path.join(repo.repoDir, '.git'),
    workTree: repo.repoDir,
  });

  const before = headSha(repo);
  const bogus = [
    'diff --git a/missing-pre.txt b/missing-pre.txt',
    '--- a/missing-pre.txt',
    '+++ b/missing-pre.txt',
    '@@ -1,2 +1,2 @@',
    ' no such context line',
    '-no such deleted line',
    '+patched line',
    '',
  ].join('\n');

  assert.throws(
    () => adapter.commitFromIsolatedIndex({
      message: 'should fail',
      stagePaths: [],
      patches: [{ path: 'missing-pre.txt', patch: bogus }],
    }),
    (error) => {
      assert.equal(error.code, 'review_patch_apply_failed');
      assert.ok(Array.isArray(error.detail?.failures), 'detail.failures 应为结构化数组');
      assert.equal(error.detail.failures[0].path, 'missing-pre.txt');
      assert.ok(error.detail.failures[0].stderr, 'failure 应携带 git stderr');
      return true;
    },
    'apply 失败必须 fail-closed 抛结构化错误'
  );

  assert.equal(headSha(repo), before, 'apply 失败不得移动 HEAD（不产生提交）');
  const leftovers = fs.readdirSync(path.join(repo.repoDir, '.git'))
    .filter((n) => n.startsWith('petri-review-index'));
  assert.equal(leftovers.length, 0, '临时 index 必须清理');
});

// ---------------------------------------------------------------------------
// 场景 5（治本语义）：失效/未决-only 的 accept 键 → no_files_to_commit，不整文件降级
// ---------------------------------------------------------------------------
test('BLOCK-152 H: 仅失效 accept 键 → no_files_to_commit，不把整文件带进提交', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b152-hunk-stale-');
  fs.writeFileSync(path.join(repo.repoDir, TARGET), WORK_MODIFIED);

  const before = headSha(repo);
  const res = await callCommitReview({
    decisions: { [`${TARGET}#h9999-stalekey`]: 'accept' },
    message: 'review: stale key only',
  });
  assert.equal(res.ok, false, '失效键不得提交任何内容');
  assert.equal(res.error, 'no_files_to_commit');
  assert.equal(headSha(repo), before, 'HEAD 不得移动');
  assert.equal(readTarget(repo), WORK_MODIFIED, '工作树不动');
  assert.equal(indexContent(repo, TARGET), HEAD_BODY,
    'index 应保持 HEAD 版本（tracked 文件本就在 index，改动面不得入 index）');
});

// ---------------------------------------------------------------------------
// 场景 6：多文件混合（A 全 accept + B 部分 accept）→ 单提交精确含两面
// ---------------------------------------------------------------------------
test('BLOCK-152 H: 多文件 A 整文件 + B 部分 hunk → 单提交各取其面', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b152-hunk-multifile-');
  const FILE_A = 'whole-accept.txt';
  const FILE_B = 'mixed-file.txt';
  const HEAD_A = Array.from({ length: 10 }, (_, i) => `alpha ${i + 1}`).join('\n') + '\n';
  const WORK_A = HEAD_A.replace('alpha 4', 'alpha 4 patched') + 'alpha 11 appended\n';
  const WORK_B = WORK_MODIFIED;

  fs.writeFileSync(path.join(repo.repoDir, TARGET), HEAD_BODY);
  fs.writeFileSync(path.join(repo.repoDir, FILE_A), HEAD_A);
  fs.writeFileSync(path.join(repo.repoDir, FILE_B), HEAD_BODY);
  repo.git(['add', '-A']);
  repo.git(['commit', '-qm', 'two files']);

  fs.writeFileSync(path.join(repo.repoDir, FILE_A), WORK_A);
  fs.writeFileSync(path.join(repo.repoDir, FILE_B), WORK_B);

  const hunksA = await getHunks(repo, FILE_A);
  const hunksB = await getHunks(repo, FILE_B);
  const res = await callCommitReview({
    decisions: {
      [keyOf(FILE_A, hunksA[0])]: 'accept',
      [keyOf(FILE_B, hunksB[0])]: 'accept',
    },
    message: 'review: one whole + one partial',
  });
  assert.equal(res.ok, true, `commitReview 应成功: ${JSON.stringify(res)}`);
  assert.deepEqual([...res.data.files].sort(), [FILE_A, FILE_B].sort(), 'files 应列出两文件');

  assert.equal(indexContent(repo, FILE_A), WORK_A, 'A 整文件入 index');
  assert.equal(indexContent(repo, FILE_B), HEAD_WITH_L3_ONLY, 'B 仅 accept hunk 入 index');
  assert.equal(fs.readFileSync(path.join(repo.repoDir, FILE_A), 'utf-8'), WORK_A, 'A 工作树不动');
  assert.equal(fs.readFileSync(path.join(repo.repoDir, FILE_B), 'utf-8'), WORK_B, 'B 工作树不动');
});

// ---------------------------------------------------------------------------
// 场景 7：丢弃前序纯新增 hunk 后，后继 hunk 的 post-image 起始行必须重算
// （plan §6：hunk 上下文行取舍错一行 = index 与工作树静默分叉 → 以 index 内容断言兜住）
// ---------------------------------------------------------------------------
test('BLOCK-152 H: 丢弃前序纯新增 hunk → 后继 hunk post-image 起始行重算，index 内容仍精确', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b152-hunk-offset-');
  const FILE_C = 'insert-then-change.txt';
  const headC = Array.from({ length: 22 }, (_, i) => `c ${i + 1}`).join('\n') + '\n';
  // hunkA：l3 后插入两行（纯新增 Δ=+2）；hunkB：改 l15（与插入点相距 > 2×ctx → 独立 hunk）
  const workC = (() => {
    const lines = [...headC.trimEnd().split('\n')];
    lines.splice(3, 0, 'ins A1', 'ins A2');
    const idx15 = lines.indexOf('c 15');
    lines[idx15] = 'c 15 patched';
    return lines.join('\n') + '\n';
  })();

  fs.writeFileSync(path.join(repo.repoDir, TARGET), HEAD_BODY);
  fs.writeFileSync(path.join(repo.repoDir, FILE_C), headC);
  repo.git(['add', '-A']);
  repo.git(['commit', '-qm', 'file c']);

  fs.writeFileSync(path.join(repo.repoDir, FILE_C), workC);
  const hunksC = await getHunks(repo, FILE_C);
  assert.equal(hunksC.length, 2, '夹具应产出 2 个 hunk');

  // 只 accept 后继 hunkB（l15 改动）；前序纯新增 hunkA 丢弃
  const res = await callCommitReview({
    decisions: { [keyOf(FILE_C, hunksC[1])]: 'accept' },
    message: 'review: second hunk only',
  });
  assert.equal(res.ok, true, `commitReview 应成功: ${JSON.stringify(res)}`);

  const expectedIndex = headC.replace('c 15', 'c 15 patched');
  assert.equal(indexContent(repo, FILE_C), expectedIndex,
    'index 应恰好是 HEAD+l15 改动（插入行不入 index，行号漂移不得静默分叉）');
  assert.equal(fs.readFileSync(path.join(repo.repoDir, FILE_C), 'utf-8'), workC, '工作树不动');
});

// ---------------------------------------------------------------------------
// 场景 8（BLOCK-152 P1 红测）：staged rename（porcelain `R old -> new`）全 hunk accept
// → 提交树只含 new 侧，old 侧不得以旧内容复活，真实 index 不得残留删除侧。
// 病灶链：parsePorcelainZ 把 R 条目解析为单条目 path=new 侧 → 面板 changedPaths
// 只有 new 侧 → diff pathspec 破坏 rename 配对呈 new file 单 hunk 形态 → 全 accept
// 落 wholeFiles → 隔离 index 自 read-tree HEAD 出发只 add new 侧，old 侧的删除
// 永远进不了提交树（rename 半套提交）。
// ---------------------------------------------------------------------------
test('BLOCK-152 H/P1: staged rename 全 accept → 提交树只含 new 侧，old 不复活，真实 index 干净', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b152-hunk-rename-');
  const OLD_F = 'old-name.txt';
  const NEW_F = 'new-name.txt';
  fs.writeFileSync(path.join(repo.repoDir, OLD_F), HEAD_BODY);
  repo.git(['add', '-A']);
  repo.git(['commit', '-qm', 'with old-name']);

  repo.git(['mv', OLD_F, NEW_F]);
  fs.writeFileSync(path.join(repo.repoDir, NEW_F), WORK_MODIFIED);
  repo.git(['add', '--', NEW_F]);
  assert.ok(
    repo.git(['status', '--porcelain', '-z']).startsWith(`R  ${NEW_F}\0${OLD_F}\0`),
    '夹具应为 staged rename（porcelain `R new\\0old`）'
  );

  const hunks = await getHunks(repo, NEW_F);
  assert.equal(hunks.length, 1, 'pathspec 破坏 rename 配对后应呈 new file 单 hunk 形态');
  const res = await callCommitReview({
    decisions: { [keyOf(NEW_F, hunks[0])]: 'accept' },
    message: 'review: staged rename accept',
  });
  assert.equal(res.ok, true, `commitReview 应成功: ${JSON.stringify(res)}`);
  assert.deepEqual(res.data.files, [NEW_F], 'files 应只列 new 侧');

  const treePaths = repo.git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean).sort();
  assert.deepEqual(
    treePaths,
    [TARGET, NEW_F].sort(),
    '提交树只应含 new 侧（old 侧不得以旧内容复活进提交）'
  );
  assert.equal(repo.git(['status', '--porcelain']), '', '提交后真实 index/工作树应干净（无残留删除侧）');
});

// ---------------------------------------------------------------------------
// 场景 9（BLOCK-152 P1 组合面）：staged rename 整文件 accept + 他文件部分 hunk accept
// → 单提交各取其面，且 rename 删除侧照样离开提交树、不殃及他文件内容。
// ---------------------------------------------------------------------------
test('BLOCK-152 H/P1: staged rename 整文件 + 他文件部分 hunk → 单提交各取其面且 old 不复活', async (t) => {
  const repo = makeReviewRepo(t, 'petri-b152-hunk-rename-mix-');
  const OLD_F = 'old-name.txt';
  const NEW_F = 'new-name.txt';
  const FILE_B = 'mixed-file.txt';
  fs.writeFileSync(path.join(repo.repoDir, OLD_F), HEAD_BODY);
  fs.writeFileSync(path.join(repo.repoDir, FILE_B), HEAD_BODY);
  repo.git(['add', '-A']);
  repo.git(['commit', '-qm', 'rename base + file b']);

  repo.git(['mv', OLD_F, NEW_F]);
  fs.writeFileSync(path.join(repo.repoDir, NEW_F), WORK_MODIFIED);
  repo.git(['add', '--', NEW_F]);
  // B 未暂存 → 面板呈 3 hunk 审阅面，只 accept hunk1
  fs.writeFileSync(path.join(repo.repoDir, FILE_B), WORK_MODIFIED);

  const hunksNew = await getHunks(repo, NEW_F);
  const hunksB = await getHunks(repo, FILE_B);
  assert.equal(hunksNew.length, 1, 'rename 侧应呈 new file 单 hunk 形态');
  assert.equal(hunksB.length, 3, 'B 夹具应产出 3 个 hunk');

  const res = await callCommitReview({
    decisions: {
      [keyOf(NEW_F, hunksNew[0])]: 'accept',
      [keyOf(FILE_B, hunksB[0])]: 'accept',
    },
    message: 'review: rename whole + partial file',
  });
  assert.equal(res.ok, true, `commitReview 应成功: ${JSON.stringify(res)}`);
  assert.deepEqual([...res.data.files].sort(), [NEW_F, FILE_B].sort(), 'files 应列 new 侧与 B');

  const treePaths = repo.git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean).sort();
  assert.deepEqual(
    treePaths,
    [TARGET, NEW_F, FILE_B].sort(),
    '提交树应含 new 侧与 B，old 侧不得复活'
  );
  assert.equal(indexContent(repo, FILE_B), HEAD_WITH_L3_ONLY, 'B index 应只含 accept hunk');
  assert.equal(readTarget(repo), HEAD_BODY, '未审文件工作树不动');
  assert.equal(
    repo.git(['status', '--porcelain']).replace(/\r?\n$/, ''),
    ' M mixed-file.txt',
    'B 未决 hunk 以未暂存形态留在工作树，rename 侧不得有残留'
  );
});
