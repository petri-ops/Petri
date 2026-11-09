/**
 * POST-S7 H1/B-04 —— 执行准入闭环在生产路径上的负测。
 *
 * 要被证明的不是「内核函数能算出拒绝」（那已有单元测），而是：
 *   策略判定点签发的凭据，在**真实执行边界**（workspace_exec → executeCommand）被出示、
 *   被消耗、被对账；四类拒绝（过期 / 重放 / 指纹改写 / 上下文改写）在生产路径上真的拦住
 *   或真的被记录，而不是只在测试夹具里成立。
 *
 * 同时钉住用户裁决：默认 enforcement=observe 时**不改变 workspace_exec 既有放行语义**
 * （只把判定结果透出到工具结果），拨硬必须显式 PETRI_EXEC_ADMISSION=1。
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-exec-admission-db-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.resolve('src/migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try {
      fssync.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响测试结论
    }
  });
}

const { createWorkspaceTools } = require('../core/petri-server/agent-tools/workspace-tools.js');
const { issueExecutionToken, _resetConsumedNonces } = require('../core/shared-backend/execution-admission.js');

// 全用 echo（POSIX 与 Windows cmd 同义），因此不做平台分支判断；平台分支冻结门（BLOCK-104）
// 要求新增文件不得散落平台判断，本文件无需登记基线。

let sandboxRoot;
let workspaceRoot;
let tools;

const ctx = { projectId: 'p_admission', userId: 'u_owner', accessMode: 'full', taskId: 'task_admission' };
const ADMISSION_CTX = { tool: 'workspace_exec', accessMode: 'full' };
const FINGERPRINT = 'tool:workspace_exec';

function admission({ enforcement = 'observe', taskId = 'task_admission', fingerprint = FINGERPRINT, mutate } = {}) {
  _resetConsumedNonces();
  const issued = issueExecutionToken({ taskId, fingerprint, ctxSnapshot: ADMISSION_CTX });
  const token = mutate ? mutate({ ...issued.token }) : issued.token;
  return {
    executionAdmission: {
      token,
      enforcement,
      expect: { taskId, fingerprint, ctxSnapshot: ADMISSION_CTX },
    },
  };
}

before(async () => {
  sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-exec-admission-'));
  workspaceRoot = path.join(sandboxRoot, 'workspace');
  await fs.mkdir(workspaceRoot, { recursive: true });
  const fakeDb = {
    getProject(projectId) {
      if (projectId !== 'p_admission') return null;
      return { id: projectId, user_id: 'u_owner', status: 'active', workspace_path: workspaceRoot };
    },
    getUserById(userId) {
      return { id: userId, role: 'user' };
    },
  };
  tools = createWorkspaceTools({ dbProvider: () => fakeDb });
});

after(async () => {
  await fs.rm(sandboxRoot, { recursive: true, force: true });
});

test('observe（默认）：缺凭据仍执行，但判定结果透出为 missing', async () => {
  const result = await tools.executeCommand({ command: 'echo observe-missing' }, ctx, {});
  assert.equal(result.ok, true, 'observe 不得改变 workspace_exec 既有放行语义（用户裁决）');
  assert.deepEqual(result.executionAdmission, { mode: 'observe', reason: 'execution_admission_missing' });
});

test('observe：凭据被真实消耗，reason=consumed', async () => {
  const result = await tools.executeCommand({ command: 'echo observe-consumed' }, ctx, admission());
  assert.equal(result.ok, true);
  assert.deepEqual(result.executionAdmission, { mode: 'observe', reason: 'execution_admission_consumed' });
});

test('enforce：缺凭据 → 拒绝执行（命令不生效）', async () => {
  const result = await tools.executeCommand({ command: 'echo should-not-run' }, ctx, {
    executionAdmission: { token: null, enforcement: 'enforce' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'execution_admission_denied');
  assert.match(result.message, /execution_admission_missing/);
});

test('enforce：凭据有效 → 执行并消耗', async () => {
  const result = await tools.executeCommand({ command: 'echo enforce-ok' }, ctx, admission({ enforcement: 'enforce' }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.executionAdmission, { mode: 'enforce', reason: 'execution_admission_consumed' });
});

test('enforce：同一凭据重放 → execution_token_replayed', async () => {
  const options = admission({ enforcement: 'enforce' });
  const first = await tools.executeCommand({ command: 'echo replay-1' }, ctx, options);
  assert.equal(first.ok, true);
  const second = await tools.executeCommand({ command: 'echo replay-2' }, ctx, options);
  assert.equal(second.ok, false);
  assert.equal(second.error, 'execution_admission_denied');
  assert.match(second.message, /execution_token_replayed/);
});

test('enforce：凭据过期 → execution_token_expired', async () => {
  const options = admission({
    enforcement: 'enforce',
    mutate: (token) => ({ ...token, expiresAt: Date.now() - 1000 }),
  });
  const result = await tools.executeCommand({ command: 'echo expired' }, ctx, options);
  assert.equal(result.ok, false);
  assert.match(result.message, /execution_token_expired/);
});

test('enforce：参数指纹被改写 → execution_token_fingerprint_mismatch', async () => {
  const options = admission({
    enforcement: 'enforce',
    mutate: (token) => ({ ...token, fingerprint: 'tool:workspace_write' }),
  });
  const result = await tools.executeCommand({ command: 'echo rewritten' }, ctx, options);
  assert.equal(result.ok, false);
  assert.match(result.message, /execution_token_fingerprint_mismatch/);
});

test('enforce：执行上下文被改写 → execution_token_ctx_rewritten', async () => {
  const options = admission({ enforcement: 'enforce' });
  options.executionAdmission.expect = {
    taskId: 'task_admission',
    fingerprint: FINGERPRINT,
    ctxSnapshot: { tool: 'workspace_exec', accessMode: 'read' },
  };
  const result = await tools.executeCommand({ command: 'echo ctx-rewritten' }, ctx, options);
  assert.equal(result.ok, false);
  assert.match(result.message, /execution_token_ctx_rewritten/);
});

test('签发失败不得静默：explicit degraded reason 透出到工具结果', async () => {
  const result = await tools.executeCommand({ command: 'echo issue-failed' }, ctx, {
    executionAdmission: {
      token: null,
      enforcement: 'observe',
      issuanceFailed: true,
      reasonCode: 'execution_admission_issue_failed',
      detail: 'boom',
    },
  });
  assert.equal(result.ok, true, 'observe 下签发失败不阻断执行');
  assert.deepEqual(result.executionAdmission, { mode: 'observe', reason: 'execution_admission_issue_failed' });
});
