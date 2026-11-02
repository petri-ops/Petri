/**
 * BLOCK-336 P1 — worktree 基础设施契约（工具面四件 + governance 纪律翻译）。
 *
 * 覆盖 docs/worktree-governance.md 的可机械化部分：
 *   §4 一一对应（一分支/一目录/一 Agent/一包）→ checkContract
 *   §5 环境隔离端口约定 → derivePortBase
 *   §7 保留与移除（脏树/未合并提交 fail-closed）→ removeWorktree
 *   §8 集中管理（registry.json 单源 + 审计 jsonl）→ load/save/appendAudit
 * 工具面用真 git 临时仓（不经 DB、不打桩），保证「脏树拒绝 / 分支保留 / 绝不 merge」是行为断言而非字符串断言。
 */
import assert from 'node:assert/strict';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// 内存 DB 自举（agent-tools 顶层初始化注册表，同 block109 / block34 先例）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b336-db-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放 */ }
  });
}

const contract = require(path.join(root, 'core', 'petri-server', 'helpers', 'worktree-contract.js'));
const tools = require(path.join(root, 'core', 'petri-server', 'agent-tools', 'worktree-tools.js'));

const GIT_IDENTITY = ['-c', 'user.email=block336@example.test', '-c', 'user.name=block336'];

