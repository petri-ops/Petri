import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import reviewGit from '../core/r-server/agent-review/review-git.js';
const { tokenizeCommand, isAllowedReviewCommand, execReviewCommand, readWorkspaceFile } = reviewGit;

let workspace;

before(() => {
  workspace = mkdtempSync(join(tmpdir(), 'biof3-review-git-'));
  writeFileSync(join(workspace, 'a.txt'), 'hello\nworld\n');
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  execFileSync('git', ['add', 'a.txt'], { cwd: workspace });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: workspace });
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

test('tokenizer rejects shell metacharacters and unterminated quotes', () => {
  assert.equal(tokenizeCommand('git status && rm -rf /'), null);
  assert.equal(tokenizeCommand('git log | tee /tmp/x'), null);
  assert.equal(tokenizeCommand('cat a > b'), null);
  assert.equal(tokenizeCommand('echo `id`'), null);
  assert.equal(tokenizeCommand('git commit -m "unterminated'), null);
  assert.equal(tokenizeCommand(''), null);
});

test('allowlist: git read subcommands pass, writes and config overrides fail', () => {
  assert.equal(isAllowedReviewCommand(tokenizeCommand('git status --short')), true);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('git diff HEAD')), true);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('git merge-base HEAD main')), true);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('git log --oneline -5')), true);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('git -c core.hooksPath=/x diff')), false);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('git commit -m x')), false);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('git push origin main')), false);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('git reset --hard')), false);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('rm -rf /')), false);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('curl http://evil')), false);
});

test('allowlist: read tools pass, per-tool write/execute flags are denied', () => {
  assert.equal(isAllowedReviewCommand(tokenizeCommand('cat a.txt')), true);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('grep -o pattern a.txt')), true);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('rg --pre cat a.txt')), false);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('sed -i s/a/b/ a.txt')), false);
  assert.equal(isAllowedReviewCommand(tokenizeCommand('sed -n 1,5p a.txt')), true);
});

test('execReviewCommand actually runs git inside the workspace and returns output', async () => {
  const result = await execReviewCommand('git status --short', workspace);
  assert.equal(result.ok, true);
  assert.equal(result.stdout, '');

  const diff = await execReviewCommand('git show --stat HEAD', workspace);
  assert.equal(diff.ok, true);
  assert.match(diff.stdout, /a\.txt/);
});

test('execReviewCommand denies non-allowlisted commands before spawning', async () => {
  const result = await execReviewCommand('node -e "require(\'fs\')"', workspace);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'command_not_allowlisted');
});

test('readWorkspaceFile reads inside the workspace and rejects traversal', async () => {
  const inside = await readWorkspaceFile('a.txt', workspace);
  assert.equal(inside.ok, true);
  assert.equal(inside.content, 'hello\nworld\n');

  const traversal = await readWorkspaceFile('../../etc/hostname', workspace);
  assert.equal(traversal.ok, false);

  const missing = await readWorkspaceFile('nope.txt', workspace);
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'file_not_found');
});
