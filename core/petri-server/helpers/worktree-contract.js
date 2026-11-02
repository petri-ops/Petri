'use strict';

/**
 * helpers/worktree-contract.js — BLOCK-336 P1 worktree 契约纯函数 + 登记表 IO。
 *
 * 把 docs/worktree-governance.md 的纪律翻译成可机械校验的函数（每节一个函数，不做哲学）：
 *   §4 一一对应：一 worktree ↔ 一分支 ↔ 一 Agent owner ↔ 一 bounded 包（checkContract）
 *   §5 环境隔离：端口偏移约定（derivePortBase；真实装配随消费者落地）
 *   §7 保留与移除：脏树/未合并提交 fail-closed（parsePorcelain 供 remove 前置校验）
 *   §8 集中管理：registry.json 唯一登记源（loadRegistry/saveRegistry，损坏即 fail-closed）
 * 全部纯函数（除 IO 两件），不 require 数据库，不 require child_process——git 调用在 worktree-tools.js。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REGISTRY_VERSION = 1;
const WORKTREES_DIRNAME = 'worktrees';
const REGISTRY_FILENAME = 'registry.json';
const AUDIT_FILENAME = 'worktree-audit.jsonl';
const DEFAULT_PORT_BASE = 3101;
const PORT_STRIDE = 10;

/**
 * 分支名校验（git check-ref-format 的保守子集）：禁 `-` 开头（防参数注入）、禁 `..`、禁 `//`、
 * 禁 `@{`、禁 `.lock` 结尾、禁结尾 `/`、禁控制字符与 `~^:?*[\\` 与空白；长度 ≤ 120。
 */