function git(args, cwd) {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepo() {
  const dir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b336-repo-'));
  fssync.writeFileSync(path.join(dir, 'README.md'), 'init\n');
  git(['init', '-q'], dir);
  git(['add', '.'], dir);
  git(['commit', '-q', '-m', 'init'], dir);
  return dir;
}

function makeCore(repoDir, dataDir, overrides = {}) {
  return tools.buildCore({
    root: repoDir,
    projectId: 'proj-336',
    dataDir,
    actor: { userId: 'u-test', agentId: 'agent-a', conversationId: 'conv-1' },
    ...overrides,
  });
}

function tempDataDir() {
  const dir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b336-data-'));
  process.on('exit', () => {
    try { fssync.rmSync(dir, { recursive: true, force: true }); } catch { /* 同上 */ }
  });
  return dir;
}

// ---------------------------------------------------------------------------
// §4 / §5 / §7 / §8 — 纯函数
// ---------------------------------------------------------------------------

test('BLOCK-336 分支名白名单拒绝参数注入与非法 ref（validateBranchName）', () => {
  const bad = ['', '   ', '-x', 'a..b', 'a//b', 'a@{b', 'x.lock', 'x/', 'x.', '.hidden', 'a b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'a\u0000b', 'a\u007fb'];
  for (const name of bad) {
    const result = contract.validateBranchName(name);
    assert.equal(result.ok, false, `${JSON.stringify(name)} 应被拒绝`);
  }
  const long = 'a'.repeat(121);
  assert.equal(contract.validateBranchName(long).ok, false);
  assert.equal(contract.validateBranchName(long).error, 'branch_too_long');
  for (const name of ['feat/x', 'codex/g0-336', 'release-1.2']) {
    const result = contract.validateBranchName(name);
    assert.equal(result.ok, true, `${name} 应通过`);
    assert.equal(result.value, name);
  }
});

test('BLOCK-336 约定目录形状：<dataDir>/worktrees/<projectId>/<branch-segment>（斜杠折 __）', () => {
  const dataDir = path.join('/tmp', 'data');
  assert.equal(contract.branchDirSegment('feat/x'), 'feat__x');
  assert.equal(contract.branchDirSegment('codex/g0-336'), 'codex__g0-336');
  assert.equal(
    contract.worktreeDirFor(dataDir, 'proj-1', 'feat/x'),
    path.join(dataDir, 'worktrees', 'proj-1', 'feat__x')
  );
  assert.equal(contract.registryPath(dataDir), path.join(dataDir, 'worktrees', 'registry.json'));
  assert.equal(contract.auditPath(dataDir), path.join(dataDir, 'worktrees', 'worktree-audit.jsonl'));
});

test('BLOCK-336 §4 一一对应：分支/目录/Agent/包四类违规一次报全（checkContract）', () => {
  const registry = {
    version: 1,
    entries: [
      { id: 'wt_a', projectId: 'p1', status: 'active', branch: 'feat/x', path: '/tmp/a', agentId: 'agent-a', packageId: 'BLOCK-335' },
      { id: 'wt_b', projectId: 'p2', status: 'active', branch: 'feat/y', path: '/tmp/b', agentId: 'agent-b', packageId: 'BLOCK-337' },
      // 同项目内的目录冲突条目：路径比对按项目隔离（跨项目同路径不算冲突）
      { id: 'wt_p', projectId: 'p1', status: 'active', branch: 'feat/p', path: '/tmp/c', agentId: 'agent-p', packageId: 'BLOCK-998' },
      { id: 'wt_c', projectId: 'p1', status: 'removed', branch: 'feat/x', path: '/tmp/a', agentId: 'agent-a', packageId: 'BLOCK-335' },
    ],
  };
  const sameBranch = contract.checkContract(registry, { projectId: 'p1', branch: 'feat/x', dir: '/tmp/new' });
  assert.equal(sameBranch.ok, false);
  assert.deepEqual(sameBranch.violations.map((v) => v.rule), ['one_branch_one_worktree']);

  const all = contract.checkContract(registry, { projectId: 'p1', branch: 'feat/x', dir: '/tmp/c', agentId: 'agent-a', packageId: 'BLOCK-337' });
  assert.equal(all.ok, false);
  assert.deepEqual(
    all.violations.map((v) => v.rule).sort(),
    ['one_agent_one_worktree', 'one_branch_one_worktree', 'one_package_one_worktree', 'one_path_one_worktree']
  );

  // 已移除条目不再占位：同一分支/包可重建
  const removedOnly = contract.checkContract(
    { version: 1, entries: [{ id: 'wt_c', projectId: 'p1', status: 'removed', branch: 'feat/x', path: '/tmp/a', agentId: 'agent-a', packageId: 'BLOCK-335' }] },
    { projectId: 'p1', branch: 'feat/x', dir: '/tmp/a', agentId: 'agent-a', packageId: 'BLOCK-335' }
  );
  assert.equal(removedOnly.ok, true);
});

test('BLOCK-336 §5 端口偏移约定（derivePortBase）：默认 3101、步长 10、非法 env 回落', () => {
  assert.deepEqual(contract.derivePortBase({}, 0), { backend: 3101, renderer: 3102, stride: 10, base: 3101 });
  assert.deepEqual(contract.derivePortBase({}, 3), { backend: 3131, renderer: 3132, stride: 10, base: 3101 });
  assert.equal(contract.derivePortBase({ PETRI_WORKTREE_PORT_BASE: '4200' }, 1).backend, 4210);
  assert.equal(contract.derivePortBase({ PETRI_WORKTREE_PORT_BASE: 'abc' }, 1).base, 3101);
  assert.equal(contract.derivePortBase({ PETRI_WORKTREE_PORT_BASE: '80' }, 1).base, 3101);
  assert.equal(contract.derivePortBase({}, -1).backend, 3101);
});

test('BLOCK-336 §7 脏树判定（parsePorcelain）：ahead/behind/修改/未跟踪', () => {
  const text = [
    '## main...origin/main [ahead 2, behind 1]',
    ' M src/a.js',
    '?? docs/new.md',
  ].join('\n');
  const parsed = contract.parsePorcelain(text);
  assert.equal(parsed.branch, 'main');
  assert.equal(parsed.upstream, 'origin/main');
  assert.equal(parsed.ahead, 2);
  assert.equal(parsed.behind, 1);
  assert.deepEqual(parsed.modified, ['src/a.js']);
  assert.deepEqual(parsed.untracked, ['docs/new.md']);
  assert.equal(parsed.dirty, true);

  const clean = contract.parsePorcelain('## feat/x\n');
  assert.equal(clean.dirty, false);
  assert.equal(clean.ahead, 0);
  assert.equal(clean.branch, 'feat/x');
});

test('BLOCK-336 §8 登记表单源：缺失=空表、写入可回读、损坏 fail-closed', () => {
  const dataDir = tempDataDir();
  const empty = contract.loadRegistry(dataDir);
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.version, contract.REGISTRY_VERSION);

  const registry = { version: contract.REGISTRY_VERSION, entries: [] };
  registry.entries.push({ id: 'wt_1', projectId: 'p1', status: 'active', branch: 'feat/x', path: '/tmp/a' });
  contract.saveRegistry(dataDir, registry);
  const reloaded = contract.loadRegistry(dataDir);
  assert.equal(reloaded.entries.length, 1);
  assert.equal(reloaded.entries[0].branch, 'feat/x');

  fssync.writeFileSync(contract.registryPath(dataDir), '{ not json');
  assert.throws(
    () => contract.loadRegistry(dataDir),
    (error) => error.code === 'worktree_registry_corrupt'
  );

  contract.appendAudit(dataDir, { action: 'create', worktreeId: 'wt_1' });
  const lines = fssync.readFileSync(contract.auditPath(dataDir), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).action, 'create');
  assert.ok(JSON.parse(lines[0]).at);
});

