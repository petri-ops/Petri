/**
 * BLOCK-336 P3 — worktree 生命周期事件（`task_events` 可观测流 + 审计 jsonl 永久留痕）。
 *
 * 语义分工（与 BLOCK-323 policy-observation-store 的既有裁定一致）：
 *   - `worktree-audit.jsonl` = 治理证据（永久，不被清扫）；
 *   - `task_events` = **当下可观测**（会话内可读的生命周期流，随 agent 事件 30 天清扫）。
 *   两者双写，后者缺失不得反向阻断 git 操作（best-effort）。
 *
 * 作用域约定：一条 worktree 自成一条流，`task_id = 'worktree:<worktreeId>'`，seq 从 1 递增；
 * 项目层副本（P2）沿用同一 worktreeId 流，payload 带 `via='project-layer'`。
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const tempRoot = mkdtempSync(path.join(tmpdir(), 'block336-p3-'));
process.env.PETRI_DB_PATH = path.join(tempRoot, 'p3.db');
process.env.PETRI_LOCAL_DATA_DIR = path.join(tempRoot, 'data');

// DB 自举（task_events 由 agent-task-store 建表；migrations 提供项目表）
{
  const Database = require('better-sqlite3');
  const boot = new Database(process.env.PETRI_DB_PATH);
  const migDir = path.join(ROOT, 'src', 'migrations');
  for (const file of require('node:fs').readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(require('node:fs').readFileSync(path.join(migDir, file), 'utf8'));
  }
  boot.close();
}

const db = require(path.join(ROOT, 'core', 'petri-server', 'db.js'));
// task_events 由 agent-task-store 加载即建表（生产后端启动同源），测试需显式走同一初始化
require(path.join(ROOT, 'core', 'petri-server', 'agent-task-store.js'));
const tools = require(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'worktree-tools.js'));

after(() => {
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放 */ }
});

const GIT_IDENTITY = ['-c', 'user.email=block336-p3@example.test', '-c', 'user.name=block336-p3'];

function git(args, cwd) {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepo(label) {
  const dir = mkdtempSync(path.join(tempRoot, `src-${label}-`));
  writeFileSync(path.join(dir, 'README.md'), 'init\n');
  git(['init', '-q'], dir);
  git(['add', '.'], dir);
  git(['commit', '-q', '-m', 'init'], dir);
  return dir;
}

function eventsOf(worktreeId) {
  return db.getDatabase()
    .prepare('SELECT seq, event_type, payload, created_at FROM task_events WHERE task_id = ? ORDER BY seq ASC')
    .all(`worktree:${worktreeId}`)
    .map((row) => ({ seq: row.seq, eventType: row.event_type, payload: JSON.parse(row.payload) }));
}

function makeCore(repoDir, dataDir) {
  return tools.buildCore({
    root: repoDir,
    projectId: 'proj-p3',
    dataDir,
    actor: { userId: 'u-p3', agentId: 'agent-p3', conversationId: 'conv-p3' },
  });
}

// ---------------------------------------------------------------------------
// P1 工具面：create / merge_request / remove 三次动作
// ---------------------------------------------------------------------------

test('BLOCK-336 P3 工具面生命周期：create → merge_request → remove 落同一流且 seq 递增', async () => {
  const repoDir = makeRepo('tools');
  const dataDir = path.join(tempRoot, 'data-tools');
  const core = makeCore(repoDir, dataDir);

  const created = await tools.createWorktree(core, { branch: 'feat/p3', packageId: 'BLOCK-336' });
  assert.equal(created.ok, true, JSON.stringify(created));
  const id = created.worktree.id;

  let events = eventsOf(id);
  assert.equal(events.length, 1, 'create 应落一条事件');
  assert.equal(events[0].eventType, 'worktree_create');
  assert.equal(events[0].seq, 1);
  assert.equal(events[0].payload.branch, 'feat/p3');
  assert.equal(events[0].payload.projectId, 'proj-p3');
  assert.equal(events[0].payload.action, 'create');
  assert.ok(events[0].payload.path, 'payload 应带副本路径');

  const requested = await tools.mergeRequest(core, { id });
  assert.equal(requested.ok, true, JSON.stringify(requested));
  events = eventsOf(id);
  assert.equal(events.length, 2);
  assert.equal(events[1].eventType, 'worktree_merge_request');
  assert.equal(events[1].seq, 2);
  assert.equal(events[1].payload.baseRef, 'HEAD');

  const removed = await tools.removeWorktree(core, { id });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  events = eventsOf(id);
  assert.equal(events.length, 3);
  assert.equal(events[2].eventType, 'worktree_remove');
  assert.equal(events[2].seq, 3);
  assert.equal(events[2].payload.reason, 'clean');
});

test('BLOCK-336 P3 工具面：脏树拒绝删除不落 remove 事件（只留真实发生过的动作）', async () => {
  const repoDir = makeRepo('dirty');
  const dataDir = path.join(tempRoot, 'data-dirty');
  const core = makeCore(repoDir, dataDir);

  const created = await tools.createWorktree(core, { branch: 'feat/p3-dirty' });
  const id = created.worktree.id;
  writeFileSync(path.join(created.worktree.path, 'dirty.txt'), 'x\n');

  const refused = await tools.removeWorktree(core, { id });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'worktree_dirty');

  const events = eventsOf(id);
  assert.equal(events.length, 1, '被拒的删除不得伪造 remove 事件');
  assert.equal(events[0].eventType, 'worktree_create');
});

