#!/usr/bin/env node
/**
 * BLOCK-336 P4 — worktree 隔离后端实机腿（真进程 + 真 git + 跨进程 registry）。
 *
 * 为什么这样组：项目层是 REST 面（无 UI），agent 工具面没有 REST 执行端点。
 * 所以本腿=①隔离后端进程跑项目层全链（POST/409/200 全走真 HTTP）；
 * ②工具面在同一 dataDir 上真跑（真 git），验证**跨进程 registry 一致性**——
 * 后端建的副本，工具面 `list` 必须看得见，反之亦然。
 *
 * 覆盖：建源仓 → 建副本项目 → git 认领 → 工具面 list 看见 → 副本内改动变脏 →
 *       merge_request 出摘要 → DELETE 脏树 409 → 确认后 200 → 目录移除/分支保留 →
 *       registry 转 removed → task_events 生命周期行（create + remove）。
 *
 * 用法：node scripts/block336-worktree-live.mjs
 * 证据：acceptance/block-336/block336-p4-live-<platform>.json
 */
import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PLATFORM = process.platform;
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-336');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b336-live-'));
const dbPath = path.join(tempRoot, 'petri.db');
const dataDir = path.join(tempRoot, 'data');
const AUTH = { Authorization: 'Bearer desktop-local' };

// 工具面与项目层共用同一 dataDir / DB（跨进程一致性是本腿的断言对象）
process.env.PETRI_DB_PATH = dbPath;
process.env.PETRI_LOCAL_DATA_DIR = dataDir;

const GIT_IDENTITY = ['-c', 'user.email=block336-p4@example.test', '-c', 'user.name=block336-p4'];
function git(args, cwd) {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
  });
}

async function findFreePort(start = 3181, tries = 20) {
  for (let i = 0; i < tries; i += 1) {
    const port = start + i;
    if (!(await portOpen(port))) return port;
  }
  throw new Error(`no free port in ${start}..${start + tries - 1}`);
}

async function waitFor(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try { last = await fn(); } catch { last = null; }
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}: ${String(last).slice(0, 240)}`);
}

function killTree(pid) {
  if (!pid) return;
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch { /* posix */ }
  try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
}

const assertions = [];
function assert(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
}

function writeReport(extra = {}) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const report = {
    name: 'worktree-live',
    block: 'BLOCK-336',
    phase: 'P4',
    platform: PLATFORM,
    startedAt: extra.startedAt,
    finishedAt: new Date().toISOString(),
    backend: extra.backend || null,
    assertions,
    allPass: assertions.every((item) => item.pass),
    passed: assertions.filter((item) => item.pass).length,
    total: assertions.length,
  };
  const file = path.join(EVIDENCE, `block336-p4-live-${PLATFORM}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

const startedAt = new Date().toISOString();
let backend = null;
let apiBase = null;
let toolCore = null;

async function rest(method, p, body) {
  const response = await fetch(apiBase + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-json */ }
  return { ok: response.ok, status: response.status, data };
}

