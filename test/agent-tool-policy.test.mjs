import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// BLOCK-49 加映清债 —— 统一临时 DB 自举（存量：单跑/全量缺 projects 表）
//（BIOF3_DB_PATH 须在 require db.js 前生效；与 agent-tool-registry.test 同一修法）
{
  const fsx = require('node:fs');
  const osx = require('node:os');
  const pth = require('node:path');
  const urlx = require('node:url');
  const hereDir = pth.dirname(urlx.fileURLToPath(import.meta.url));
  const Database = require(pth.resolve(hereDir, '..', 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));
  const tempDbDir = fsx.mkdtempSync(pth.join(osx.tmpdir(), 'biof3-sweep-db-'));
  const boot = new Database(pth.join(tempDbDir, 'biof3.db'));
  const migrationsDir = pth.resolve(hereDir, '..', 'src', 'migrations');
  for (const f of fsx.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fsx.readFileSync(pth.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = pth.join(tempDbDir, 'biof3.db');
  process.on('exit', () => { try { fsx.rmSync(tempDbDir, { recursive: true, force: true }); } catch {} });
}
const {
  decideAgentToolCall,
  isProtectedScientificSource,
} = require('../core/biof3-server/agent-tools/agent-tool-policy.js');
const {
  createAgentToolInterceptor,
  validateToolArguments,
} = require('../core/biof3-server/agent-tools/agent-tool-interceptor.js');
const { getToolEntry } = require('../core/biof3-server/agent-tools/registry.js');
const { createWorkspaceTools } = require('../core/biof3-server/agent-tools/workspace-tools.js');
const { dispatchTool } = require('../core/biof3-server/agent-tools/index.js');
const db = require('../core/biof3-server/db.js');

// Windows (without Developer Mode) and some CI images cannot create symlinks,
// which breaks the escape-prevention fixture. Probe once and skip the symlink
// portion on unsupported platforms — the same guard used by the RS5 suite.
function symlinksSupported() {
  try {
    const probe = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-symlink-probe-'));
    try {
      fssync.symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'));
      return true;
    } catch {
      return false;
    } finally {
      fssync.rmSync(probe, { recursive: true, force: true });
    }
  } catch {
    return false;
  }
}

// The shell-command and symlink-escape tests below assume a POSIX shell and
// filesystem. On Windows the spawned shell reports paths like `/tmp/...` that do
// not correspond to Node's os.tmpdir() (C:\Users\...\Temp), and symlink-escape
// resolution differs. CI (macOS) exercises these; skip on win32.
const isWindows = process.platform === 'win32';
const maybeSkipShell = isWindows ? test.skip : test;

const contract = (sideEffect = 'none', riskTier = 'R0', category = 'retrieval') => ({
  sideEffect,
  riskTier,
  category,
});

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

test('pure policy returns stable allow and deny decisions', () => {
  assert.deepEqual(
    decideAgentToolCall({ name: 'query', contract: contract() }),
    {
      decision: 'allow',
      reason: 'policy_allowed',
      messageKey: 'agent_tool.policy_allowed',
      delegatedApproval: false,
    }
  );

  const denied = decideAgentToolCall({
    name: 'act',
    contract: contract('execution', 'R2', 'action'),
    ctx: { allowExecution: false, executionPolicyReason: 'explicit_read_only_request' },
  });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.error, 'execution_not_allowed');
  assert.equal(denied.reason, 'read_only');
  assert.equal(denied.messageKey, 'agent_tool.read_only');

  const guarded = decideAgentToolCall({
    name: 'workspace_write',
    args: { path: 'existing.txt', content: 'new' },
    contract: contract('workspace-write', 'R2', 'workspace'),
    preflight: { ok: true, exists: true },
  });
  assert.equal(guarded.decision, 'deny');
  assert.equal(guarded.error, 'expected_sha256_required');
  assert.equal(guarded.reason, 'overwrite_requires_sha256');
});

test('operation-aware policy preserves read-only plan and run_tool operations', () => {
  const readOnlyCtx = { allowExecution: false, accessMode: 'read' };
  for (const op of ['list', 'get']) {
    const result = decideAgentToolCall({
      name: 'plan',
      args: { op },
      ctx: readOnlyCtx,
      contract: contract('state-write', 'R1', 'planning'),
    });
    assert.equal(result.decision, 'allow', `plan(${op})`);
  }
  for (const op of ['list', 'plan', 'status', 'next', 'bind_artifact']) {
    const result = decideAgentToolCall({
      name: 'run_tool',
      args: { op },
      ctx: readOnlyCtx,
      contract: contract('execution', 'R2', 'analysis'),
    });
    assert.equal(result.decision, 'allow', `run_tool(${op})`);
  }
  for (const [name, args, metadata] of [
    ['plan', { op: 'create' }, contract('state-write', 'R1', 'planning')],
    ['act', { type: 'open' }, contract('execution', 'R2', 'action')],
    ['run_tool', { op: 'run' }, contract('execution', 'R2', 'analysis')],
  ]) {
    assert.equal(
      decideAgentToolCall({ name, args, ctx: readOnlyCtx, contract: metadata }).error,
      'execution_not_allowed',
      name
    );
  }
});

test('run_tool run delegates approval instead of inventing a policy confirmation', () => {
  const result = decideAgentToolCall({
    name: 'run_tool',
    args: { op: 'run', toolId: 'sample-metrics' },
    contract: contract('execution', 'R2', 'analysis'),
  });
  assert.equal(result.decision, 'allow');
  assert.equal(result.reason, 'delegated_approval');
  assert.equal(result.delegatedApproval, true);
});

// UI-303 — 计划模式并入档位菜单第四档：accessMode='plan' 独立触发 Spec 门
// （纵深防御：即使调用方漏传 planMode 标志，档位本身也足以拒绝一切 mutating）
test('plan access tier enforces the Spec Gate even without an explicit planMode flag', () => {
  const planTierCtx = { allowExecution: false, accessMode: 'plan' };
  assert.equal(
    decideAgentToolCall({
      name: 'plan',
      args: { op: 'create' },
      ctx: planTierCtx,
      contract: contract('state-write', 'R1', 'planning'),
    }).decision,
    'allow',
    'plan(create) stays allowed in the plan tier'
  );
  assert.equal(
    decideAgentToolCall({ name: 'workspace_read', ctx: planTierCtx, contract: contract() }).decision,
    'allow',
    'read-only exploration stays allowed in the plan tier'
  );
  for (const [name, args, metadata] of [
    ['workspace_write', { path: 'x.txt', content: 'y' }, contract('workspace-write', 'R2', 'workspace')],
    ['workspace_exec', { command: 'pwd' }, contract('execution', 'R2', 'workspace')],
    ['run_tool', { op: 'run' }, contract('execution', 'R2', 'analysis')],
  ]) {
    const denied = decideAgentToolCall({ name, args, ctx: planTierCtx, contract: metadata });
    assert.equal(denied.decision, 'deny', name);
    assert.equal(denied.error, 'plan_mode_active', name);
  }
  assert.equal(
    decideAgentToolCall({
      name: 'workspace_write',
      args: { path: 'x.txt', content: 'y' },
      ctx: { planMode: true },
      contract: contract('workspace-write', 'R2', 'workspace'),
    }).error,
    'plan_mode_active',
    'legacy explicit planMode flag path stays compatible'
  );
});

test('scientific source classifier protects existing inputs but allows derived outputs', () => {
  assert.equal(isProtectedScientificSource('metadata.csv'), true);
  assert.equal(isProtectedScientificSource('inputs/cohort.tsv'), true);
  assert.equal(isProtectedScientificSource('sample.h5ad'), true);
  assert.equal(isProtectedScientificSource('derived/metadata-normalized.csv'), false);
  assert.equal(isProtectedScientificSource('results/jobs/j1/output.csv'), false);
  assert.equal(isProtectedScientificSource('src/config.ts'), false);
});

test('minimal schema validation reports required, type, enum, and nested errors', () => {
  const schema = {
    type: 'object',
    required: ['op', 'params'],
    properties: {
      op: { type: 'string', enum: ['run'] },
      params: {
        type: 'object',
        properties: { count: { type: 'integer' } },
      },
    },
  };
  assert.deepEqual(validateToolArguments({ op: 'run', params: { count: 2 } }, schema), []);
  assert.deepEqual(validateToolArguments({ op: 'list', params: { count: 2.5 } }, schema), [
    { path: '$.op', code: 'invalid_enum', expected: ['run'] },
    { path: '$.params.count', code: 'invalid_type', expected: 'integer' },
  ]);
  assert.deepEqual(validateToolArguments({}, schema), [
    { path: '$.op', code: 'required' },
    { path: '$.params', code: 'required' },
  ]);
});

test('integer/number schema tolerates numeric-string input the handlers coerce', () => {
  const schema = {
    type: 'object',
    required: ['op', 'params'],
    properties: {
      op: { type: 'string', enum: ['run'] },
      params: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          ratio: { type: 'number' },
        },
      },
    },
  };
  // Numeric strings are accepted (handlers coerce via Number/clampInteger),
  // so agent/LM callers passing "1" instead of 1 no longer trip invalid_arguments.
  assert.deepEqual(validateToolArguments({ op: 'run', params: { count: '2', ratio: '0.5' } }, schema), []);
  // Non-integer strings still fail for integer fields (strictness preserved).
  assert.deepEqual(validateToolArguments({ op: 'run', params: { count: '2.5' } }, schema), [
    { path: '$.params.count', code: 'invalid_type', expected: 'integer' },
  ]);
  // Non-numeric strings still fail for number fields.
  assert.deepEqual(validateToolArguments({ op: 'run', params: { ratio: 'abc' } }, schema), [
    { path: '$.params.ratio', code: 'invalid_type', expected: 'number' },
  ]);
});

