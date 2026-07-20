import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { decideAgentToolCall } = require('../core/r-server/agent-tools/agent-tool-policy.js');
const {
  createAgentToolInterceptor,
  validateToolArguments,
} = require('../core/r-server/agent-tools/agent-tool-interceptor.js');
const { getToolEntry } = require('../core/r-server/agent-tools/registry.js');
const { createWorkspaceTools } = require('../core/r-server/agent-tools/workspace-tools.js');
const { dispatchTool } = require('../core/r-server/agent-tools/index.js');
const db = require('../core/r-server/db.js');

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
    ['act_generic', { handlerId: 'x' }, contract('state-write', 'R2', 'action')],
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
    args: { op: 'run', toolId: 'deseq2' },
    contract: contract('execution', 'R2', 'analysis'),
  });
  assert.equal(result.decision, 'allow');
  assert.equal(result.reason, 'delegated_approval');
  assert.equal(result.delegatedApproval, true);
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
  await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'outside\n');
  await fs.symlink(outsideRoot, path.join(workspaceRoot, 'escape'));

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

  const escaped = await interceptWorkspace('workspace_read', { path: 'escape/secret.txt' }, workspaceCtx);
  assert.equal(escaped.error, 'symlink_escape');
  assert.equal(escaped.reason, 'policy_denied');
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

test('only allowlisted command executes while unknown, Git, and dangerous commands deny', async () => {
  const pwd = await interceptWorkspace('workspace_exec', { command: 'pwd' }, workspaceCtx);
  assert.equal(pwd.ok, true);
  assert.equal(pwd.stdout.trim(), await fs.realpath(workspaceRoot));

  const marker = path.join(workspaceRoot, 'marker.txt');
  const unknown = await interceptWorkspace(
    'workspace_exec',
    { command: 'printf changed > marker.txt' },
    workspaceCtx
  );
  assert.equal(unknown.error, 'command_not_allowlisted');
  assert.equal(unknown.reason, 'command_not_allowlisted');
  await assert.rejects(fs.access(marker));

  const gitStatus = await interceptWorkspace('workspace_exec', { command: 'git status --short' }, workspaceCtx);
  assert.equal(gitStatus.error, 'command_not_allowlisted');
  assert.equal(gitStatus.reason, 'command_not_allowlisted');

  const dangerous = await interceptWorkspace('workspace_exec', { command: 'rm existing.txt' }, workspaceCtx);
  assert.equal(dangerous.error, 'command_blocked');
  assert.equal(dangerous.reason, 'policy_denied');
  assert.equal(await fs.readFile(path.join(workspaceRoot, 'existing.txt'), 'utf8'), 'changed\n');
});

test('central dispatcher keeps run_tool approval on a real pending tool_job', async () => {
  const result = await dispatchTool(
    'run_tool',
    { op: 'run', toolId: 'deseq2', params: { counts: '/fake/counts.csv' } },
    { userId: 'local-user', allowExecution: true, accessMode: 'full' }
  );
  assert.equal(result.ok, true);
  assert.equal(result.needApproval, true);
  assert.ok(result.ackToken);
  assert.ok(result.toolJobId);
  const job = db.getToolJob(result.toolJobId);
  assert.equal(job.ack_status, 'pending');
  assert.equal(job.ack_token, result.ackToken);
  db.getDatabase().prepare('DELETE FROM tool_jobs WHERE id=?').run(result.toolJobId);
});
