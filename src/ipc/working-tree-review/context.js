'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { createGitAdapter, GitAdapterError } = require('../../../core/shared-backend/git-adapter');
const { getBackendPort } = require('../../main/env-coordinator');

// BLOCK-92 Wave D1 — 自 src/ipc/working-tree-review.js 纯搬运（零行为变化）：
// 项目工作区解析（BLOCK-32 P1 缓存 + BLOCK-67 P3 SSH 远程）+ GitAdapter 装配
// + safeInvoke 错误契约；本文件不持有 IPC 通道。

/**
 * 把 { ok, error } / throw 统一成 renderer 期望的契约。
 * @param {() => any} body
 */
async function safeInvoke(body) {
  try {
    const data = await body();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof GitAdapterError) {
      return { ok: false, error: e.code || 'git_error', message: e.message, detail: e.detail || null };
    }
    return { ok: false, error: 'unexpected_error', message: e && e.message ? e.message : String(e) };
  }
}

/**
 * BLOCK-32 P1 — 取项目工作区路径（经后端 HTTP，避免主进程直连 better-sqlite3 的
 * ABI 不匹配问题：Electron 主进程 Node ABI ≠ npm 安装编译目标）。短 TTL 缓存
 * （30s）吸收高频 status/diff 轮询；项目不存在返回 null。
 */
const PROJECT_WORKSPACE_TTL_MS = 30_000;
const projectWorkspaceCache = new Map();

async function getProjectInfo(projectId) {
  const cached = projectWorkspaceCache.get(projectId);
  if (cached && Date.now() - cached.at < 60_000) return cached.info;
  const base = `http://127.0.0.1:${getBackendPort('r')}`;
  const res = await fetch(`${base}/api/data/projects`);
  if (!res.ok) {
    throw new GitAdapterError('project_not_found', `无法读取项目信息 (HTTP ${res.status})`, { projectId });
  }
  const body = await res.json();
  const project = (body.projects || []).find((p) => p.id === projectId);
  if (!project) {
    throw new GitAdapterError('project_not_found', `项目不存在: ${projectId}`, { projectId });
  }
  const info = {
    workspacePath: project.workspace_path || null,
    workspaceKind: project.workspace_kind === 'ssh' ? 'ssh' : 'local',
    sshHost: project.ssh_host || null,
    remotePath: project.remote_path || null,
  };
  projectWorkspaceCache.set(projectId, { info, at: Date.now() });
  return info;
}

async function getProjectWorkspacePath(projectId) {
  return (await getProjectInfo(projectId)).workspacePath;
}

/**
 * 取得当前 working tree 的 GitAdapter。
 * BLOCK-32 P1 项目级审阅隔离：传 projectId 时解析该项目工作区的 git 仓库
 * （后端 /api/data/projects → workspace_path，校验 .git 存在；非 git 抛
 * `project_workspace_not_git`）；未传时维持旧行为（app 仓库候选）渐进兼容。
 * 失败时抛 GitAdapterError。
 */
async function resolveGitAdapter(projectId) {
  if (projectId) {
    const projectInfo = await getProjectInfo(projectId);
    // BLOCK-67 P3：SSH 远程项目审阅——同一 git argv 面经 `ssh <alias> git` 远端执行；
    // 只读链（status/diff/log/show）先行，写操作（hunk-apply/revert）走同一 argv 通道随后可用。
    if (projectInfo.workspaceKind === 'ssh' && projectInfo.sshHost && projectInfo.remotePath) {
      const gitDir = `${projectInfo.remotePath.replace(/\/+$/, '')}/.git`;
      return createGitAdapter({
        gitDir,
        workTree: projectInfo.remotePath,
        remoteSsh: { alias: projectInfo.sshHost },
      });
    }
    const workspacePath = projectInfo.workspacePath;
    if (!workspacePath || !fs.existsSync(path.join(workspacePath, '.git'))) {
      throw new GitAdapterError(
        'project_workspace_not_git',
        '当前项目工作区不是 git 仓库，无法提供审阅数据。',
        { projectId, workspacePath: workspacePath || null }
      );
    }
    return createGitAdapter({ gitDir: path.join(workspacePath, '.git'), workTree: workspacePath });
  }
  const userData = app.getPath('userData');
  const candidates = [
    app.getAppPath(),
    path.join(userData, 'workspace'),
  ];
  for (const workTree of candidates) {
    const gitDir = path.join(workTree, '.git');
    if (fs.existsSync(gitDir)) {
      return createGitAdapter({ gitDir, workTree });
    }
  }
  throw new GitAdapterError(
    'git_repo_not_found',
    `No .git directory found under ${candidates.join(' / ')}`,
    { tried: candidates }
  );
}

module.exports = { safeInvoke, getProjectInfo, getProjectWorkspacePath, resolveGitAdapter };