try {
  // ---------- 预建库（后端进程不跑 src/migrations，那是桌面主进程的 migration-runner；同 block262 姿势） ----------
  {
    const Database = require('better-sqlite3');
    const bootDb = new Database(dbPath);
    const migrationsDir = path.join(ROOT, 'src', 'migrations');
    for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
      bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    }
    bootDb.close();
  }

  // ---------- 源仓 ----------
  const repo = path.join(tempRoot, 'source-repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), 'block336 p4\n');
  git(['init', '-q'], repo);
  git(['add', '.'], repo);
  git(['commit', '-q', '-m', 'init'], repo);

  // ---------- 隔离后端 ----------
  const port = await findFreePort();
  apiBase = `http://127.0.0.1:${port}/api`;
  backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
    env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: dataDir, R_SERVER_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
  });
  backend.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200));
  });

  await waitFor(async () => {
    const response = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok ? true : null;
  }, { timeoutMs: 60_000, label: 'backend health' });
  assert('V1_isolated_backend', true, `backend :${port} + temp dataDir（端口自适应，不杀未知进程）`);

  // ---------- V2 源项目 ----------
  const sourceRes = await rest('POST', '/data/projects', { name: 'P4 源', workspacePath: repo });
  const source = sourceRes.data && sourceRes.data.project;
  assert('V2_source_project_created', sourceRes.status === 200 && source && source.workspace_path === repo,
    `status=${sourceRes.status} id=${source && source.id} path=${source && source.workspace_path}`);

  // ---------- V3 副本项目 ----------
  const childRes = await rest('POST', '/data/projects', { name: 'P4 副本', worktreeOf: source && source.id });
  const child = childRes.data && childRes.data.project;
  const expectedDir = path.join(dataDir, 'worktrees', child ? child.id : 'missing');
  assert('V3_worktree_project_created',
    childRes.status === 200 && child && child.worktree_of === source.id && child.workspace_path === expectedDir && fs.existsSync(expectedDir),
    `status=${childRes.status} worktree_of=${child && child.worktree_of} path=${child && child.workspace_path}`);

  // ---------- V4 git 认领 ----------
  const worktreeList = git(['worktree', 'list', '--porcelain'], repo);
  const realDir = fs.realpathSync(expectedDir);
  assert('V4_git_claims_copy', worktreeList.includes(realDir) || worktreeList.includes(expectedDir),
    `git worktree list 含副本=${worktreeList.includes(realDir) || worktreeList.includes(expectedDir)}`);

  // ---------- V5 跨进程 registry：工具面看得见后端建的副本 ----------
  const tools = require(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'worktree-tools.js'));
  toolCore = tools.buildCore({
    root: repo,
    projectId: child.id,
    dataDir,
    actor: { userId: 'u-p4', agentId: 'agent-p4', conversationId: 'conv-p4' },
  });
  const listed = await tools.listWorktrees(toolCore);
  const listedEntry = listed.worktrees && listed.worktrees.find((item) => item.path === expectedDir);
  assert('V5_tool_list_sees_copy', listed.ok && Boolean(listedEntry) && listedEntry.exists === true,
    `total=${listed.total} exists=${listedEntry && listedEntry.exists} gitKnown=${listedEntry && listedEntry.gitKnown}`);

  // ---------- V6 副本内改动 → 脏树 ----------
  fs.writeFileSync(path.join(expectedDir, 'agent-edit.txt'), 'changed by agent\n');
  const listedDirty = await tools.listWorktrees(toolCore);
  const dirtyEntry = listedDirty.worktrees.find((item) => item.path === expectedDir);
  assert('V6_agent_edit_dirty', dirtyEntry && dirtyEntry.dirty === true && (dirtyEntry.untracked || []).includes('agent-edit.txt'),
    `dirty=${dirtyEntry && dirtyEntry.dirty} untracked=${JSON.stringify((dirtyEntry && dirtyEntry.untracked) || []).slice(0, 120)}`);

  // ---------- V7 merge_request 只出摘要 ----------
  const headBefore = git(['rev-parse', 'HEAD'], repo);
  const request = await tools.mergeRequest(toolCore, { branch: `worktree/${child.id}` });
  const summary = request.mergeRequest || {};
  assert('V7_merge_request_summary',
    request.ok && summary.merged === false && summary.worktreeDirty === true && git(['rev-parse', 'HEAD'], repo) === headBefore,
    `ok=${request.ok} merged=${summary.merged} dirty=${summary.worktreeDirty} ahead=${summary.ahead} 主仓 HEAD 未变=${git(['rev-parse', 'HEAD'], repo) === headBefore}`);

  // ---------- V8 脏树 DELETE 409 ----------
  const denied = await rest('DELETE', `/data/projects/${child.id}`);
  const deniedFiles = (denied.data && denied.data.dirtyFiles) || [];
  assert('V8_delete_dirty_409',
    denied.status === 409 && denied.data && denied.data.code === 'worktree_dirty' && deniedFiles.includes('agent-edit.txt'),
    `status=${denied.status} code=${denied.data && denied.data.code} files=${JSON.stringify(deniedFiles).slice(0, 120)}`);
  const stillThere = await rest('GET', `/data/projects/${child.id}`);
  assert('V9_409_leaves_project_intact', stillThere.status === 200 && Boolean(stillThere.data && stillThere.data.project),
    `GET 项目仍在 status=${stillThere.status}`);

  // ---------- V10 确认后删除 ----------
  const confirmed = await rest('DELETE', `/data/projects/${child.id}?confirmWorktreeDirty=1`);
  const branchKept = git(['branch', '--list', `worktree/${child.id}`], repo).includes(`worktree/${child.id}`);
  assert('V10_delete_confirmed_200', confirmed.status === 200,
    `status=${confirmed.status}`);
  assert('V11_copy_removed_branch_kept', !fs.existsSync(expectedDir) && branchKept,
    `目录已移除=${!fs.existsSync(expectedDir)} 分支保留=${branchKept}`);

  // ---------- V12 registry 转 removed ----------
  const contract = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'worktree-contract.js'));
  const registry = contract.loadRegistry(dataDir);
  const removedEntry = registry.entries.find((entry) => entry.projectId === child.id);
  assert('V12_registry_removed', removedEntry && removedEntry.status === 'removed' && Boolean(removedEntry.removedAt),
    `status=${removedEntry && removedEntry.status} reason=${removedEntry && removedEntry.removedReason}`);

  // ---------- V13 task_events 生命周期（create + remove） ----------
  const Database = require('better-sqlite3');
  const cdb = new Database(dbPath, { readonly: true });
  let eventRows = [];
  try {
    eventRows = cdb.prepare("SELECT task_id, seq, event_type, payload FROM task_events WHERE event_type LIKE 'worktree_%' ORDER BY id ASC").all();
  } finally {
    cdb.close();
  }
  const createEvent = eventRows.find((row) => row.event_type === 'worktree_create' && JSON.parse(row.payload).projectId === child.id);
  const removeEvent = eventRows.find((row) => row.event_type === 'worktree_remove' && JSON.parse(row.payload).projectId === child.id);
  assert('V13_task_events_lifecycle', Boolean(createEvent) && Boolean(removeEvent)
    && JSON.parse(createEvent.payload).via === 'project-layer' && JSON.parse(removeEvent.payload).via === 'project-layer',
    `create=${Boolean(createEvent)} remove=${Boolean(removeEvent)} via=${createEvent ? JSON.parse(createEvent.payload).via : '-'}`);
} catch (error) {
  assert('P4_flow_error', false, error && error.message ? error.message : String(error));
} finally {
  if (backend && backend.pid) killTree(backend.pid);
  const file = writeReport({ startedAt, backend: apiBase });
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放 */ }
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`\n[block336-p4] ${report.passed}/${report.total} allPass=${report.allPass} → ${path.relative(ROOT, file)}`);
  process.exitCode = report.allPass ? 0 : 1;
}
