/**
 * G0-RS1 — Git Adapter 与 Repository Binding 门禁。
 *
 * 覆盖 g0-result-studio-plan.md §14 G0-RS1 的五条验收：
 * 1. 不使用 `git add .` / `git add -A`
 * 2. 不触碰无关用户 WIP
 * 3. 非 Git 项目可创建真实 commit 并恢复
 * 4. 已有 dirty Git 项目只修改显式目标
 * 5. Git 不可用时诚实阻断
 *
 * 全部使用临时目录中的真实 git 仓库；不访问网络、不读用户数据、不触碰 BioF3 仓库自身。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  GIT_ADAPTER_VERSION,
  GitAdapterError,
  assertSafePathspecs,
  createGitAdapter,
  detectGitRuntime,
  parseGitVersion,
  redactGitDiagnostic,
} = require('../core/shared-backend/git-adapter');
const {
  BIOF3_DIR,
  MANAGED_RELATIVE_PATHS,
  bindProjectRepository,
  inspectWorkspaceGit,
  resolveBiof3MetadataLayout,
} = require('../core/shared-backend/git-repository-binding');

const runtime = detectGitRuntime();
const gitReady = runtime.available && runtime.meetsMinimum;

function makeWorkspace(context, prefix = 'biof3-rs1-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function initUserRepository(root) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  execFileSync('git', ['init', '--quiet'], { cwd: root, env });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, env });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, env });
  writeFileSync(join(root, 'README.md'), '# user project\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root, env });
  execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root, env });
}

function writeManagedScript(root, relative, content) {
  const target = join(root, relative);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
  return target;
}

/**
 * 断言抛出的是带指定 `code` 的 GitAdapterError。
 *
 * 不能用 `assert.throws(fn, /code/)`：那个正则只匹配 error.message，
 * 而本模块的稳定契约是 error.code。
 */
function throwsWithCode(fn, expectedCode) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof GitAdapterError, `expected GitAdapterError, got ${error?.name}`);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 1. 整树写法与 pathspec 注入
// ---------------------------------------------------------------------------

test('RS1 rejects whole-tree and option-like pathspecs', () => {
  const forbidden = ['.', './', '-A', '--all', '-u', '--update', '*', ':', ':/'];
  for (const candidate of forbidden) {
    assert.throws(
      () => assertSafePathspecs([candidate]),
      (error) => error instanceof GitAdapterError && /forbidden|option_like|magic/.test(error.code),
      `expected ${candidate} to be rejected`
    );
  }
  throwsWithCode(() => assertSafePathspecs([]), 'pathspec_required');
  throwsWithCode(() => assertSafePathspecs(['../escape']), 'pathspec_traversal');
  throwsWithCode(() => assertSafePathspecs(['a/../../b']), 'pathspec_traversal');
  throwsWithCode(() => assertSafePathspecs(['bad\0name']), 'pathspec_invalid');
  throwsWithCode(() => assertSafePathspecs(['']), 'pathspec_invalid');
});

test('RS1 normalizes safe pathspecs and deduplicates', () => {
  assert.deepEqual(
    assertSafePathspecs(['analysis/scripts/a.R', './analysis/scripts/a.R', 'analysis/workflows']),
    ['analysis/scripts/a.R', 'analysis/workflows']
  );
});

test('RS1 confines absolute pathspecs to the work tree', (context) => {
  const root = makeWorkspace(context);
  assert.deepEqual(
    assertSafePathspecs([join(root, 'analysis/scripts/x.R')], { workTree: root }),
    ['analysis/scripts/x.R']
  );
  throwsWithCode(
    () => assertSafePathspecs(['/etc/passwd'], { workTree: root }),
    'pathspec_outside_worktree'
  );
  throwsWithCode(
    () => assertSafePathspecs([root], { workTree: root }),
    'pathspec_whole_tree_forbidden'
  );
});

// ---------------------------------------------------------------------------
// 2. runtime 检测与脱敏
// ---------------------------------------------------------------------------