function validateBranchName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value) return { ok: false, error: 'branch_required', message: '需要分支名' };
  if (value.length > 120) return { ok: false, error: 'branch_too_long', message: '分支名超过 120 字符' };
  if (value.startsWith('-')) return { ok: false, error: 'branch_invalid', message: '分支名不能以 - 开头' };
  // 控制字符单独按码点判（等价于 [\x00-\x1f\x7f]，但不写控制字符正则，免 eslint no-control-regex 豁免）
  const hasControl = [...value].some((ch) => {
    const code = ch.codePointAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (hasControl) return { ok: false, error: 'branch_invalid', message: '分支名含控制字符' };
  if (/[\s~^:?*[\\]/.test(value)) return { ok: false, error: 'branch_invalid', message: '分支名含非法字符' };
  if (value.includes('..') || value.includes('//') || value.includes('@{')) return { ok: false, error: 'branch_invalid', message: '分支名含 .. // 或 @{' };
  if (value.endsWith('.lock') || value.endsWith('/') || value.endsWith('.')) return { ok: false, error: 'branch_invalid', message: '分支名结尾非法' };
  if (value.split('/').some((seg) => seg.startsWith('.') || seg === '')) return { ok: false, error: 'branch_invalid', message: '分支名段不能以 . 开头或为空' };
  return { ok: true, value };
}

/** 分支名 → 目录段（只保留安全字符，斜杠折成 `__`）。 */
function branchDirSegment(branch) {
  return String(branch).replace(/\//g, '__').replace(/[^A-Za-z0-9._-]/g, '_');
}

function worktreesRoot(dataDir) {
  return path.join(dataDir, WORKTREES_DIRNAME);
}

/** 约定目录：<dataDir>/worktrees/<projectId>/<branch-segment>（P2 项目层 worktreeOf 同根）。 */
function worktreeDirFor(dataDir, projectId, branch) {
  return path.join(worktreesRoot(dataDir), String(projectId), branchDirSegment(branch));
}

function registryPath(dataDir) {
  return path.join(worktreesRoot(dataDir), REGISTRY_FILENAME);
}

function auditPath(dataDir) {
  return path.join(worktreesRoot(dataDir), AUDIT_FILENAME);
}

function emptyRegistry() {
  return { version: REGISTRY_VERSION, entries: [] };
}

/** 登记表读取：缺失=空表；损坏 fail-closed 抛 worktree_registry_corrupt（不猜、不覆盖）。 */
function loadRegistry(dataDir) {
  const file = registryPath(dataDir);
  if (!fs.existsSync(file)) return emptyRegistry();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw Object.assign(new Error(`worktree 登记表损坏：${file}`), { code: 'worktree_registry_corrupt', cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
    throw Object.assign(new Error(`worktree 登记表形状非法：${file}`), { code: 'worktree_registry_corrupt' });
  }
  return { version: Number(parsed.version) || REGISTRY_VERSION, entries: parsed.entries };
}

/** 原子写（tmp + rename）。 */
function saveRegistry(dataDir, registry) {
  const file = registryPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: REGISTRY_VERSION, entries: registry.entries }, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return file;
}

/** 生命周期审计（追加式 jsonl；对标 trust-audit / retention-audit 先例）。 */
function appendAudit(dataDir, record) {
  const file = auditPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
  return file;
}

function newWorktreeId() {
  return `wt_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function activeEntries(registry, projectId) {
  return registry.entries.filter((e) => e && e.status === 'active' && (!projectId || e.projectId === projectId));
}

/**
 * §4 一一对应契约：同项目下 branch / path 唯一；同一 agentId 至多一个 active worktree；
 * 同一 packageId 至多一个 active worktree。返回全部违规（不短路），供工具一次报清。
 */
function checkContract(registry, request) {
  const violations = [];
  const scoped = activeEntries(registry, request.projectId);
  for (const entry of scoped) {
    if (entry.branch === request.branch) violations.push({ rule: 'one_branch_one_worktree', detail: `分支 ${request.branch} 已有活动 worktree ${entry.id}` });
    if (entry.path === request.dir) violations.push({ rule: 'one_path_one_worktree', detail: `目录已被 ${entry.id} 占用` });
  }
  if (request.agentId) {
    const owned = registry.entries.find((e) => e && e.status === 'active' && e.agentId === request.agentId);
    if (owned) violations.push({ rule: 'one_agent_one_worktree', detail: `agent ${request.agentId} 已持有 ${owned.id}（${owned.branch}）` });
  }
  if (request.packageId) {
    const bound = registry.entries.find((e) => e && e.status === 'active' && e.packageId === request.packageId);
    if (bound) violations.push({ rule: 'one_package_one_worktree', detail: `包 ${request.packageId} 已绑定 ${bound.id}（${bound.branch}）` });
  }
  return { ok: violations.length === 0, violations };
}

/** §5 端口偏移约定：base（PETRI_WORKTREE_PORT_BASE，默认 3101）+ ordinal*10 → {backend, renderer}。 */
function derivePortBase(env, ordinal) {
  const raw = env && env.PETRI_WORKTREE_PORT_BASE;
  const base = Number.isInteger(Number(raw)) && Number(raw) > 1024 ? Number(raw) : DEFAULT_PORT_BASE;
  const idx = Number.isInteger(ordinal) && ordinal >= 0 ? ordinal : 0;
  const backend = base + idx * PORT_STRIDE;
  return { backend, renderer: backend + 1, stride: PORT_STRIDE, base };
}

/**
 * `git status --porcelain=v1 -b` 解析：首行 `## <branch>...<upstream> [ahead N, behind M]`，
 * 其后每行两字符状态码 + 路径。untracked=`??`。
 */
function parsePorcelain(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.length > 0);
  const result = { branch: null, upstream: null, ahead: 0, behind: 0, modified: [], untracked: [], dirty: false };
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const head = line.slice(3);
      const m = /^([^.\s]+(?:\.\.\.(\S+))?)(?:\s+\[(.*)\])?$/.exec(head);
      if (m) {
        result.branch = m[1].split('...')[0];
        result.upstream = m[2] || null;
        const flags = m[3] || '';
        const ahead = /ahead (\d+)/.exec(flags);
        const behind = /behind (\d+)/.exec(flags);
        if (ahead) result.ahead = Number(ahead[1]);
        if (behind) result.behind = Number(behind[1]);
      } else {
        result.branch = head;
      }
      continue;
    }
    const code = line.slice(0, 2);
    const file = line.slice(3);
    if (code === '??') result.untracked.push(file);
    else result.modified.push(file);
  }
  result.dirty = result.modified.length > 0 || result.untracked.length > 0;
  return result;
}

module.exports = {
  REGISTRY_VERSION,
  WORKTREES_DIRNAME,
  REGISTRY_FILENAME,
  AUDIT_FILENAME,
  DEFAULT_PORT_BASE,
  PORT_STRIDE,
  validateBranchName,
  branchDirSegment,
  worktreesRoot,
  worktreeDirFor,
  registryPath,
  auditPath,
  loadRegistry,
  saveRegistry,
  appendAudit,
  newWorktreeId,
  activeEntries,
  checkContract,
  derivePortBase,
  parsePorcelain,
};
