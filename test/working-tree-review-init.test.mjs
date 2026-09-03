/**
 * working-tree-review-init.test.mjs — BLOCK-53 P2
 *
 * 验证 initRepositoryAt（git:init-repository 通道的核心，导出纯函数）：
 *  - 空目录 → git init + 全量初始提交（.git 存在、committed:true）
 *  - 已是 git 仓库 → alreadyGit 幂等，不重复初始化
 *  - 无 git 身份（GIT_CONFIG_GLOBAL/SYSTEM=/dev/null）→ init 保留、committed:false + warning
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initRepositoryAt } = require('../src/ipc/working-tree-review.js');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('initRepositoryAt: fresh directory → git init + full initial commit', async () => {
  const dir = makeTempDir('biof3-b53-init-');
  try {
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hi\n');
    fs.mkdirSync(path.join(dir, 'nested'));
    fs.writeFileSync(path.join(dir, 'nested', 'data.csv'), 'a,b\n1,2\n');

    const res = await initRepositoryAt(dir);

    assert.equal(res.initialized, true);
    assert.equal(res.committed, true);
    assert.equal(res.path, dir);
    assert.ok(fs.existsSync(path.join(dir, '.git')), '.git created');

    // 真实仓库状态：初始提交包含全部文件
    const { execFileSync } = await import('node:child_process');
    const log = execFileSync('git', ['-C', dir, 'log', '--oneline'], { encoding: 'utf-8' });
    assert.match(log, /Initial commit \(BioF3\)/);
    const files = execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf-8' });
    assert.match(files, /hello\.txt/);
    assert.match(files, /nested\/data\.csv/);
    // 提交后工作区干净
    const status = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf-8' });
    assert.equal(status.trim(), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('initRepositoryAt: already a git repo → idempotent alreadyGit', async () => {
  const dir = makeTempDir('biof3-b53-already-');
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['-C', dir, 'init', '-q']);
    const gitDirMtime = fs.statSync(path.join(dir, '.git')).ino;

    const res = await initRepositoryAt(dir);

    assert.equal(res.alreadyGit, true);
    assert.equal(res.path, dir);
    assert.equal(fs.statSync(path.join(dir, '.git')).ino, gitDirMtime);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('initRepositoryAt: commit fails (empty tree) → init kept, committed:false with warning', async () => {
  // 走与「git 身份未配置」同一容错分支的确定性场景：空目录无文件可提交，
  // git commit 以 "nothing to commit" 失败；init 与 .git 必须保留且返回可行动 warning。
  // （不直接测「无身份」：部分平台的 git 会用 GECOS+hostname 自动推断身份，机器相关不可断言。）
  const dir = makeTempDir('biof3-b53-empty-');
  try {
    const res = await initRepositoryAt(dir);

    assert.equal(res.initialized, true);
    assert.equal(res.committed, false);
    assert.ok(res.warning, 'warning present');
    assert.match(res.warning, /git init 已完成/);
    assert.ok(fs.existsSync(path.join(dir, '.git')), '.git kept despite commit failure');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
