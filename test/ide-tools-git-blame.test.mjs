// test/ide-tools-git-blame.test.mjs
// Phase 3 git tool: ide_git_blame
//
// Run: node --test test/ide-tools-git-blame.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IDE_TOOLS = resolve(__dirname, '..', 'core/petri-server/mcp/ide-tools');

const ideTools = await import(
  pathToFileURL(resolve(IDE_TOOLS, 'index.js')).href
);
const { _rawHandlers } = ideTools;
const H = _rawHandlers;

function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'BlameAuthor',
    GIT_AUTHOR_EMAIL: 'b@example.com',
    GIT_COMMITTER_NAME: 'BlameAuthor',
    GIT_COMMITTER_EMAIL: 'b@example.com',
    HOME: os.homedir(),
  };
}

const SPAWN_OPTS = { encoding: 'utf8' };

function makeRepo() {
  const repo = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-git-blame-`);
  const env = gitEnv();
  const spawn = (args) => spawnSync('git', args, { env, ...SPAWN_OPTS });
  spawn(['init', '-q', '-b', 'main', repo]);
  // commit 1：3 行
  fs.writeFileSync(`${repo}/story.txt`, 'alpha\nbeta\ngamma\n', 'utf8');
  spawn(['-C', repo, 'add', 'story.txt']);
  spawn(['-C', repo, 'commit', '-q', '-m', 'first commit']);
  const sha1 = spawn(['-C', repo, 'rev-parse', 'HEAD']).stdout.trim();
  // commit 2：改正 beta → BETA + 在末尾加 delta
  fs.writeFileSync(`${repo}/story.txt`, 'alpha\nBETA\ngamma\ndelta\n', 'utf8');
  spawn(['-C', repo, 'add', 'story.txt']);
  spawn(['-C', repo, 'commit', '-q', '-m', 'second commit']);
  const sha2 = spawn(['-C', repo, 'rev-parse', 'HEAD']).stdout.trim();
  return { repo, sha1, sha2 };
}

function cleanup(repo) {
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch { /* ignore */ }
}

test('ide_git_blame parses per-line attribution across commits', () => {
  const { repo, sha1, sha2 } = makeRepo();
  try {
    const res = H.ide_git_blame({ path: repo, file: 'story.txt' });
    assert.equal(res.ok, true, `blame failed: ${res.error}`);
    assert.equal(res.file, 'story.txt');
    // 4 行 → 4 条 blame
    assert.equal(res.count, 4);
    assert.equal(res.blame.length, 4);
    // lineNumber 严格 1..4
    assert.equal(res.blame[0].lineNumber, 1);
    assert.equal(res.blame[1].lineNumber, 2);
    assert.equal(res.blame[2].lineNumber, 3);
    assert.equal(res.blame[3].lineNumber, 4);
    // 每条字段完整性
    for (const entry of res.blame) {
      assert.match(entry.sha, /^[0-9a-f]{40}$/);
      assert.equal(entry.shortSha, entry.sha.slice(0, 7));
      assert.equal(entry.author, 'BlameAuthor');
      assert.match(entry.isoDate, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(typeof entry.content, 'string');
      assert.ok(entry.content.length > 0);
    }
    // 第 1 行（alpha）和第 3 行（gamma）来自 commit 1
    assert.equal(res.blame[0].sha, sha1);
    assert.equal(res.blame[2].sha, sha1);
    // 第 2 行（BETA）和第 4 行（delta）来自 commit 2
    assert.equal(res.blame[1].sha, sha2);
    assert.equal(res.blame[3].sha, sha2);
    // 内容正确
    assert.equal(res.blame[0].content, 'alpha');
    assert.equal(res.blame[1].content, 'BETA');
    assert.equal(res.blame[2].content, 'gamma');
    assert.equal(res.blame[3].content, 'delta');
  } finally {
    cleanup(repo);
  }
});

test('ide_git_blame respects startLine / endLine range', () => {
  const { repo, sha1, sha2 } = makeRepo();
  try {
    const res = H.ide_git_blame({ path: repo, file: 'story.txt', startLine: 2, endLine: 3 });
    assert.equal(res.ok, true);
    assert.equal(res.count, 2);
    assert.equal(res.blame[0].lineNumber, 2);
    assert.equal(res.blame[1].lineNumber, 3);
    assert.equal(res.blame[0].sha, sha2); // BETA
    assert.equal(res.blame[1].sha, sha1); // gamma
  } finally {
    cleanup(repo);
  }
});

test('ide_git_blame rejects untracked file', () => {
  const repo = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-git-blame-unt-`);
  try {
    const env = gitEnv();
    spawnSync('git', ['init', '-q', '-b', 'main', repo], { env });
    fs.writeFileSync(`${repo}/untracked.txt`, 'fresh\n', 'utf8');
    // 还未 git add
    const res = H.ide_git_blame({ path: repo, file: 'untracked.txt' });
    assert.equal(res.ok, false);
    assert.match(res.error, /not tracked by git/);
  } finally {
    cleanup(repo);
  }
});

test('ide_git_blame rejects path outside allowlist', () => {
  const res = H.ide_git_blame({ path: '/etc', file: 'whatever' });
  assert.equal(res.ok, false);
  assert.match(res.error, /allowlist|safe|resolve under/);
});

test('ide_git_blame rejects non-git repository', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/petri-ide-nogit-`);
  try {
    const res = H.ide_git_blame({ path: tmp, file: 'something' });
    assert.equal(res.ok, false);
    assert.match(res.error, /not a git repository/);
  } finally {
    cleanup(tmp);
  }
});

test('ide_git_blame rejects range over hard cap (10000 lines)', () => {
  const { repo } = makeRepo();
  try {
    const res = H.ide_git_blame({ path: repo, file: 'story.txt', startLine: 1, endLine: 20000 });
    assert.equal(res.ok, false);
    assert.match(res.error, /exceeds hard cap 10000/);
  } finally {
    cleanup(repo);
  }
});
