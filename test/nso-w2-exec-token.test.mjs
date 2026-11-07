/**
 * nso-w2-exec-token.test.mjs — BLOCK-360（NSO-W2-3）exec 令牌收窄 + 风险可见性。
 *
 * 缺口（评估 F-04，本批实证）：
 *  ①PETRI_WORKSPACE_EXEC_TOKEN 是进程级 env，全仓无签发者；子进程 spawn 未传 env → 令牌随
 *    process.env 下沉，`printenv` 即可读回，再拼进命令即绕过严格模式硬拦。
 *  ②默认放行裁决下 commandVerdict 计算出 riskWarnings，但 executeCommand 丢弃 → 风险只进
 *    后端日志，模型/用户看不到（与裁决「回传、可见、不静默」不符）。
 * 契约：env 令牌一律忽略；令牌只经 per-call handlerOptions.execToken 出示，令牌文本不进 shell；
 * 子进程 env 不含令牌；默认放行不变，但 riskWarnings + 严格模式开关提示进入工具结果。
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
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-w2-exec-token-db-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.resolve('src/migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
}
const { createWorkspaceTools } = require('../core/petri-server/agent-tools/workspace-tools.js');

const maybe = process.platform === 'win32' ? test.skip : test;
const ENV_TOKEN = 'tok-ENV-SECRET-0123456789';
const CALL_TOKEN = 'tok-CALL-abcdef0123456789';

let sandboxRoot;
let workspaceRoot;
let tools;
const ctx = { projectId: 'p_w2_exec', userId: 'u_owner', accessMode: 'full' };

before(async () => {
  sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-w2-exec-token-'));
  workspaceRoot = path.join(sandboxRoot, 'workspace');
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, 'keep.txt'), 'keep\n');
  const fakeDb = {
    getProject: (id) => (id === 'p_w2_exec'
      ? { id, user_id: 'u_owner', status: 'active', workspace_path: workspaceRoot }
      : null),
    getUserById: (id) => ({ id, role: 'user' }),
  };
  tools = createWorkspaceTools({ dbProvider: () => fakeDb });
});

after(async () => {
  delete process.env.PETRI_WORKSPACE_EXEC_TOKEN;
  delete process.env.PETRI_EXEC_STRICT_DENYLIST;
  await fs.rm(sandboxRoot, { recursive: true, force: true });
});

maybe('W2-3 负测：env 令牌不下沉子进程（printenv 读不回）', async () => {
  process.env.PETRI_WORKSPACE_EXEC_TOKEN = ENV_TOKEN;
  try {
    const result = await tools.executeCommand(
      { command: 'printenv PETRI_WORKSPACE_EXEC_TOKEN || echo NONE' }, ctx);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(!String(result.stdout).includes(ENV_TOKEN), `令牌泄漏到子进程：${result.stdout}`);
  } finally {
    delete process.env.PETRI_WORKSPACE_EXEC_TOKEN;
  }
});

maybe('W2-3 负测：严格模式下 env 令牌不再构成绕过（拼进命令照样硬拦）', async () => {
  process.env.PETRI_WORKSPACE_EXEC_TOKEN = ENV_TOKEN;
  process.env.PETRI_EXEC_STRICT_DENYLIST = '1';
  try {
    const result = await tools.executeCommand({ command: `rm keep.txt ${ENV_TOKEN}` }, ctx);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'command_blocked');
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'keep.txt'), 'utf8'), 'keep\n');
  } finally {
    delete process.env.PETRI_WORKSPACE_EXEC_TOKEN;
    delete process.env.PETRI_EXEC_STRICT_DENYLIST;
  }
});

maybe('W2-3 per-call 令牌通道已删除（S2/§8.9）：严格模式下令牌不构成豁免，默认放行语义不变', async () => {
  // BLOCK-377（S2 / §8.9 裁决修订）：per-call execToken 全仓无签发者=不可达假安全面 →
  // 通道删除。严格模式下带「令牌」的风险命令照拦（不再有豁免形态）；env 令牌恒忽略不变。
  process.env.PETRI_EXEC_STRICT_DENYLIST = '1';
  try {
    const blocked = await tools.executeCommand(
      { command: `echo marker-ok ${CALL_TOKEN}; rm -f does-not-exist.tmp` },
      ctx,
      { execToken: CALL_TOKEN },
    );
    assert.equal(blocked.ok, false, '删除豁免通道后，严格模式必须照拦');
    assert.match(String(blocked.message || blocked.error), /不可恢复删除/);
  } finally {
    delete process.env.PETRI_EXEC_STRICT_DENYLIST;
  }
});

maybe('W2-3 默认放行裁决不变，但 riskWarnings 与严格模式开关提示进入工具结果（可见不静默）', async () => {
  delete process.env.PETRI_EXEC_STRICT_DENYLIST;
  const result = await tools.executeCommand({ command: 'rm -f does-not-exist.tmp' }, ctx);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(Array.isArray(result.riskWarnings) && result.riskWarnings.length > 0, JSON.stringify(result));
  assert.match(String(result.strictModeHint || ''), /PETRI_EXEC_STRICT_DENYLIST=1/);
  const clean = await tools.executeCommand({ command: 'echo plain' }, ctx);
  assert.equal(clean.riskWarnings, undefined, '无风险命令不附风险字段');
});