test('RS1 parses git version and reports minimum compliance', () => {
  assert.deepEqual(parseGitVersion('git version 2.50.1 (Apple Git-155)'), { major: 2, minor: 50, patch: 1 });
  assert.deepEqual(parseGitVersion('git version 2.20'), { major: 2, minor: 20, patch: 0 });
  assert.equal(parseGitVersion('not a version'), null);
});

test('RS1 blocks honestly when git is unavailable', (context) => {
  const root = makeWorkspace(context);
  const probe = detectGitRuntime({ gitBin: join(root, 'definitely-not-git') });
  assert.equal(probe.available, false);
  assert.equal(probe.reason, 'git_executable_not_found');

  const binding = bindProjectRepository({
    workspaceRoot: root,
    projectId: 'project_1',
    gitBin: join(root, 'definitely-not-git'),
  });
  assert.equal(binding.status, 'blocked_git_unavailable');
  // UI-462 后 managed-only：唯一模式在 base 上恒定，阻断返回也携带 'managed'
  assert.equal(binding.mode, 'managed');
  assert.equal(binding.adapter, null);
  // 诚实阻断：绝不因 git 缺失而假装可以编辑。
  assert.equal(existsSync(join(root, BIOF3_DIR, 'git', 'HEAD')), false);
});

test('RS1 preserves process-level diagnostics for a failed Git invocation', (context) => {
  const root = makeWorkspace(context);
  const missingGit = join(root, 'definitely-not-git');
  const adapter = createGitAdapter({
    gitDir: join(root, '.biof3/git'),
    workTree: root,
    gitBin: missingGit,
  });
  const failure = adapter.run(['hash-object', '-w', '--stdin'], {
    allowFailure: true,
    input: 'diagnostic',
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.command, 'hash-object');
  assert.equal(failure.code, 'git_executable_not_found');
  assert.equal(failure.systemCode, 'ENOENT');
  assert.equal(failure.status, null);
});

test('RS1 redacts absolute paths and credential-like values from diagnostics', () => {
  const redacted = redactGitDiagnostic(
    'fatal: cannot open /tmp/ws/secret.txt token sk-abcdefghijklmnopqrstuvwxyz123456',
    { workTree: '/tmp/ws' }
  );
  assert.equal(redacted.includes('/tmp/ws'), false);
  assert.equal(redacted.includes('sk-abcdefghijklmnopqrstuvwxyz123456'), false);
  assert.equal(redacted.includes('<workspace>'), true);
  assert.equal(redacted.includes('<redacted>'), true);
});

test('RS1 blocks when the workspace does not exist', (context) => {
  const root = makeWorkspace(context);
  const binding = bindProjectRepository({
    workspaceRoot: join(root, 'no-such-dir'),
    projectId: 'project_1',
  });
  assert.equal(binding.status, 'blocked_workspace_invalid');
  assert.equal(binding.reason, 'workspace_missing');
});

// ---------------------------------------------------------------------------
// 3. 非 Git 项目：托管仓库、真实 commit 与恢复
// ---------------------------------------------------------------------------

test('RS1 metadata layout stays anchored under the workspace', (context) => {
  const root = makeWorkspace(context);
  const layout = resolveBiof3MetadataLayout(root);
  assert.equal(layout.biof3Dir, join(root, '.biof3'));
  assert.equal(layout.managedGitDir, join(root, '.biof3', 'git'));
  for (const dir of [layout.revisionDir, layout.checkpointDir, layout.objectsDir]) {
    assert.equal(dir.startsWith(root), true);
  }
});

test('RS1 inspects a non-git workspace without writing anything', (context) => {
  const root = makeWorkspace(context);
  const inspection = inspectWorkspaceGit({ workspaceRoot: root });
  assert.equal(inspection.workspaceExists, true);
  assert.equal(inspection.managed.exists, false);
  assert.equal(existsSync(join(root, '.git')), false);
  assert.equal(existsSync(join(root, BIOF3_DIR)), false);
});

test('RS1 creates a managed repository and never git-inits the user directory', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  const binding = bindProjectRepository({ workspaceRoot: root, projectId: 'project_managed' });

  assert.equal(binding.status, 'ready');
  assert.equal(binding.mode, 'managed');
  assert.equal(binding.gitAdapterVersion, GIT_ADAPTER_VERSION);
  // 托管：git 元数据在 .biof3/git，用户目录不出现 .git
  assert.equal(existsSync(join(root, BIOF3_DIR, 'git', 'HEAD')), true);
  assert.equal(existsSync(join(root, '.git')), false);
  assert.equal(binding.repositoryState.unborn, true);
  assert.deepEqual(binding.managedPaths, [...MANAGED_RELATIVE_PATHS]);
});

