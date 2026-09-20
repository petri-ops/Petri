'use strict';

/**
 * BLOCK-33 P1 — system_info 环境自省工具（只读、零副作用）。
 *
 * 让模型在编写/执行任何平台相关命令前先获取真实环境（OS / shell / 工具链版本），
 * 避免「猜平台 → 试探 uname → Windows 报错」的浪费轮次与误判。
 * 版本查询全部 5s 超时并行，失败诚实返回 null（不猜测、不编造）。
 */

const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const VERSION_PROBE_TIMEOUT_MS = 5000;

function firstLine(value) {
  const text = String(value || '').trim();
  return text ? text.split('\n')[0].trim() : null;
}

async function probeVersion(command, args) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: VERSION_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    return firstLine(result.stdout);
  } catch {
    return null;
  }
}

function resolveShell() {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe';
  }
  return process.env.SHELL && path.isAbsolute(process.env.SHELL)
    ? process.env.SHELL
    : '/bin/sh';
}

/**
 * 环境自省。ctx 仅用于读取 projectId 归属；不需要项目工作区，
 * 只读模式下同样可用（模型需要知道环境才能正确描述只读检查方案）。
 *
 * BLOCK-67 P2：SSH 远程项目的环境真相 = 远程主机（模型编写命令前须知 OS/shell
 * 在远端，指挥席本机环境对工作区操作无意义）；传输失败诚实返回 remote_probe_failed。
 */
async function tool_system_info(_args = {}, ctx = {}) {
  const projectId = ctx && ctx.projectId ? String(ctx.projectId) : null;
  if (projectId) {
    try {
      const db = require('../db');
      const project = typeof db.getProject === 'function' ? db.getProject(projectId) : null;
      if (project && project.workspace_kind === 'ssh') {
        const { resolveWorkspaceBackend } = require('../helpers/workspace-gateway');
        const resolved = resolveWorkspaceBackend(project);
        if (resolved.backend && resolved.backend.kind === 'ssh') {
          try {
            const raw = await resolved.backend.exec(
              'uname -sr; uname -m; echo "shell=$SHELL"; python3 --version 2>&1 | head -1; git --version 2>&1 | head -1; node --version 2>&1 | head -1',
              resolved.root,
              20
            );
            const lines = String(raw.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
            const env = {};
            for (const line of lines) {
              if (line.startsWith('shell=')) env.shell = line.slice(6) || '/bin/sh';
              else if (/^Python \d/.test(line)) env.python = line;
              else if (/^git version/.test(line)) env.git = line;
              else if (/^v\d/.test(line)) env.node = line;
              else if (/\w/.test(line) && !env.os) env.os = line;
              else if (env.os && !env.arch) env.arch = line;
            }
            return {
              ok: true,
              workspace: {
                kind: 'ssh',
                host: project.ssh_host,
                remotePath: project.remote_path,
              },
              os: { platform: 'linux(远程探测)', type: null, release: null, arch: env.arch || null, detail: env.os || null },
              shell: env.shell || '/bin/bash',
              pathSeparator: '/',
              toolchain: { python: env.python || null, git: env.git || null, node: env.node || null },
              projectId,
              note:
                `当前项目是 SSH 远程项目：所有 workspace_* 工具与 workspace_exec 都在远程主机 ${project.ssh_host} 的 ${project.remote_path} 上执行（Linux/bash 语义，路径分隔符 /）；本机环境信息与工作区无关。`,
            };
          } catch (error) {
            return {
              ok: false,
              code: 'remote_probe_failed',
              error: `远程环境探测失败：${error && error.message ? error.message : 'unknown'}`,
              retryable: !!(error && error.classified && error.classified.retryable),
              projectId,
              note: `当前项目是 SSH 远程项目（host=${project.ssh_host}，root=${project.remote_path}），工作区操作全部在远端执行；探测失败不代表远端不可用，可重试或用 workspace_list 验证连通。`,
            };
          }
        }
      }
    } catch { /* 项目查询失败：回落本机自省（诚实本地结果） */ }
  }
  const shell = resolveShell();
  const [nodeVersion, npmVersion, pythonVersion, gitVersion] = await Promise.all([
    probeVersion('node', ['--version']),
    probeVersion('npm', ['--version']),
    probeVersion(process.platform === 'win32' ? 'python' : 'python3', ['--version']),
    probeVersion('git', ['--version']),
  ]);
  return {
    ok: true,
    os: {
      platform: process.platform,
      type: os.type(),
      release: os.release(),
      arch: os.arch(),
    },
    shell,
    pathSeparator: path.sep,
    hostname: os.hostname(),
    toolchain: {
      node: nodeVersion,
      npm: npmVersion,
      python: pythonVersion,
      git: gitVersion,
    },
    projectId: ctx && ctx.projectId ? ctx.projectId : null,
    note:
      'workspace_exec 的工作目录固定为当前项目根目录；每条命令都是独立 shell，cd 与环境变量不跨调用持久。',
  };
}

module.exports = { tool_system_info };