// ---------------------------------------------------------------------------
// 工具面四件（真 git 临时仓，不经 DB）
// ---------------------------------------------------------------------------

test('BLOCK-336 工具面：create 建目录+登记+审计，list 对账，remove 保护脏树，清理后分支保留', async () => {
  const repoDir = makeRepo();
  const dataDir = tempDataDir();
  const core = makeCore(repoDir, dataDir);

  const created = await tools.createWorktree(core, { branch: 'feat/x', packageId: 'BLOCK-335', note: '契约测试' });
  assert.equal(created.ok, true, JSON.stringify(created));
  const entry = created.worktree;
  assert.equal(entry.branch, 'feat/x');
  assert.equal(entry.status, 'active');
  assert.equal(entry.packageId, 'BLOCK-335');
  assert.equal(entry.agentId, 'agent-a');
  assert.ok(fssync.existsSync(entry.path), 'worktree 目录应已创建');
  assert.equal(entry.ports.base, 3101);
  assert.equal(entry.ports.backend, 3101);
  assert.deepEqual(contract.loadRegistry(dataDir).entries.map((e) => e.id), [entry.id]);

  const listed = await tools.listWorktrees(core);
  assert.equal(listed.ok, true);
  assert.equal(listed.total, 1);
  assert.equal(listed.worktrees[0].exists, true);
  assert.equal(listed.worktrees[0].dirty, false);
  assert.equal(listed.worktrees[0].gitKnown, true);
  assert.equal(listed.worktrees[0].ahead, 0);

  // 在副本里造脏树 → list 必须看见，remove 必须拒绝并列出文件
  fssync.writeFileSync(path.join(entry.path, 'dirty.txt'), 'dirty\n');
  const listedDirty = await tools.listWorktrees(core);
  assert.equal(listedDirty.worktrees[0].dirty, true);
  assert.ok(listedDirty.worktrees[0].untracked.includes('dirty.txt'));

  const refused = await tools.removeWorktree(core, { id: entry.id });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'worktree_dirty');
  assert.ok(refused.untracked.includes('dirty.txt'));
  assert.ok(fssync.existsSync(entry.path), '脏树不得被删除');

  // 清理后再删：目录消失、分支保留、登记转 removed
  fssync.rmSync(path.join(entry.path, 'dirty.txt'));
  const removed = await tools.removeWorktree(core, { id: entry.id });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.equal(fssync.existsSync(entry.path), false);
  assert.equal(git(['branch', '--list', 'feat/x'], repoDir).includes('feat/x'), true, '分支必须保留');
  const afterRemove = contract.loadRegistry(dataDir).entries[0];
  assert.equal(afterRemove.status, 'removed');
  assert.ok(afterRemove.removedAt);
});