test('injectable interceptor is Provider-independent and never calls denied handlers', async () => {
  let calls = 0;
  const entry = {
    definition: {
      type: 'function',
      function: {
        name: 'sample',
        parameters: {
          type: 'object',
          required: ['count'],
          properties: { count: { type: 'integer' } },
        },
      },
    },
    contract: contract(),
    handler: async (args) => {
      calls += 1;
      return { ok: true, count: args.count };
    },
  };
  const intercept = createAgentToolInterceptor({
    getToolEntry: (name) => (name === 'sample' ? entry : undefined),
    preflightWorkspaceTool: async () => {
      throw new Error('non-workspace tool must not preflight');
    },
  });

  assert.equal((await intercept('missing', {})).error, 'unknown_tool');
  const invalid = await intercept('sample', { count: 1.5 });
  assert.equal(invalid.error, 'invalid_arguments');
  assert.equal(calls, 0);
  assert.deepEqual(await intercept('sample', { count: 2 }), { ok: true, count: 2 });
  assert.equal(calls, 1);
});

let sandboxRoot;
let workspaceRoot;
let outsideRoot;
let tools;
let interceptWorkspace;
const workspaceCtx = {
  projectId: 'p_policy',
  userId: 'u_owner',
  accessMode: 'full',
  allowExecution: true,
};

