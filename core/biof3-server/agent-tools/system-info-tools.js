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
 */
async function tool_system_info(args = {}, ctx = {}) {
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
