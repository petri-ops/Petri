/**
 * core/petri-server/mcp/ide-tools/resources.js
 *
 * MCP Resources for IDE — read-only data sources the agent can query as context.
 *
 * Resources:
 *   - ide://projects                 → 枚举 cwd 父目录下的同级项目
 *   - ide://git-status?path=<path>   → git status（porcelain v1 + branch）
 *
 * 设计依据：G0-IDE-MCP-TOOLS Phase 1.5（docs/g0-ide-mcp-tools-plan.md §10）
 * 与 Phase 1 工具保持风格一致：
 *   - 复用 path-allowlist.resolveAllowlisted
 *   - spawnSync + 5s 超时
 *   - 内容上限 64KB
 *   - 失败统一 { ok: false, error }
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveAllowlisted } = require('./path-allowlist');

const MAX_CONTENT_BYTES = 64 * 1024;
const GIT_TIMEOUT_MS = 5000;

// ─── 资源定义（MCP resources/list） ─────────────────────────────

const RESOURCE_DEFINITIONS = [
  {
    uri: 'ide://projects',
    name: 'IDE Projects',
    description: 'Top-level project directories under cwd parent (immediate siblings).',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'ide://git-status?path={path}',
    name: 'IDE Git Status',
    description: 'git status (porcelain v1 + branch) for a path. Query: path (must be in allowlist).',
    mimeType: 'application/json',
  },
];

function getIdeResourceDefinitions() {
  return RESOURCE_DEFINITIONS;
}

function listIdeResources() {
  return RESOURCE_DEFINITIONS.map((r) => ({
    uri: r.uri || r.uriTemplate,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType,
  }));
}

// ─── URI 解析 ────────────────────────────────────────────────────

/**
 * 解析 URI，返回 { scheme, host, query: { ... } }。
 * 支持 query string 解析（简单 split 实现，不依赖 URL 模块避免 polyfill）。
 */
function parseUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('ide://')) return null;
  const rest = uri.slice('ide://'.length);
  const qIdx = rest.indexOf('?');
  const path = qIdx >= 0 ? rest.slice(0, qIdx) : rest;
  const query = {};
  if (qIdx >= 0) {
    const pairs = rest.slice(qIdx + 1).split('&');
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const k = decodeURIComponent(pair.slice(0, eq));
      const v = decodeURIComponent(pair.slice(eq + 1));
      query[k] = v;
    }
  }
  return { scheme: 'ide', host: path, query };
}

// ─── 资源实现 ────────────────────────────────────────────────────

function readProjects() {
  // 列出 cwd 父目录下所有"项目"（包含 package.json 的目录）
  const cwd = process.cwd();
  const parent = path.dirname(cwd);
  let entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch (e) {
    return { ok: false, error: `cannot read parent directory ${parent}: ${e.message}` };
  }
  const projects = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.')) continue;
    const projectPath = path.join(parent, ent.name);
    const hasPackageJson = fs.existsSync(path.join(projectPath, 'package.json'));
    const hasGit = fs.existsSync(path.join(projectPath, '.git'));
    projects.push({
      name: ent.name,
      path: projectPath,
      hasPackageJson,
      hasGit,
    });
  }
  return { ok: true, count: projects.length, projects };
}

function readGitStatus(query) {
  const pathArg = query && query.path;
  if (!pathArg) return { ok: false, error: 'missing required query param: path' };
  const resolved = resolveAllowlisted(pathArg);
  if (!resolved.ok) return { ok: false, error: resolved.reason };
  const abs = resolved.absolutePath;
  // 检查是否为 git 仓库
  if (!fs.existsSync(path.join(abs, '.git'))) {
    return { ok: true, isRepo: false, path: abs };
  }
  // porcelain v1 -b：先给 branch 行，后面给文件状态
  const proc = spawnSync('git', ['status', '--porcelain=v1', '-b'], {
    cwd: abs,
    timeout: GIT_TIMEOUT_MS,
    encoding: 'utf8',
    maxBuffer: MAX_CONTENT_BYTES,
  });
  if (proc.error) {
    if (proc.error.code === 'ETIMEDOUT') {
      return { ok: false, error: `git status timed out after ${GIT_TIMEOUT_MS}ms` };
    }
    return { ok: false, error: `git status failed: ${proc.error.message}` };
  }
  if (proc.status !== 0) {
    return { ok: false, error: `git status exited ${proc.status}: ${proc.stderr || ''}`.trim() };
  }
  const lines = proc.stdout.split('\n').filter(Boolean);
  let branch = null;
  let upstream = null;
  const staged = [];
  const unstaged = [];
  const untracked = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      // ## branch...upstream [ahead N, behind M]
      const branchLine = line.slice(3).trim();
      const dotIdx = branchLine.indexOf('...');
      if (dotIdx >= 0) {
        branch = branchLine.slice(0, dotIdx);
        const tail = branchLine.slice(dotIdx + 3).trim();
        const bracketIdx = tail.indexOf(' [');
        upstream = bracketIdx >= 0 ? tail.slice(0, bracketIdx) : tail;
      } else {
        branch = branchLine;
      }
      continue;
    }
    // porcelain v1 两字符：XY <path>
    // X = index, Y = worktree, ?? 表示 untracked
    if (line.startsWith('?? ')) {
      untracked.push({ path: line.slice(3) });
      continue;
    }
    const x = line[0];
    const y = line[1];
    const filePath = line.slice(3);
    if (x !== ' ' && x !== '?') staged.push({ status: x, path: filePath });
    if (y !== ' ' && y !== '?') unstaged.push({ status: y, path: filePath });
  }
  const isClean = staged.length === 0 && unstaged.length === 0 && untracked.length === 0;
  return {
    ok: true,
    isRepo: true,
    path: abs,
    branch,
    upstream,
    isClean,
    staged,
    unstaged,
    untracked,
    shortstat: {
      staged: staged.length,
      unstaged: unstaged.length,
      untracked: untracked.length,
    },
  };
}

// ─── readResource 入口 ────────────────────────────────────────────

function readIdeResource(uri) {
  const parsed = parseUri(uri);
  if (!parsed) return { ok: false, error: `invalid URI: ${uri}` };
  let payload;
  if (parsed.host === 'projects') {
    payload = readProjects();
  } else if (parsed.host === 'git-status') {
    payload = readGitStatus(parsed.query);
  } else {
    return { ok: false, error: `unknown resource host: ${parsed.host}` };
  }
  // 序列化并强制 64KB 上限
  const text = JSON.stringify(payload);
  const truncated = text.length > MAX_CONTENT_BYTES;
  const finalText = truncated ? text.slice(0, MAX_CONTENT_BYTES) : text;
  // 当 payload 内部 ok=false 时（业务校验失败），把错误提升到顶层
  // 这样调用方可以直接拿到 error，不需要再 parse text
  if (payload && payload.ok === false) {
    return {
      ok: false,
      error: payload.error || 'resource payload rejected',
      uri,
      mimeType: 'application/json',
      text: finalText,
      truncated,
    };
  }
  return {
    ok: true,
    uri,
    mimeType: 'application/json',
    text: finalText,
    truncated,
  };
}

module.exports = {
  getIdeResourceDefinitions,
  listIdeResources,
  readIdeResource,
  // 供测试直连
  _parseUri: parseUri,
  _readProjects: readProjects,
  _readGitStatus: readGitStatus,
};