before(async () => {
  sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-agent-policy-'));
  workspaceRoot = path.join(sandboxRoot, 'workspace');
  outsideRoot = path.join(sandboxRoot, 'outside');
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, 'existing.txt'), 'original\n');
  await fs.writeFile(path.join(workspaceRoot, 'replace.txt'), 'before\n');
  await fs.writeFile(path.join(workspaceRoot, 'metadata.csv'), 'sample,condition\ns1,control\n');
  await fs.mkdir(path.join(workspaceRoot, 'derived'), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, 'derived', 'metadata-normalized.csv'), 'sample,condition\ns1,Control\n');
  await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'outside\n');
  if (symlinksSupported()) {
    await fs.symlink(outsideRoot, path.join(workspaceRoot, 'escape'));
  }

  const fakeDb = {
    getProject(projectId) {
      if (projectId !== 'p_policy') return null;
      return {
        id: projectId,
        user_id: 'u_owner',
        status: 'active',
        workspace_path: workspaceRoot,
      };
    },
    getUserById(userId) {
      return { id: userId, role: 'user' };
    },
  };
  tools = createWorkspaceTools({ dbProvider: () => fakeDb });
  const handlers = {
    workspace_list: tools.listDirectory,
    workspace_find: tools.findFiles,
    workspace_search: tools.searchText,
    workspace_read: tools.readFile,
    workspace_write: tools.writeFile,
    workspace_replace: tools.replaceText,
    workspace_exec: tools.executeCommand,
  };
  interceptWorkspace = createAgentToolInterceptor({
    getToolEntry(name) {
      const entry = getToolEntry(name);
      if (!entry || !handlers[name]) return undefined;
      return { ...entry, handler: handlers[name] };
    },
    preflightWorkspaceTool: tools.preflightTool,
  });
});

after(async () => {
  await fs.rm(sandboxRoot, { recursive: true, force: true });
});