test('RS1 commits and restores real content in a managed repository', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  const binding = bindProjectRepository({ workspaceRoot: root, projectId: 'project_managed' });
  const adapter = binding.adapter;

  writeManagedScript(root, 'analysis/scripts/plot_volcano.R', 'palette <- "v1"\n');
  const first = adapter.commit({
    message: 'RS1 test: v1',
    paths: ['analysis/scripts/plot_volcano.R'],
  });
  assert.match(first.commit, /^[0-9a-f]{40}$/);

  writeManagedScript(root, 'analysis/scripts/plot_volcano.R', 'palette <- "v2"\n');
  const second = adapter.commit({
    message: 'RS1 test: v2',
    paths: ['analysis/scripts/plot_volcano.R'],
  });
  assert.match(second.commit, /^[0-9a-f]{40}$/);
  assert.notEqual(first.commit, second.commit);

  // 恢复：历史版本内容可从 Git 读回，这是 ChangeSet revert/restore 的基础。
  assert.equal(adapter.showFile({ ref: first.commit, filePath: 'analysis/scripts/plot_volcano.R' }), 'palette <- "v1"\n');
  assert.equal(adapter.showFile({ ref: second.commit, filePath: 'analysis/scripts/plot_volcano.R' }), 'palette <- "v2"\n');
  assert.equal(adapter.revParse(second.commit), second.commit);
  assert.equal(adapter.revParse('refs/heads/does-not-exist'), null);

  const diff = adapter.diff({
    paths: ['analysis/scripts/plot_volcano.R'],
    fromRef: first.commit,
    toRef: second.commit,
  });
  assert.equal(diff.patch.includes('-palette <- "v1"'), true);
  assert.equal(diff.patch.includes('+palette <- "v2"'), true);
});

test('RS1 managed commits ignore files outside the given pathspecs', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  const binding = bindProjectRepository({ workspaceRoot: root, projectId: 'project_managed' });
  const adapter = binding.adapter;

  writeManagedScript(root, 'analysis/scripts/wanted.R', 'wanted\n');
  writeManagedScript(root, 'analysis/scripts/unwanted.R', 'unwanted\n');
  // 科学产物：绝不能被 Git 吞进去
  writeManagedScript(root, 'results/jobs/job_1/output/big.csv', 'a,b\n1,2\n');

  adapter.commit({ message: 'RS1 test: only wanted', paths: ['analysis/scripts/wanted.R'] });

  const tracked = adapter.listTrackedFiles({ paths: ['analysis'] });
  assert.deepEqual(tracked, ['analysis/scripts/wanted.R']);
  assert.equal(adapter.showFile({ ref: 'HEAD', filePath: 'analysis/scripts/unwanted.R' }), null);
  assert.equal(adapter.showFile({ ref: 'HEAD', filePath: 'results/jobs/job_1/output/big.csv' }), null);
});

test('RS1 creates isolation branches for change sets', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  const binding = bindProjectRepository({ workspaceRoot: root, projectId: 'project_managed' });
  const adapter = binding.adapter;
  writeManagedScript(root, 'analysis/scripts/base.R', 'base\n');
  const base = adapter.commit({ message: 'RS1 test: base', paths: ['analysis/scripts/base.R'] });

  adapter.createBranch({ name: 'biof3/changeset/cs_1', startPoint: base.commit });
  assert.equal(adapter.revParse('refs/heads/biof3/changeset/cs_1'), base.commit);
  throwsWithCode(() => adapter.createBranch({ name: '--dangerous' }), 'branch_name_invalid');
});

