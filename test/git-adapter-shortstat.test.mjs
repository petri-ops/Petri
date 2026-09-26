// UI-449（C-16）— git-adapter.workingTreeShortstat 契约（红绿先行：本文件先于实现落盘）。
// 审阅徽章 ±行数的权威源：HEAD vs 工作树（含暂存）shortstat + 未跟踪文件数分开计数。
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { createGitAdapter } = require_('../core/shared-backend/git-adapter.js');

function seedRepo() {
  const root = mkdtempSync(join(tmpdir(), 'ui449-shortstat-'));
  const git = (args) => execFileSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
  git(['init']);
  writeFileSync(join(root, 'app.js'), 'line1\nline2\nline3\n');
  git(['add', '.']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@local', 'commit', '-m', 'baseline']);
  return root;
}

test('工作树 ±行数：修改 tracked 文件 + 新增未跟踪文件，两者分开计数', () => {
  const root = seedRepo();
  try {
    writeFileSync(join(root, 'app.js'), 'line1\nline2-changed\nline3\nline4-added\nline5-added\n');
    writeFileSync(join(root, 'new.txt'), 'untracked\n');
    const adapter = createGitAdapter({ gitDir: join(root, '.git'), workTree: root });
    const r = adapter.workingTreeShortstat();
    assert.equal(r.tracked.files, 1);
    assert.equal(r.tracked.added, 3, '+3 行（1 改按 +1/−1 计 + 2 纯增）');
    assert.equal(r.tracked.removed, 1, '−1 行');
    assert.equal(r.untrackedFiles, 1);
    assert.equal(r.empty, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('暂存区改动同样计入（diff HEAD 语义）', () => {
  const root = seedRepo();
  try {
    writeFileSync(join(root, 'app.js'), 'only-one-line-now\n');
    execFileSync('git', ['-C', root, 'add', '.']);
    const adapter = createGitAdapter({ gitDir: join(root, '.git'), workTree: root });
    const r = adapter.workingTreeShortstat();
    assert.equal(r.tracked.files, 1);
    assert.equal(r.tracked.removed, 3);
    assert.equal(r.tracked.added, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('干净工作树 → empty:true 全零', () => {
  const root = seedRepo();
  try {
    const adapter = createGitAdapter({ gitDir: join(root, '.git'), workTree: root });
    const r = adapter.workingTreeShortstat();
    assert.equal(r.empty, true);
    assert.equal(r.tracked.files, 0);
    assert.equal(r.untrackedFiles, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
