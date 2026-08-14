// test/ide-tools-git-show.test.mjs
// Phase 3 git tool: ide_git_show
//
// Run: node --test test/ide-tools-git-show.test.mjs

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

function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'ShowAuthor',
    GIT_AUTHOR_EMAIL: 's@example.com',
    GIT_COMMITTER_NAME: 'ShowAuthor',
    GIT_COMMITTER_EMAIL: 's@example.com',
    HOME: os.homedir(),
  };
}

const SPAWN_OPTS = { encoding: 'utf8' };

function makeRepo() {
  const repo = fs.mkdtempSync(`${os.tmpdir()}/biof3-ide-git-show-`);
  const env = gitEnv();
  const spawn = (args) => spawnSync('git', args, { env, ...SPAWN_OPTS });
  spawn(['init', '-q', '-b', 'main', repo]);
  // commit 1
  fs.writeFileSync(`${repo}/cmd.txt`, 'line1\nline2\n', 'utf8');
  spawn(['-C', repo, 'add', 'cmd.txt']);
  spawn(['-C', repo, 'commit', '-q', '-m', 'initial commit']);
  const sha1 = spawn(['-C', repo, 'rev-parse', 'HEAD']).stdout.trim();
  // commit 2：再 git config 一下 author 不变，仍来自 gitEnv
  fs.writeFileSync(`${repo}/cmd.txt`, 'line1\nLINE2\nline3\n', 'utf8');
  spawn(['-C', repo, 'add', 'cmd.txt']);
  spawn(['-C', repo, 'commit', '-q', '-m', 'second commit']);
  const sha2 = spawn(['-C', repo, 'rev-parse', 'HEAD']).stdout.trim();
  return { repo, sha1, sha2 };
}

function cleanup(repo) {
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch (_e) { /* ignore */ }
}

test('ide_git_show returns commit metadata + hunks for HEAD', () => {
  const { repo, sha2 } = makeRepo();
  try {
    const res = H.ide_git_show({ path: repo, commit: 'HEAD' });
    assert.equal(res.ok, true, `show failed: ${res.error}`);
    // commit metadata
    assert.equal(res.commit.sha, sha2);
    assert.match(res.commit.shortSha, /^[0-9a-f]{7,}$/);
    assert.equal(res.commit.author, 'ShowAuthor');
    assert.match(res.commit.isoDate, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(res.commit.subject, 'second commit');
    // hunks
    assert.ok(Array.isArray(res.hunks));
    assert.ok(res.hunks.length >= 1, 'should have at least one hunk');
    // 第二个 commit 改了 line2 → LINE2 + 加 line3，因此既有 remove 又有 add
    assert.ok(res.summary.added >= 1, `expected added>=1, got ${res.summary.added}`);
    assert.ok(res.summary.removed >= 1, `expected removed>=1, got ${res.summary.removed}`);
    assert.equal(res.truncated, false);
  } finally {
    cleanup(repo);
  }
});

test('ide_git_show accepts full SHA and short SHA', () => {
  const { repo, sha1, sha2 } = makeRepo();
  try {
    const full = H.ide_git_show({ path: repo, commit: sha1 });
    assert.equal(full.ok, true);
    assert.equal(full.commit.sha, sha1);
    assert.equal(full.commit.subject, 'initial commit');

    const short = H.ide_git_show({ path: repo, commit: sha2.slice(0, 7) });
    assert.equal(short.ok, true);
    assert.equal(short.commit.sha, sha2);
  } finally {
    cleanup(repo);
  }
});

test('ide_git_show rejects path outside allowlist', () => {
  const res = H.ide_git_show({ path: '/etc', commit: 'HEAD' });
  assert.equal(res.ok, false);
  assert.match(res.error, /allowlist|safe|resolve under/);
});

test('ide_git_show rejects non-git repository', () => {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/biof3-ide-nogit-`);
  try {
    const res = H.ide_git_show({ path: tmp, commit: 'HEAD' });
    assert.equal(res.ok, false);
    assert.match(res.error, /not a git repository/);
  } finally {
    cleanup(tmp);
  }
});

test('ide_git_show rejects invalid commit reference', () => {
  const { repo } = makeRepo();
  try {
    const res = H.ide_git_show({ path: repo, commit: 'definitely-not-a-real-ref-xyz' });
    assert.equal(res.ok, false);
    assert.match(res.error, /invalid commit reference/);
  } finally {
    cleanup(repo);
  }
});

test('ide_git_show respects maxLines hard cap', () => {
  const repo = fs.mkdtempSync(`${os.tmpdir()}/biof3-ide-git-show-cap-`);
  try {
    const env = gitEnv();
    spawnSync('git', ['init', '-q', '-b', 'main', repo], { env });
    fs.writeFileSync(`${repo}/f.txt`, 'a\n', 'utf8');
    spawnSync('git', ['-C', repo, 'add', 'f.txt'], { env });
    spawnSync('git', ['-C', repo, 'commit', '-q', '-m', 'first'], { env });
    // 构造一个有大量 +/- 行的 commit
    const lines = [];
    for (let i = 0; i < 800; i++) lines.push(`added line ${i}`);
    fs.writeFileSync(`${repo}/f.txt`, lines.join('\n') + '\n', 'utf8');
    spawnSync('git', ['-C', repo, 'add', 'f.txt'], { env });
    spawnSync('git', ['-C', repo, 'commit', '-q', '-m', 'bulk'], { env });

    const small = H.ide_git_show({ path: repo, commit: 'HEAD', maxLines: 30 });
    assert.equal(small.ok, true);
    assert.equal(small.truncated, true);
    let total = 0;
    for (const h of small.hunks) total += h.lines.length;
    assert.ok(total <= 30, `total=${total} must be <= 30`);

    const huge = H.ide_git_show({ path: repo, commit: 'HEAD', maxLines: 10000 });
    assert.equal(huge.ok, true);
    let hugeTotal = 0;
    for (const h of huge.hunks) hugeTotal += h.lines.length;
    assert.ok(hugeTotal <= 5000, `hard cap: hugeTotal=${hugeTotal} must be <= 5000`);
  } finally {
    cleanup(repo);
  }
});
