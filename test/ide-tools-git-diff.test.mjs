// test/ide-tools-git-diff.test.mjs
// Phase 3 git tool: ide_git_diff
//
// Run: node --test test/ide-tools-git-diff.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IDE_TOOLS = resolve(__dirname, '..', 'core/r-server/mcp/ide-tools');

const ideTools = await import(
  pathToFileURL(resolve(IDE_TOOLS, 'index.js')).href
);
const { _rawHandlers } = ideTools;
const H = _rawHandlers;

/**
 * 创建一个 git 仓库并返回 cwd 相对的路径（确保在白名单 cwd 内）。
 * 仓库内有 1 次 commit（add file + commit），随后修改这个文件让工作区脏。
 */
function makeGitRepo() {
  const repo = fs.mkdtempSync(`${os.tmpdir()}/biof3-ide-git-diff-`);
  // 默认 git 环境，避免 home dir 干扰
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Tester',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'Tester',
    GIT_COMMITTER_EMAIL: 't@example.com',
    HOME: os.homedir(),
  };
  spawnSync('git', ['init', '-q', '-b', 'main', repo], { env });
  fs.writeFileSync(`${repo}/hello.txt`, 'one\ntwo\nthree\n', 'utf8');
  spawnSync('git', ['-C', repo, 'add', 'hello.txt'], { env });
  spawnSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'], { env });
  // 之后对 hello.txt 做修改，让工作区有 diff
  fs.writeFileSync(`${repo}/hello.txt`, 'one\nTWO\nthree\nfour\n', 'utf8');
  spawnSync('git', ['-C', repo, 'add', 'hello.txt'], { env });
  // 暂存区现在有 staged diff；再把工作区再改一下 → unstaged diff
  fs.writeFileSync(`${repo}/hello.txt`, 'one\nTWO\nthree\nfour\nfive\n', 'utf8');
  return repo;
}

function cleanup(repo) {
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch (_e) { /* ignore */ }
}

test('ide_git_diff parses fixture diff into structured hunks (unstaged)', () => {
  const repo = makeGitRepo();
  try {
    const res = H.ide_git_diff({ path: repo });
    assert.equal(res.ok, true, `diff failed: ${res.error}`);
    assert.ok(Array.isArray(res.hunks));
    assert.ok(res.hunks.length >= 1, 'should have at least one hunk');
    // 工作区最后一行是 'five'（新增）
    const types = res.hunks.map((h) => h.type);
    // add 类型出现
    assert.ok(types.includes('add'), `expected at least one add hunk, got ${types.join(',')}`);
    // summary 正确增加 1 行
    assert.equal(res.summary.added, 1);
    assert.equal(res.summary.removed, 0);
    assert.equal(res.truncated, false);
  } finally {
    cleanup(repo);
  }
});

test('ide_git_diff with staged=true shows staged changes', () => {
  const repo = makeGitRepo();
  try {
    const res = H.ide_git_diff({ path: repo, staged: true });
    assert.equal(res.ok, true, `staged diff failed: ${res.error}`);
    assert.ok(Array.isArray(res.hunks));
    // 暂存区：one / TWO / three / four（four 是新增）
    assert.ok(res.hunks.length >= 1);
    assert.ok(res.summary.added >= 1, `expected added>=1 (staged 'four'), got ${res.summary.added}`);
    // 之所以 added 也 >=1：unstaged 改动是 'five' 这行（1 个新增），staged 是 'four' 之前的 T→TWO + 'four' 新增
    assert.ok(res.summary.removed >= 1, `expected removed>=1 (staged 'two'→'TWO'), got ${res.summary.removed}`);
  } finally {
    cleanup(repo);
  }
});

test('ide_git_diff rejects path outside allowlist', () => {
  const res = H.ide_git_diff({ path: '/etc' });
  assert.equal(res.ok, false);
  assert.match(res.error, /allowlist|safe|resolve under/);
});

test('ide_git_diff rejects non-git repository', () => {
  // 纯目录不是 git 仓库
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-ide-nogit-`);
  try {
    const res = H.ide_git_diff({ path: tmp });
    assert.equal(res.ok, false);
    assert.match(res.error, /not a git repository/);
  } finally {
    cleanup(tmp);
  }
});

test('ide_git_diff respects maxLines hard cap', () => {
  const repo = fs.mkdtempSync(`${os.tmpdir()}/biof3-ide-git-diff-cap-`);
  try {
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@e.com',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@e.com',
      HOME: os.homedir(),
    };
    spawnSync('git', ['init', '-q', '-b', 'main', repo], { env });
    fs.writeFileSync(`${repo}/big.txt`, 'line0\n', 'utf8');
    spawnSync('git', ['-C', repo, 'add', 'big.txt'], { env });
    spawnSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'], { env });
    // 构造大量新增行
    const lines = [];
    for (let i = 0; i < 500; i++) lines.push(`new line ${i}`);
    fs.writeFileSync(`${repo}/big.txt`, 'line0\n' + lines.join('\n') + '\n', 'utf8');

    const small = H.ide_git_diff({ path: repo, maxLines: 10 });
    assert.equal(small.ok, true);
    assert.equal(small.truncated, true);
    let total = 0;
    for (const h of small.hunks) total += h.lines.length;
    assert.ok(total <= 10, `total=${total} must be <= 10`);
    assert.ok(total > 0, 'should return at least some lines');

    // 20000 → hard cap 5000
    const huge = H.ide_git_diff({ path: repo, maxLines: 20000 });
    assert.equal(huge.ok, true);
    let hugeTotal = 0;
    for (const h of huge.hunks) hugeTotal += h.lines.length;
    assert.ok(hugeTotal <= 5000, `hard cap: hugeTotal=${hugeTotal} must be <= 5000`);
  } finally {
    cleanup(repo);
  }
});