// ---------------------------------------------------------------------------
// P2 项目层：attach / detach 复用同一流，payload 标明 via
// ---------------------------------------------------------------------------

test('BLOCK-336 P3 项目层生命周期：attach → detach 落同一 worktree 流且 via=project-layer', () => {
  const repo = makeRepo('project');
  const source = db.createProject({ name: 'P3 源', workspacePath: repo });
  const child = db.createProject({ name: 'P3 副本', worktreeOf: source.id });

  const events = db.getDatabase()
    .prepare("SELECT seq, event_type, payload FROM task_events WHERE task_id LIKE 'worktree:%' ORDER BY id ASC")
    .all()
    .map((row) => ({ eventType: row.event_type, payload: JSON.parse(row.payload) }))
    .filter((row) => row.payload.projectId === child.id);
  assert.equal(events.length, 1, 'attach 应落一条 create 事件');
  assert.equal(events[0].eventType, 'worktree_create');
  assert.equal(events[0].payload.via, 'project-layer');
  assert.equal(events[0].payload.sourceProjectId, source.id);

  db.deleteProject(child.id);
  const afterEvents = db.getDatabase()
    .prepare("SELECT event_type, payload FROM task_events WHERE task_id LIKE 'worktree:%' ORDER BY id ASC")
    .all()
    .map((row) => ({ eventType: row.event_type, payload: JSON.parse(row.payload) }))
    .filter((row) => row.payload.projectId === child.id);
  assert.equal(afterEvents.length, 2);
  assert.equal(afterEvents[1].eventType, 'worktree_remove');
  assert.equal(afterEvents[1].payload.via, 'project-layer');
});

// ---------------------------------------------------------------------------
// best-effort：task_events 写失败不得回滚 git 动作（审计 jsonl 才是证据）
// ---------------------------------------------------------------------------

test('BLOCK-336 P3 best-effort：事件写失败时 git 动作仍成功且审计 jsonl 仍在', async () => {
  const repoDir = makeRepo('best');
  const dataDir = path.join(tempRoot, 'data-best');
  // 坏连接：prepare 直接抛（模拟 task_events 不可用/表缺失）
  const brokenDatabase = { prepare() { throw new Error('stub: task_events unavailable'); } };
  const core = tools.buildCore({
    root: repoDir,
    projectId: 'proj-p3',
    dataDir,
    actor: { userId: 'u-p3', agentId: 'agent-p3', conversationId: 'conv-p3' },
    database: brokenDatabase,
  });

  const created = await tools.createWorktree(core, { branch: 'feat/p3-best' });
  assert.equal(created.ok, true, '事件写失败不得阻断 create');
  const contract = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'worktree-contract.js'));
  assert.ok(require('node:fs').existsSync(contract.auditPath(dataDir)), '审计 jsonl 仍应写入（治理证据不依赖 task_events）');
  assert.equal(eventsOf(created.worktree.id).length, 0, '坏连接下不应有事件行');
});