test('RS5 creates an isolated virtual commit without touching the work tree', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  const binding = bindProjectRepository({ workspaceRoot: root, projectId: 'project_rs5_virtual' });
  const adapter = binding.adapter;
  writeManagedScript(root, 'analysis/scripts/base.R', 'base\n');
  const base = adapter.commit({ message: 'RS5 base', paths: ['analysis/scripts/base.R'] });
  const ref = 'refs/heads/biof3/changeset/cs_virtual';
  const candidate = adapter.commitVirtualFiles({
    parentCommit: base.commit,
    ref,
    expectedOld: '0'.repeat(40),
    message: 'RS5 isolated candidate',
    files: [
      { path: 'analysis/scripts/volcano/rev_2/volcano_plot.R', content: 'palette <- "blue"\n' },
      { path: 'analysis/scripts/volcano/rev_2/parameters.json', content: '{"palette":"blue"}\n' },
    ],
  });
  assert.match(candidate.commit, /^[a-f0-9]{40}$/);
  assert.equal(adapter.revParse(ref), candidate.commit);
  assert.equal(
    adapter.showFile({ ref, filePath: 'analysis/scripts/volcano/rev_2/volcano_plot.R' }),
    'palette <- "blue"\n'
  );
  assert.equal(existsSync(join(root, 'analysis/scripts/volcano/rev_2/volcano_plot.R')), false);
  assert.equal(readFileSync(join(root, 'analysis/scripts/base.R'), 'utf8'), 'base\n');
});

test('RS5 virtual ref update fails closed on a concurrent ref change', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  const binding = bindProjectRepository({ workspaceRoot: root, projectId: 'project_rs5_race' });
  const adapter = binding.adapter;
  const ref = 'refs/heads/biof3/changeset/cs_race';
  const first = adapter.commitVirtualFiles({
    ref,
    expectedOld: '0'.repeat(40),
    message: 'first',
    files: [{ path: 'analysis/scripts/race/first.R', content: 'first\n' }],
  });
  assert.match(first.commit, /^[a-f0-9]{40}$/);
  throwsWithCode(() => adapter.commitVirtualFiles({
    parentCommit: first.commit,
    ref,
    expectedOld: '0'.repeat(40),
    message: 'stale writer',
    files: [{ path: 'analysis/scripts/race/second.R', content: 'second\n' }],
  }), 'git_ref_conflict');
  assert.equal(adapter.revParse(ref), first.commit);
});

test('P6 atomic ref cohorts never expose a partially updated family set', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  const adapter = bindProjectRepository({ workspaceRoot: root, projectId: 'project_p6_ref_cohort' }).adapter;
  const first = adapter.commitVirtualFiles({
    ref: 'refs/heads/biof3/main',
    expectedOld: '0'.repeat(40),
    message: 'P6 ref cohort base',
    files: [{ path: 'analysis/scripts/ref-cohort/base.R', content: 'version <- 1\n' }],
  });
  const second = adapter.commitVirtualFiles({
    parentCommit: first.commit,
    ref: 'refs/heads/biof3/changeset/ref-cohort',
    expectedOld: '0'.repeat(40),
    message: 'P6 ref cohort candidate',
    files: [{ path: 'analysis/scripts/ref-cohort/candidate.R', content: 'version <- 2\n' }],
  });
  const familyA = 'refs/heads/biof3/current/family-a';
  const familyB = 'refs/heads/biof3/current/family-b';
  adapter.updateRefsCas({ updates: [
    { ref: familyA, expectedOld: '0'.repeat(40), newOid: first.commit },
    { ref: familyB, expectedOld: '0'.repeat(40), newOid: first.commit },
  ] });
  adapter.updateRefsCas({ updates: [
    { ref: familyA, expectedOld: first.commit, newOid: second.commit },
    { ref: familyB, expectedOld: first.commit, newOid: second.commit },
  ] });
  assert.equal(adapter.revParse(familyA), second.commit);
  assert.equal(adapter.revParse(familyB), second.commit);

  assert.throws(
    () => adapter.updateRefsCas({ updates: [
      { ref: familyA, expectedOld: second.commit, newOid: first.commit },
      { ref: familyB, expectedOld: first.commit, newOid: second.commit },
    ] }),
    (error) => error instanceof GitAdapterError && error.code === 'git_ref_transaction_conflict',
  );
  assert.equal(adapter.revParse(familyA), second.commit);
  assert.equal(adapter.revParse(familyB), second.commit);
});

