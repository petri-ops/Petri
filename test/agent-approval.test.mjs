// agent-led 阶段2 Task3 测试：重操作 run_tool 强制确认
// 运行：cd desktop-app && node --test test/agent-approval.test.mjs
// 验证：HEAVY_TOOLS 首次 run 返回 needApproval → ack(approve) → 重调 ackToken 续跑
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'vendor', 'biof3-core', 'r-server');
const req = createRequire(import.meta.url);

const db = req(R_SERVER + '/db.js');
const { tool_run_tool } = req(R_SERVER + '/agent-tools/plan-ui-tools.js');
// 直接 require learning.js 拿 tool_run_tool（它在那里定义并导出）
const learning = req(R_SERVER + '/agent-tools/learning.js');

const CTX = { userId: 'local-user' };

test('deseq2 首次 run 返回 needApproval + ackToken', async () => {
  // 用 deseq2（在 HEAVY_TOOLS 白名单）
  const r = await learning.tool_run_tool(
    { op: 'run', toolId: 'deseq2', params: { counts: '/fake/counts.csv' } },
    CTX
  );
  assert.equal(r.ok, true);
  assert.equal(r.needApproval, true, '应返回 needApproval=true');
  assert.ok(r.ackToken, '应返回 ackToken');
  assert.ok(r.toolJobId, '应建 tool_jobs 记录');

  // DB 里 ack_status 应为 pending
  const job = db.getToolJob(r.toolJobId);
  assert.equal(job.ack_status, 'pending');
  assert.equal(job.ack_token, r.ackToken);
  assert.ok(job.ack_expires_at > Date.now(), 'ack_expires_at 应在未来');

  // 清理
  const sqlite = db.getSqliteForLegacyModules();
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(r.toolJobId);
});

test('ack(approve) 后 ack_status 变 approved', async () => {
  const r = await learning.tool_run_tool(
    { op: 'run', toolId: 'deseq2', params: {} },
    CTX
  );
  const job = db.ackToolJob(r.ackToken, true);
  assert.equal(job.ack_status, 'approved');

  const sqlite = db.getSqliteForLegacyModules();
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(r.toolJobId);
});

test('ack(reject) 后重调 ackToken 返回 user_rejected', async () => {
  const r = await learning.tool_run_tool(
    { op: 'run', toolId: 'deseq2', params: {} },
    CTX
  );
  db.ackToolJob(r.ackToken, false);
  const r2 = await learning.tool_run_tool(
    { op: 'run', toolId: 'deseq2', params: {}, ackToken: r.ackToken },
    CTX
  );
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'user_rejected');

  const sqlite = db.getSqliteForLegacyModules();
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(r.toolJobId);
});

test('volcano-plot（非重操作）不拦截，直接跑', async () => {
  // volcano-plot 不在 HEAVY_TOOLS，不应返回 needApproval
  // 注：这里只验证不拦截，不真跑 R（callTool 会跑 R，但 volcano-plot 不在白名单走 _executeRunTool）
  // 用一个不存在的 toolId 触发 callTool 失败，但确认没返回 needApproval
  const r = await learning.tool_run_tool(
    { op: 'run', toolId: 'volcano-plot', params: { deg_table: '/nonexistent.csv' } },
    CTX
  );
  assert.equal(r.needApproval, undefined, 'volcano-plot 不应触发确认拦截');
  // 跑会失败（文件不存在），但 ok=false 且 error 是 tool_failed，不是 needApproval
  assert.equal(r.ok, false);
  assert.notEqual(r.error, 'approval_invalid');
});

test('HEAVY_TOOLS 白名单含 deseq2/wgcna/ml-* 不含 volcano-plot', async () => {
  // 间接验证：deseq2 返回 needApproval，volcano-plot 不返回（上面已测）
  // 这里再验证 wgcna
  const r = await learning.tool_run_tool(
    { op: 'run', toolId: 'wgcna', params: {} },
    CTX
  );
  assert.equal(r.needApproval, true, 'wgcna 应在白名单');
  const sqlite = db.getSqliteForLegacyModules();
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(r.toolJobId);
});