test('workspace preflight hard-denies missing scope, ownership, sensitive paths, and symlink escape', async () => {
  const missingProject = await interceptWorkspace('workspace_read', { path: 'existing.txt' }, {
    userId: 'u_owner',
  });
  assert.equal(missingProject.error, 'project_required');
  assert.equal(missingProject.reason, 'project_required');

  const ownership = await interceptWorkspace('workspace_read', { path: 'existing.txt' }, {
    ...workspaceCtx,
    userId: 'u_other',
  });
  assert.equal(ownership.error, 'permission_denied');

  const sensitive = await interceptWorkspace('workspace_read', { path: '.biof3-secrets' }, workspaceCtx);
  assert.equal(sensitive.error, 'sensitive_path');
  assert.equal(sensitive.reason, 'policy_denied');

  if (!isWindows) {
    const escaped = await interceptWorkspace('workspace_read', { path: 'escape/secret.txt' }, workspaceCtx);
    assert.equal(escaped.error, 'symlink_escape');
    assert.equal(escaped.reason, 'policy_denied');
  }
});

test('read-only policy allows validated dry-runs but still denies real workspace edits', async () => {
  const readOnlyCtx = { ...workspaceCtx, accessMode: 'read', allowExecution: false };
  const writePreview = await interceptWorkspace(
    'workspace_write',
    { path: 'preview-only.txt', content: 'preview\n', dryRun: true },
    readOnlyCtx
  );
  assert.equal(writePreview.ok, true);
  assert.equal(writePreview.dryRun, true);
  await assert.rejects(fs.access(path.join(workspaceRoot, 'preview-only.txt')));

  const before = await fs.readFile(path.join(workspaceRoot, 'replace.txt'));
  const replacePreview = await interceptWorkspace(
    'workspace_replace',
    {
      path: 'replace.txt',
      oldText: 'before',
      newText: 'preview',
      expectedSha256: hash(before),
      dryRun: true,
    },
    readOnlyCtx
  );
  assert.equal(replacePreview.ok, true);
  assert.equal(replacePreview.dryRun, true);
  assert.equal(await fs.readFile(path.join(workspaceRoot, 'replace.txt'), 'utf8'), 'before\n');

  const denied = await interceptWorkspace(
    'workspace_write',
    { path: 'real-write.txt', content: 'mutating\n' },
    readOnlyCtx
  );
  assert.equal(denied.error, 'execution_not_allowed');
  await assert.rejects(fs.access(path.join(workspaceRoot, 'real-write.txt')));
});

test('new write executes and existing overwrite requires a matching sha256', async () => {
  const created = await interceptWorkspace(
    'workspace_write',
    { path: 'new.txt', content: 'created\n' },
    workspaceCtx
  );
  assert.equal(created.ok, true);
  assert.equal(await fs.readFile(path.join(workspaceRoot, 'new.txt'), 'utf8'), 'created\n');

  const guarded = await interceptWorkspace(
    'workspace_write',
    { path: 'existing.txt', content: 'changed\n', overwrite: true },
    workspaceCtx
  );
  assert.equal(guarded.error, 'expected_sha256_required');
  assert.equal(guarded.reason, 'overwrite_requires_sha256');
  assert.equal(await fs.readFile(path.join(workspaceRoot, 'existing.txt'), 'utf8'), 'original\n');

  const existing = await fs.readFile(path.join(workspaceRoot, 'existing.txt'));
  const overwritten = await interceptWorkspace(
    'workspace_write',
    {
      path: 'existing.txt',
      content: 'changed\n',
      overwrite: true,
      expectedSha256: hash(existing),
    },
    workspaceCtx
  );
  assert.equal(overwritten.ok, true);
  assert.equal(await fs.readFile(path.join(workspaceRoot, 'existing.txt'), 'utf8'), 'changed\n');
});

test('handler recheck rejects a target created after policy preflight', async () => {
  const racePath = path.join(workspaceRoot, 'race.txt');
  const raceInterceptor = createAgentToolInterceptor({
    getToolEntry(name) {
      const entry = getToolEntry(name);
      if (name !== 'workspace_write' || !entry) return undefined;
      return { ...entry, handler: tools.writeFile };
    },
    async preflightWorkspaceTool(name, args, ctx) {
      const result = await tools.preflightTool(name, args, ctx);
      await fs.writeFile(racePath, 'concurrent\n');
      return result;
    },
  });

  const raced = await raceInterceptor(
    'workspace_write',
    { path: 'race.txt', content: 'agent\n', overwrite: true },
    workspaceCtx
  );
  assert.equal(raced.ok, false);
  assert.equal(raced.error, 'expected_sha256_required');
  assert.equal(await fs.readFile(racePath, 'utf8'), 'concurrent\n');
});