// ---------------------------------------------------------------------------
// 4. managed-only 绑定：用户自有仓库零接触（UI-462 退役裁决）
// ---------------------------------------------------------------------------

test('RS1 binds a workspace inside a user repository as managed and never touches it', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  initUserRepository(root);
  // 用户自己的仓库里有未提交改动与未跟踪文件
  writeFileSync(join(root, 'README.md'), '# user project\nlocal edit\n');
  writeFileSync(join(root, 'notes.txt'), 'private notes\n');
  const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  const binding = bindProjectRepository({ workspaceRoot: root, projectId: 'project_managed' });

  // 绑定恒为 managed：托管仓库建在 .biof3/git，用户仓库不被二次 git-init、
  // 不产生 biof3 分支、HEAD 与 WIP 原样保留
  assert.equal(binding.status, 'ready');
  assert.equal(binding.mode, 'managed');
  assert.equal(existsSync(join(root, BIOF3_DIR, 'git', 'HEAD')), true);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), headBefore);
  assert.equal(execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/heads/biof3'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(), '');
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# user project\nlocal edit\n');
  assert.equal(readFileSync(join(root, 'notes.txt'), 'utf8'), 'private notes\n');

  // RS 只向托管仓库提交自己的路径；用户仓库的状态前后零变化
  writeManagedScript(root, 'analysis/scripts/plot_volcano.R', 'palette <- "v1"\n');
  const userStatusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  binding.adapter.commit({ message: 'RS1 test: managed only', paths: ['analysis/scripts/plot_volcano.R'] });
  const userStatusAfter = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  assert.equal(userStatusAfter, userStatusBefore);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), headBefore);
});

test('RS1 blocks when the managed repository is mid-operation or index-locked', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  const first = bindProjectRepository({ workspaceRoot: root, projectId: 'project_managed' });
  assert.equal(first.status, 'ready');
  const managedGitDir = join(root, BIOF3_DIR, 'git');

  writeFileSync(join(managedGitDir, 'index.lock'), '');
  const locked = bindProjectRepository({ workspaceRoot: root, projectId: 'project_managed' });
  assert.equal(locked.status, 'blocked_repository_state');
  assert.equal(locked.reason, 'index_lock_present');
  rmSync(join(managedGitDir, 'index.lock'));

  writeFileSync(join(managedGitDir, 'MERGE_HEAD'), '0'.repeat(40));
  const merging = bindProjectRepository({ workspaceRoot: root, projectId: 'project_managed' });
  assert.equal(merging.status, 'blocked_repository_state');
  assert.equal(merging.reason, 'repository_mid_operation');
});

test('RS1 refuses to create a managed repository when creation is disabled', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  const binding = bindProjectRepository({
    workspaceRoot: root,
    projectId: 'project_managed',
    createManagedIfMissing: false,
  });
  assert.equal(binding.status, 'blocked_repository_state');
  assert.equal(binding.reason, 'managed_repository_absent');
  assert.equal(existsSync(join(root, BIOF3_DIR, 'git', 'HEAD')), false);
});

// ---------------------------------------------------------------------------
// 5. 不变量回归
// ---------------------------------------------------------------------------

test('RS1 adapter requires gitDir and workTree', () => {
  throwsWithCode(() => createGitAdapter({ workTree: '/tmp' }), 'git_dir_required');
  throwsWithCode(() => createGitAdapter({ gitDir: '/tmp/.git' }), 'work_tree_required');
});

test('RS1 commit requires a message and explicit paths', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  const binding = bindProjectRepository({ workspaceRoot: root, projectId: 'project_managed' });
  writeManagedScript(root, 'analysis/scripts/a.R', 'a\n');
  throwsWithCode(() => binding.adapter.commit({ paths: ['analysis/scripts/a.R'] }), 'commit_message_required');
  throwsWithCode(() => binding.adapter.commit({ message: 'x', paths: ['.'] }), 'pathspec_whole_tree_forbidden');
  throwsWithCode(() => binding.adapter.commit({ message: 'x', paths: [] }), 'pathspec_required');
});

