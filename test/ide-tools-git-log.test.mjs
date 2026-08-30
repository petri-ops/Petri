// test/ide-tools-git-log.test.mjs
// Phase 3 git tool: ide_git_log
//
// Run: node --test test/ide-tools-git-log.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IDE_TOOLS = resolve(__dirname, '..', 'core/biof3-server/mcp/ide-tools');

const ideTools = await import(
  pathToFileURL(resolve(IDE_TOOLS, 'index.js')).href
);
const { _rawHandlers } = ideTools;
const H = _rawHandlers;

function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'Tester',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'Tester',
    GIT_COMMITTER_EMAIL: 't@example.com',
    HOME: os.homedir(),
  };
}

const SPAWN_OPTS = { encoding: 'utf8' };

/**
 * 创建一个 git 仓库，含 3 次 commit（不同文件，方便 file 过滤）。
 * 返回 { repo, commits: [sha1, sha2, sha3] }，commits[0] == HEAD。
 */
function makeRepoWithCommits() {
  const repo = fs.mkdtempSync(`${os.tmpdir()}/biof3-ide-git-log-`);
  const env = gitEnv();
  spawnSync('git', ['init', '-q', '-b', 'main', repo], { env });
  // commit 1
  fs.writeFileSync(`${repo}/a.txt`, 'A\n', 'utf8');
  spawnSync('git', ['-C', repo, 'add', 'a.txt'], { env });
  spawnSync('git', ['-C', repo, 'commit', '-q', '-m', 'first commit on a.txt'], { env });
  const sha1 = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { env, ...SPAWN_OPTS }).stdout.trim();
  // commit 2
  fs.writeFileSync(`${repo}/b.txt`, 'B\n', 'utf8');
  spawnSync('git', ['-C', repo, 'add', 'b.txt'], { env });
  spawnSync('git', ['-C', repo, 'commit', '-q', '-m', 'second commit on b.txt'], { env });
  const sha2 = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { env, ...SPAWN_OPTS }).stdout.trim();
  // commit 3
  fs.writeFileSync(`${repo}/a.txt`, 'A\nA-edit\n', 'utf8');
  spawnSync('git', ['-C', repo, 'add', 'a.txt'], { env });
  spawnSync('git', ['-C', repo, 'commit', '-q', '-m', 'third commit on a.txt'], { env });
  const sha3 = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { env, ...SPAWN_OPTS }).stdout.trim();
  return { repo, commits: [sha1, sha2, sha3] };
}

function cleanup(repo) {
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch (_e) { /* ignore */ }
}

test('ide_git_log returns newest-first commits with parsed fields', () => {
  const { repo, commits } = makeRepoWithCommits();
  try {
    const res = H.ide_git_log({ path: repo });
    assert.equal(res.ok, true, `log failed: ${res.error}`);
    assert.equal(res.count, 3);
    assert.equal(res.truncated, false);
    // git log 默认 newest-first；commits[0] = 最新提交（=我们创建的 sha3）
    assert.equal(res.commits[0].sha, commits[2]);
    assert.equal(res.commits[1].sha, commits[1]);
    assert.equal(res.commits[2].sha, commits[0]);
    // 字段完整性
    for (const c of res.commits) {
      assert.equal(typeof c.sha, 'string');
      assert.match(c.sha, /^[0-9a-f]{40}$/);
      assert.equal(typeof c.shortSha, 'string');
      assert.ok(c.shortSha.length >= 7);
      assert.equal(c.author, 'Tester');
      assert.match(c.isoDate, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(typeof c.subject, 'string');
      assert.ok(c.subject.length > 0);
    }
    // subject 正确（newest-first）
    assert.match(res.commits[0].subject, /third commit on a\.txt/);
    assert.match(res.commits[1].subject, /second commit on b\.txt/);
    assert.match(res.commits[2].subject, /first commit on a\.txt/);
  } finally {
    cleanup(repo);
  }
});

test('ide_git_log with file filter limits to commits touching that file', () => {
  const { repo, commits } = makeRepoWithCommits();
  try {
    const res = H.ide_git_log({ path: repo, file: 'a.txt' });
    assert.equal(res.ok, true);
    // a.txt 出现在 commit 1 和 commit 3（commit 2 只改 b.txt）
    assert.equal(res.count, 2);
    const shas = res.commits.map((c) => c.sha);
    assert.ok(shas.includes(commits[0]));
    assert.ok(shas.includes(commits[2]));
    assert.ok(!shas.includes(commits[1]));
  } finally {
    cleanup(repo);
  }
});

test('ide_git_log rejects path outside allowlist', () => {
  const res = H.ide_git_log({ path: '/etc' });
  assert.equal(res.ok, false);
  assert.match(res.error, /allowlist|safe|resolve under/);
});

test('ide_git_log rejects non-git repository', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-ide-nogit-`);
  try {
    const res = H.ide_git_log({ path: tmp });
    assert.equal(res.ok, false);
    assert.match(res.error, /not a git repository/);
  } finally {
    cleanup(tmp);
  }
});

test('ide_git_log limit hard cap clamps to 200 and reports truncated', () => {
  const repo = fs.mkdtempSync(`${os.tmpdir()}/biof3-ide-git-log-cap-`);
  try {
    const env = gitEnv();
    const spawn = (args) => spawnSync('git', args, { env, ...SPAWN_OPTS });
    spawn(['init', '-q', '-b', 'main', repo]);
    // 直接用 git commit-tree 制造 250 个空 commit（最快）
    const tree = spawn(['-C', repo, 'mktree']).stdout.trim();
    const parents = [];
    for (let i = 0; i < 250; i++) {
      const args = ['-C', repo, 'commit-tree', tree, '-m', `commit ${i}`];
      if (parents.length) args.push('-p', parents[parents.length - 1]);
      const sha = spawn(args).stdout.trim();
      parents.push(sha);
    }
    // 将 HEAD 指向最后 commit
    spawn(['-C', repo, 'update-ref', 'HEAD', parents[parents.length - 1]]);

    const res = H.ide_git_log({ path: repo, limit: 500 });
    assert.equal(res.ok, true);
    assert.equal(res.count, 200, `expected 200 (hard cap), got ${res.count}`);
    assert.equal(res.truncated, true);

    // 200 之内：limit=50 → 应返回 50，truncated=false（实际还有更多，但未要求看更多）
    const small = H.ide_git_log({ path: repo, limit: 50 });
    assert.equal(small.ok, true);
    assert.equal(small.count, 50);
    assert.equal(small.truncated, false);
  } finally {
    cleanup(repo);
  }
});