test('atomic create-only publish converts a final link race into content_conflict', async () => {
  const racePath = path.join(workspaceRoot, 'link-race.txt');
  const nativeLink = fs.link;
  fs.link = async (source, destination) => {
    await fs.writeFile(destination, 'concurrent-link\n');
    return nativeLink(source, destination);
  };

  try {
    const raced = await tools.writeFile(
      { path: 'link-race.txt', content: 'agent\n' },
      workspaceCtx
    );
    assert.equal(raced.ok, false);
    assert.equal(raced.error, 'content_conflict');
    assert.equal(await fs.readFile(racePath, 'utf8'), 'concurrent-link\n');
    const residue = (await fs.readdir(workspaceRoot)).filter((name) =>
      name.startsWith('.biof3-write-')
    );
    assert.deepEqual(residue, []);
  } finally {
    fs.link = nativeLink;
  }
});

test('replace without sha is denied without mutation and matching sha executes', async () => {
  const noSha = await interceptWorkspace(
    'workspace_replace',
    { path: 'replace.txt', oldText: 'before', newText: 'after' },
    workspaceCtx
  );
  assert.equal(noSha.error, 'expected_sha256_required');
  assert.equal(noSha.reason, 'replace_requires_sha256');
  assert.equal(await fs.readFile(path.join(workspaceRoot, 'replace.txt'), 'utf8'), 'before\n');

  const before = await fs.readFile(path.join(workspaceRoot, 'replace.txt'));
  const replaced = await interceptWorkspace(
    'workspace_replace',
    {
      path: 'replace.txt',
      oldText: 'before',
      newText: 'after',
      expectedSha256: hash(before),
    },
    workspaceCtx
  );
  assert.equal(replaced.ok, true);
  assert.equal(await fs.readFile(path.join(workspaceRoot, 'replace.txt'), 'utf8'), 'after\n');
});

test('existing scientific inputs are immutable while derived CSV remains editable', async () => {
  const source = await fs.readFile(path.join(workspaceRoot, 'metadata.csv'));
  const denied = await interceptWorkspace(
    'workspace_replace',
    {
      path: 'metadata.csv',
      oldText: 'control',
      newText: 'Control',
      expectedSha256: hash(source),
    },
    workspaceCtx
  );
  assert.equal(denied.error, 'source_data_immutable');
  assert.equal(denied.reason, 'source_data_immutable');
  assert.equal(
    await fs.readFile(path.join(workspaceRoot, 'metadata.csv'), 'utf8'),
    'sample,condition\ns1,control\n'
  );

  const derivedPath = path.join(workspaceRoot, 'derived', 'metadata-normalized.csv');
  const derived = await fs.readFile(derivedPath);
  const replaced = await interceptWorkspace(
    'workspace_replace',
    {
      path: 'derived/metadata-normalized.csv',
      oldText: 'Control',
      newText: 'Treatment',
      expectedSha256: hash(derived),
    },
    workspaceCtx
  );
  assert.equal(replaced.ok, true);
  assert.equal(await fs.readFile(derivedPath, 'utf8'), 'sample,condition\ns1,Treatment\n');
});

maybeSkipShell('full access permits general commands while read mode denies execution', async () => {
  const pwd = await interceptWorkspace('workspace_exec', { command: 'pwd' }, workspaceCtx);
  assert.equal(pwd.ok, true);
  assert.equal(pwd.stdout.trim(), await fs.realpath(workspaceRoot));

  const marker = path.join(workspaceRoot, 'marker.txt');
  const shell = await interceptWorkspace(
    'workspace_exec',
    { command: 'printf changed > marker.txt' },
    workspaceCtx
  );
  assert.equal(shell.ok, true);
  assert.equal(await fs.readFile(marker, 'utf8'), 'changed');

  const readMode = await interceptWorkspace(
    'workspace_exec',
    { command: 'printf denied > read-marker.txt' },
    { ...workspaceCtx, accessMode: 'read' }
  );
  assert.equal(readMode.error, 'access_mode_read_only');
  await assert.rejects(fs.access(path.join(workspaceRoot, 'read-marker.txt')));
});

test('central dispatcher auto-executes local analysis in full access without a pending approval', async () => {
  const deseq2Params = {
    samples: path.resolve('test/fixtures/neutral-plugins/sample-metrics/demo-data/demo-samples.csv'),
  };
  const result = await dispatchTool(
    'run_tool',
    { op: 'run', toolId: 'sample-metrics', params: deseq2Params },
    {
      userId: 'local-user',
      allowExecution: true,
      accessMode: 'full',
      executeRunTool: async (toolId, params) => ({ ok: true, toolId, result: { params } }),
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.needApproval, undefined);
  assert.equal(result.automationDecision.decision, 'auto_execute');
  assert.equal(result.automationDecision.reason, 'local_reproducible_analysis');
});