test('RS1 managed repository disables hooks', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  const binding = bindProjectRepository({ workspaceRoot: root, projectId: 'project_managed' });
  const hooksPath = binding.adapter.run(['config', '--get', 'core.hooksPath'], { allowFailure: true, readOnly: true });
  // -c 覆写不落配置文件，但必须指向一个不存在的目录
  const configured = hooksPath.ok ? hooksPath.stdout.trim() : '';
  assert.equal(configured === '' || configured.includes('biof3-disabled-hooks'), true);
  assert.equal(existsSync(join(root, BIOF3_DIR, 'git', 'biof3-disabled-hooks')), false);
});

// ---------------------------------------------------------------------------
// BLOCK-20 — Code Review Panel 新增方法
// listModified / fileHeadContent / fileWorkTreeContent / splitSideDiff /
// revertFile / applyInverseHunk
// ---------------------------------------------------------------------------

test('BLOCK-20 listModified returns tracked and untracked entries', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context, 'biof3-b20-');
  initUserRepository(root);
  writeFileSync(join(root, 'new-file.txt'), 'untracked\n');
  writeFileSync(join(root, 'README.md'), '# user project v2\n');
  const adapter = createGitAdapter({
    gitDir: join(root, '.git'),
    workTree: root,
  });
  const result = adapter.listModified();
  assert.equal(result.ok, true);
  const paths = result.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['README.md', 'new-file.txt']);
  const readme = result.files.find((f) => f.path === 'README.md');
  assert.equal(readme.workTreeStatus, 'M'); // modified
  const newFile = result.files.find((f) => f.path === 'new-file.txt');
  assert.equal(newFile.status, '??');
});

test('BLOCK-20 fileHeadContent returns HEAD content for tracked files', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context, 'biof3-b20-');
  initUserRepository(root);
  const adapter = createGitAdapter({ gitDir: join(root, '.git'), workTree: root });
  const result = adapter.fileHeadContent({ path: 'README.md' });
  assert.equal(result.ok, true);
  assert.equal(result.content, '# user project\n');
});

test('BLOCK-20 fileHeadContent returns null for untracked files', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context, 'biof3-b20-');
  initUserRepository(root);
  writeFileSync(join(root, 'fresh.txt'), 'fresh\n');
  const adapter = createGitAdapter({ gitDir: join(root, '.git'), workTree: root });
  const result = adapter.fileHeadContent({ path: 'fresh.txt' });
  assert.equal(result.ok, true);
  assert.equal(result.content, null);
});

test('BLOCK-20 splitSideDiff returns unified diff + both contents', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context, 'biof3-b20-');
  initUserRepository(root);
  writeFileSync(join(root, 'README.md'), '# user project v2\n- new line\n');
  const adapter = createGitAdapter({ gitDir: join(root, '.git'), workTree: root });
  const result = adapter.splitSideDiff({ path: 'README.md' });
  assert.equal(result.ok, true);
  assert.equal(result.headContent, '# user project\n');
  assert.equal(result.workTreeContent, '# user project v2\n- new line\n');
  assert.ok(result.diff.startsWith('diff --git'), `expected unified diff header, got: ${result.diff.slice(0, 60)}`);
  assert.ok(result.diff.includes('-# user project'));
  assert.ok(result.diff.includes('+# user project v2'));
});

test('BLOCK-20 revertFile rolls back working tree to HEAD', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context, 'biof3-b20-');
  initUserRepository(root);
  writeFileSync(join(root, 'README.md'), '# MUTATED\n');
  const adapter = createGitAdapter({ gitDir: join(root, '.git'), workTree: root });
  const result = adapter.revertFile({ path: 'README.md' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reverted, ['README.md']);
  assert.equal(readFileSync(join(root, 'README.md'), 'utf-8'), '# user project\n');
});

test('BLOCK-20 applyInverseHunk validates input', () => {
  const adapter = createGitAdapter({
    gitDir: join(tmpdir(), '.git-empty'),
    workTree: tmpdir(),
  });
  throwsWithCode(() => adapter.applyInverseHunk({ patch: '' }), 'patch_required');
  throwsWithCode(() => adapter.applyInverseHunk({ patch: null }), 'patch_required');
});

