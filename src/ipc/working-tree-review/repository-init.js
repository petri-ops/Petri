'use strict';

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { GitAdapterError } = require('../../../core/shared-backend/git-adapter');

const execFileAsync = promisify(execFile);

// BLOCK-92 Wave D1 — 自 src/ipc/working-tree-review.js 纯搬运（零行为变化）：
// BLOCK-53 P2 git init 引导（幂等 + 身份未配置诚实 warning）。

/**
 * BLOCK-53 P2 — 在目录执行 git init + 全量初始提交，让非 git 工作区获得审阅能力。
 * 幂等：.git 已存在时直接返回 alreadyGit，不重复初始化。
 * 初始提交失败（典型：git 用户身份未配置）时保留 .git 与暂存区，返回 committed:false
 * 与可行动的 warning —— init 本身已让审阅可用（staged 变更可见），不回滚。
 * @param {string} workspacePath 绝对路径（调用方已校验存在且为目录）
 * @returns {Promise<{alreadyGit?: boolean, initialized?: boolean, committed?: boolean, path: string, warning?: string}>}
 */
async function initRepositoryAt(workspacePath) {
  const gitDir = path.join(workspacePath, '.git');
  if (fs.existsSync(gitDir)) {
    return { alreadyGit: true, path: workspacePath };
  }
  try {
    await execFileAsync('git', ['init'], { cwd: workspacePath });
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new GitAdapterError('git_not_found', '未找到 git 命令，请先安装 git。', { workspacePath });
    }
    throw new GitAdapterError('git_init_failed', `git init 失败: ${e.message}`, { workspacePath });
  }
  try {
    await execFileAsync('git', ['add', '-A'], { cwd: workspacePath, maxBuffer: 32 * 1024 * 1024 });
    await execFileAsync('git', ['commit', '-m', 'Initial commit (Gewu)'], {
      cwd: workspacePath,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_EDITOR: 'true' },
    });
    return { initialized: true, committed: true, path: workspacePath };
  } catch (e) {
    const text = `${e.stderr || ''}${e.stdout || ''}${e.message || ''}`;
    if (/tell me who you are|identity|user\.name/i.test(text)) {
      return {
        initialized: true,
        committed: false,
        path: workspacePath,
        warning: 'git init 已完成，但初始提交需要先配置 git 用户身份（git config --global user.name / user.email）后重试提交。',
      };
    }
    return {
      initialized: true,
      committed: false,
      path: workspacePath,
      warning: `git init 已完成，但初始提交失败: ${(e.stderr || e.message || '').trim().slice(0, 300)}`,
    };
  }
}

module.exports = { initRepositoryAt };