test('BLOCK-336 工具面：§4 契约拒绝重复分支/重复包，§6 merge_request 只出摘要绝不 merge', async () => {
  const repoDir = makeRepo();
  const dataDir = tempDataDir();
  const core = makeCore(repoDir, dataDir);

  const first = await tools.createWorktree(core, { branch: 'feat/a', packageId: 'BLOCK-335' });
  assert.equal(first.ok, true, JSON.stringify(first));

  const sameBranch = await tools.createWorktree(core, { branch: 'feat/a', packageId: 'BLOCK-336' });
  assert.equal(sameBranch.ok, false);
  assert.equal(sameBranch.error, 'worktree_contract_violation');
  // 同分支必然同派生目录、同 agent → 契约一次报全（不短路）是预期行为
  assert.ok(sameBranch.violations.some((v) => v.rule === 'one_branch_one_worktree'));
  assert.ok(sameBranch.violations.some((v) => v.rule === 'one_path_one_worktree'));

  const samePackage = await tools.createWorktree(core, { branch: 'feat/b', packageId: 'BLOCK-335' });
  assert.equal(samePackage.ok, false);
  assert.equal(samePackage.error, 'worktree_contract_violation');
  assert.ok(samePackage.violations.some((v) => v.rule === 'one_package_one_worktree'));
  assert.equal(fssync.existsSync(contract.worktreeDirFor(dataDir, 'proj-336', 'feat/b')), false, '违规时不得留下目录');

  // 在副本内产生一个提交 → merge_request 必须看见 ahead=1 且 merged=false
  const wtPath = first.worktree.path;
  fssync.writeFileSync(path.join(wtPath, 'feature.txt'), 'feature\n');
  git(['add', '.'], wtPath);
  git(['commit', '-q', '-m', 'feat: add feature'], wtPath);

  const headBefore = git(['rev-parse', 'HEAD'], repoDir);
  const request = await tools.mergeRequest(core, { id: first.worktree.id });
  assert.equal(request.ok, true, JSON.stringify(request));
  assert.equal(request.mergeRequest.merged, false);
  assert.equal(request.mergeRequest.ahead, 1);
  assert.ok(request.mergeRequest.commits.some((line) => line.includes('add feature')));
  assert.ok(request.mergeRequest.files.some((f) => f.path === 'feature.txt'));
  assert.equal(git(['rev-parse', 'HEAD'], repoDir), headBefore, 'merge_request 不得改动主仓 HEAD');
  assert.equal(contract.loadRegistry(dataDir).entries[0].mergeRequests.length, 1);

  // §7：有未合并提交时 remove 拒绝；显式 allowUnmergedAhead 才只删目录（分支保留）
  const blocked = await tools.removeWorktree(core, { id: first.worktree.id });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'worktree_unmerged_ahead');
  assert.equal(blocked.ahead, 1);

  const forced = await tools.removeWorktree(core, { id: first.worktree.id, allowUnmergedAhead: true });
  assert.equal(forced.ok, true, JSON.stringify(forced));
  assert.equal(fssync.existsSync(wtPath), false);
  assert.equal(git(['branch', '--list', 'feat/a'], repoDir).includes('feat/a'), true);
  assert.equal(contract.loadRegistry(dataDir).entries[0].removedWithUnmergedAhead, true);
});

test('BLOCK-336 工具面：目录被外部删除时只收登记并 prune，不假装 git 成功', async () => {
  const repoDir = makeRepo();
  const dataDir = tempDataDir();
  const core = makeCore(repoDir, dataDir);

  const created = await tools.createWorktree(core, { branch: 'feat/gone' });
  assert.equal(created.ok, true, JSON.stringify(created));
  fssync.rmSync(created.worktree.path, { recursive: true, force: true });

  const listed = await tools.listWorktrees(core);
  assert.equal(listed.worktrees[0].exists, false);
  assert.equal(listed.worktrees[0].gitKnown, false);

  const removed = await tools.removeWorktree(core, { id: created.worktree.id });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.equal(removed.note.includes('目录已不存在'), true);
  const entry = contract.loadRegistry(dataDir).entries[0];
  assert.equal(entry.status, 'removed');
  assert.equal(entry.removedReason, 'dir_missing');
});

test('BLOCK-336 工具面：非 git 工作区与参数缺失如实 fail-closed', async () => {
  const dataDir = tempDataDir();
  const plainDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b336-plain-'));
  const core = makeCore(plainDir, dataDir);

  const notRepo = await tools.createWorktree(core, { branch: 'feat/x' });
  assert.equal(notRepo.ok, false);
  assert.equal(notRepo.error, 'not_a_git_repository');

  const repoDir = makeRepo();
  const repoCore = makeCore(repoDir, dataDir);

  // 参数校验发生在 git 前置之后（先验仓再验引用），故在真 git 仓上断言
  const noRef = await tools.removeWorktree(repoCore, {});
  assert.equal(noRef.ok, false);
  assert.equal(noRef.error, 'worktree_ref_required');

  const missing = await tools.mergeRequest(repoCore, { branch: 'feat/none' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'worktree_not_found');

  const badBranch = await tools.createWorktree(repoCore, { branch: '-rf' });
  assert.equal(badBranch.ok, false);
  assert.equal(badBranch.error, 'branch_invalid');
});