test('BLOCK-20 applyInverseHunk rejects a real working-tree change', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context, 'biof3-b20-');
  initUserRepository(root);
  // 修改 README 的 line 1（让 git diff 输出 -old / +new hunk）
  writeFileSync(join(root, 'README.md'), '# user project MUTATED\n');
  const adapter = createGitAdapter({ gitDir: join(root, '.git'), workTree: root });
  const side = adapter.splitSideDiff({ path: 'README.md' });
  assert.ok(side.diff.length > 0, 'expected non-empty diff');
  assert.ok(side.diff.includes('-# user project'), `expected -line, diff was: ${side.diff}`);
  assert.ok(side.diff.includes('+# user project MUTATED'));
  // working tree 仍是修改后的状态
  assert.equal(readFileSync(join(root, 'README.md'), 'utf-8'), '# user project MUTATED\n');
  // 应用 inverse 把它撤回
  adapter.applyInverseHunk({ patch: side.diff });
  assert.equal(readFileSync(join(root, 'README.md'), 'utf-8'), '# user project\n');
});

test('BLOCK-20 listModified validates paths are safe', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context, 'biof3-b20-');
  initUserRepository(root);
  const adapter = createGitAdapter({ gitDir: join(root, '.git'), workTree: root });
  throwsWithCode(
    () => adapter.splitSideDiff({ path: '../escape.txt' }),
    'pathspec_traversal'
  );
  throwsWithCode(
    () => adapter.revertFile({ path: '' }),
    'pathspec_invalid'
  );
});

// UI-232 — 提交间区间 diff 不带 pathspec（有界只读）必须可用；
// 工作区 diff（无 ref）维持 pathspec 强制。此前 commitDiffParsed 传空路径被
// assertSafePathspecs 拒绝（pathspec_required），真实 IPC 链路所有提交差异恒为空，
// 前端误显示「该提交没有可显示的文件差异」。
test('UI-232 two-ref range diff works without pathspecs; working-tree diff stays strict', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context, 'biof3-ui232-');
  const gitDir = join(root, '.git');
  const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git(['init', '--quiet']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  writeFileSync(join(root, 'a.txt'), 'line-v1\n', 'utf8');
  git(['add', 'a.txt']);
  git(['commit', '--quiet', '-m', 'first']);
  const first = git(['rev-parse', 'HEAD']).trim();
  writeFileSync(join(root, 'a.txt'), 'line-v1\nline-v2\n', 'utf8');
  writeFileSync(join(root, 'b.txt'), 'new-file\n', 'utf8');
  git(['add', 'a.txt', 'b.txt']);
  git(['commit', '--quiet', '-m', 'second']);
  const second = git(['rev-parse', 'HEAD']).trim();

  const adapter = createGitAdapter({ gitDir, workTree: root });

  // 区间 diff（无 pathspec）— 此前抛 pathspec_required
  const range = adapter.diff({ fromRef: first, toRef: second });
  assert.ok(range.patch.includes('+line-v2'), 'expected +line-v2 in range patch');
  assert.ok(range.patch.includes('+new-file'), 'expected +new-file in range patch');

  // 工作区 diff（无 ref）维持整树禁令
  assert.throws(
    () => adapter.diff({}),
    (e) => e instanceof GitAdapterError && e.code === 'pathspec_required'
  );

  // UI-234 — log 附带 --shortstat 统计（默认可见，无需点开），message 不混入 stat 行
  const page = adapter.log({ limit: 10 });
  const firstEntry = page.commits.find((c) => c.subject === 'first');
  const secondEntry = page.commits.find((c) => c.subject === 'second');
  assert.ok(firstEntry && secondEntry, 'expected both fixture commits in log');
  assert.deepEqual(firstEntry.stats, { files: 1, added: 1, removed: 0 });
  assert.deepEqual(secondEntry.stats, { files: 2, added: 2, removed: 0 });
  assert.equal(secondEntry.message, '', 'stat line must not leak into message');
});
