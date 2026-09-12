#!/usr/bin/env node
/**
 * BLOCK-70 实机验收（隔离探针）：mobile-gateway 真实起服双态全链。
 *
 * A1 关闭态 additive 红线：默认（无 env/无配置）起服 → 主后端健康、移动端口不监听
 * A2 启用态：BIOF3_MOBILE_ENABLED=1 → gateway 健康
 * A3 静态移动页 /m/ 可达（独立 bundle，不进 Vite 图）
 * A4 管理 REST：主后端 /api/mobile/status 如实呈现 enabled/port
 * A5 配对 token + QR SVG（服务端渲染）
 * A6 手机配对：一次性 token → 会话；同 token 重放被拒
 * A7 授权读：Bearer 与 ?session= 双通道 → conversations 读面通；无凭证 401
 * A8 吊销即刻失效：主后端吊销 → 移动面下一请求 401
 * A9 审计日志落盘且不含会话 token（D9：只记元数据）
 *
 * 证据：acceptance/block-70/block70-mobile-gateway-live.json（token 全程脱敏不入证）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { applyMigrations, createCaptureEnv, stopServer } from './g0-rs-p4r-capture.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = path.join(REPO_ROOT, 'core', 'biof3-server', 'server.js');
const EVIDENCE_PATH = path.join(REPO_ROOT, 'acceptance', 'block-70', 'block70-mobile-gateway-live.json');

const results = [];
function assert(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${ok ? '' : ` :: ${String(detail).slice(0, 300)}`}`);
}

async function freePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function spawnServer(env) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env,
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => logs.push(chunk));
  child.stderr.on('data', (chunk) => logs.push(chunk));
  child.logs = logs;
  return child;
}

async function waitHealthy(baseUrl, timeoutMs = 45_000) {
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return true;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server not healthy: ${lastError}`);
}

function isPortClosed(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(true));
    socket.connect(port, '127.0.0.1');
  });
}

async function main() {
  // ── A1 关闭态（additive 红线）───────────────────────────────────────
  const offRoot = mkdtempSync(path.join(os.tmpdir(), 'block70-off-'));
  const offMobilePort = await freePort();
  const offEnvRoot = createCaptureEnv({ root: offRoot, port: await freePort() });
  await applyMigrations(offEnvRoot.paths.BIOF3_DB_PATH, { quiet: true });
  const offChild = spawnServer({ ...offEnvRoot.env, BIOF3_MOBILE_PORT: String(offMobilePort) });
  const offBase = `http://127.0.0.1:${offEnvRoot.env.R_SERVER_PORT}`;
  try {
    await waitHealthy(offBase);
    const health = await (await fetch(`${offBase}/api/health`)).json();
    assert('A1a 关闭态主后端健康', health.status === 'ok', JSON.stringify(health).slice(0, 120));
    assert('A1b 关闭态移动端口不监听', await isPortClosed(offMobilePort), `port ${offMobilePort} should be closed`);
    const offStatus = await (await fetch(`${offBase}/api/mobile/status`)).json();
    assert('A1c 关闭态管理面如实呈现 enabled=false', offStatus.ok === true && offStatus.enabled === false, JSON.stringify(offStatus).slice(0, 160));
  } finally {
    await stopServer(offChild);
    rmSync(offRoot, { recursive: true, force: true });
  }

  // ── A2–A9 启用态全链 ────────────────────────────────────────────────
  const root = mkdtempSync(path.join(os.tmpdir(), 'block70-live-'));
  const mobilePort = await freePort();
  const envRoot = createCaptureEnv({ root, port: await freePort() });
  await applyMigrations(envRoot.paths.BIOF3_DB_PATH, { quiet: true });
  const child = spawnServer({
    ...envRoot.env,
    BIOF3_MOBILE_ENABLED: '1',
    BIOF3_MOBILE_PORT: String(mobilePort),
  });
  const mainBase = `http://127.0.0.1:${envRoot.env.R_SERVER_PORT}`;
  const gatewayBase = `http://127.0.0.1:${mobilePort}`;
  let sessionId = null;
  try {
    await waitHealthy(mainBase);

    const gwHealth = await (await fetch(`${gatewayBase}/m/api/health`)).json();
    assert('A2 gateway 健康', gwHealth.ok === true && gwHealth.service === 'gewu-mobile-gateway', JSON.stringify(gwHealth));

    const page = await fetch(`${gatewayBase}/m/`);
    const pageText = await page.text();
    assert('A3 移动页可达', page.status === 200 && pageText.includes('Gewu · 移动工作区'), `status ${page.status}`);

    const status = await (await fetch(`${mainBase}/api/mobile/status`)).json();
    assert('A4 管理面 status 如实', status.ok === true && status.enabled === true && status.port === mobilePort, JSON.stringify({ ...status, devices: (status.devices || []).length }));

    const pairing = await (await fetch(`${mainBase}/api/mobile/pairing/token`, { method: 'POST' })).json();
    assert('A5a 配对 token 签发', pairing.ok === true && /^http:\/\/.+\/m#/.test(pairing.primaryUrl), JSON.stringify({ ...pairing, token: '***', urls: pairing.urls?.length }));
    const qr = await fetch(`${mainBase}/api/mobile/pairing/qr.svg?token=${encodeURIComponent(pairing.token)}`);
    assert('A5b QR SVG 渲染', qr.status === 200 && (qr.headers.get('content-type') || '').includes('image/svg+xml'), `status ${qr.status}`);

    const paired = await (await fetch(`${gatewayBase}/m/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pairing.token }),
    })).json();
    assert('A6a 手机配对成功', paired.ok === true && typeof paired.sessionToken === 'string' && paired.sessionToken.length >= 32);
    sessionId = paired.sessionId;
    const replay = await fetch(`${gatewayBase}/m/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pairing.token }),
    });
    assert('A6b 一次性 token 重放被拒', replay.status === 401, `status ${replay.status}`);

    const authed = await (await fetch(`${gatewayBase}/api/ai/conversations`, {
      headers: { Authorization: `Bearer ${paired.sessionToken}` },
    })).json();
    assert('A7a Bearer 授权读（conversations 投影）', authed.status === 'ok' && Array.isArray(authed.conversations), JSON.stringify(authed).slice(0, 140));
    const viaQuery = await (await fetch(`${gatewayBase}/api/ai/conversations?session=${encodeURIComponent(paired.sessionToken)}`)).json();
    assert('A7b ?session= 通道（EventSource 场景）', viaQuery.status === 'ok');
    const anonymous = await fetch(`${gatewayBase}/api/ai/conversations`);
    assert('A7c 无凭证 401', anonymous.status === 401, `status ${anonymous.status}`);

    const revoke = await (await fetch(`${mainBase}/api/mobile/devices/${encodeURIComponent(sessionId)}/revoke`, { method: 'POST' })).json();
    assert('A8a 主后端吊销成功', revoke.ok === true);
    const afterRevoke = await fetch(`${gatewayBase}/api/ai/conversations`, {
      headers: { Authorization: `Bearer ${paired.sessionToken}` },
    });
    assert('A8b 吊销后移动面即刻 401', afterRevoke.status === 401, `status ${afterRevoke.status}`);

    const auditPath = path.join(root, 'data', 'mobile', 'audit.log');
    const auditExists = existsSync(auditPath) && statSync(auditPath).size > 0;
    const auditRaw = auditExists ? readFileSync(auditPath, 'utf8') : '';
    assert('A9 审计落盘且不含 token', auditExists && auditRaw.includes('/m/api/pair') && !auditRaw.includes(paired.sessionToken), `exists=${auditExists}`);

    // ── B 系列：P2 控制面（发消息契约 / 取消 / 批准全链，真实 tool_jobs 行）──
    // A8 已吊销第一会话；此处再配对第二会话（同时证明吊销后可重新配对、多会话并存）。
    const pairing2 = await (await fetch(`${mainBase}/api/mobile/pairing/token`, { method: 'POST' })).json();
    const paired2 = await (await fetch(`${gatewayBase}/m/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pairing2.token }),
    })).json();
    assert('B0 吊销后可重新配对（第二会话）', paired2.ok === true && typeof paired2.sessionToken === 'string');
    const authHeaders = { Authorization: `Bearer ${paired2.sessionToken}`, 'Content-Type': 'application/json' };

    const sendAnon = await fetch(`${gatewayBase}/api/ai/agent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert('B1a 发消息无会话 401', sendAnon.status === 401, `status ${sendAnon.status}`);
    const sendNoMessages = await fetch(`${gatewayBase}/api/ai/agent`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({}),
    });
    const sendNoMessagesBody = await sendNoMessages.json().catch(() => ({}));
    assert('B1b 发消息契约校验（会话通过、缺消息 400）', sendNoMessages.status === 400 && sendNoMessagesBody.error === '缺少消息', `status ${sendNoMessages.status} body ${JSON.stringify(sendNoMessagesBody).slice(0, 120)}`);

    const cancelAnon = await fetch(`${gatewayBase}/api/ai/agent/task/nonexistent/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert('B2a 取消无会话 401', cancelAnon.status === 401, `status ${cancelAnon.status}`);
    const cancelUnknown = await fetch(`${gatewayBase}/api/ai/agent/task/nonexistent/cancel`, { method: 'POST', headers: authHeaders, body: '{}' });
    assert('B2b 取消未知任务结构化 404', cancelUnknown.status === 404, `status ${cancelUnknown.status}`);

    // 批准全链：向隔离 DB 插入两行 pending tool_job（真实 migrations schema）。
    const db = new Database(envRoot.paths.BIOF3_DB_PATH);
    const columns = db.prepare('PRAGMA table_info(tool_jobs)').all();
    const columnNameSet = new Set(columns.map((column) => column.name));
    function insertPendingJob(id, ackToken, projectId) {
      const values = {
        id,
        tool_id: 'demo_tool',
        status: 'pending',
        ack_token: ackToken,
        ack_status: 'pending',
        user_id: 'local',
        project_id: projectId,
        created_at: Date.now(),
      };
      const usable = Object.keys(values).filter((key) => columnNameSet.has(key));
      const notNullNoDefault = columns
        .filter((column) => column.notnull && column.dflt_value === null && !usable.includes(column.name) && column.pk === 0)
        .map((column) => column.name);
      if (notNullNoDefault.length > 0) throw new Error(`tool_jobs has unfilled NOT NULL columns: ${notNullNoDefault.join(',')}`);
      db.prepare(`INSERT INTO tool_jobs (${usable.join(',')}) VALUES (${usable.map(() => '?').join(',')})`)
        .run(...usable.map((key) => values[key]));
    }
    insertPendingJob('b70_job_approve', 'b70_ack_approve', 'p_b70');
    insertPendingJob('b70_job_reject', 'b70_ack_reject', 'p_b70');

    const decideAnon = await fetch(`${gatewayBase}/m/api/approvals/b70_ack_approve/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve: true, projectId: null, conversationId: null }),
    });
    assert('B3a 批准无会话 401', decideAnon.status === 401, `status ${decideAnon.status}`);

    const missingScope = await fetch(`${gatewayBase}/m/api/approvals/b70_ack_approve/decide`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ approve: true }),
    });
    assert('B3b 批准缺 scope 400（与桌面 REST 同契约）', missingScope.status === 400, `status ${missingScope.status}`);

    const scopeMismatch = await fetch(`${gatewayBase}/m/api/approvals/b70_ack_approve/decide`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ approve: true, projectId: 'p_other', conversationId: null }),
    });
    assert('B3c scope 不匹配 404（权限不放大）', scopeMismatch.status === 404, `status ${scopeMismatch.status}`);

    const approveRes = await fetch(`${gatewayBase}/m/api/approvals/b70_ack_approve/decide`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ approve: true, projectId: 'p_b70', conversationId: null }),
    });
    const approveBody = await approveRes.json().catch(() => ({}));
    assert('B3d 手机批准放行', approveRes.status === 200 && approveBody.ok === true && approveBody.ackStatus === 'approved', `status ${approveRes.status} body ${JSON.stringify(approveBody).slice(0, 140)}`);
    const approvedRow = db.prepare('SELECT ack_status, status FROM tool_jobs WHERE id=?').get('b70_job_approve');
    assert('B3e 批准落库 ack_status=approved 且 job 状态不被破坏', approvedRow && approvedRow.ack_status === 'approved' && approvedRow.status === 'pending', JSON.stringify(approvedRow));

    const rejectRes = await fetch(`${gatewayBase}/m/api/approvals/b70_ack_reject/decide`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ approve: false, projectId: 'p_b70', conversationId: null }),
    });
    assert('B4a 手机拒绝成功', rejectRes.status === 200, `status ${rejectRes.status}`);
    const rejectedRow = db.prepare('SELECT ack_status, status, error FROM tool_jobs WHERE id=?').get('b70_job_reject');
    assert('B4b 拒绝落库 ack_status=rejected + job failed', rejectedRow && rejectedRow.ack_status === 'rejected' && rejectedRow.status === 'failed', JSON.stringify(rejectedRow));
    db.close();
  } finally {
    await stopServer(child);
    if (sessionId) rmSync(path.join(root, 'mobile', 'sessions.json'), { force: true });
    rmSync(root, { recursive: true, force: true });
  }

  const allPass = results.every((entry) => entry.ok);
  const evidence = {
    schemaVersion: 1,
    acceptanceId: 'BLOCK-70-A1-P0-P1-LIVE',
    generatedAt: new Date().toISOString(),
    qualificationEligible: false,
    allPass,
    checks: results,
    notes: {
      method: 'isolated probe: real biof3-server child processes (off-state + on-state), fresh tmp dataDir, migrations applied',
      redaction: 'pairing/session tokens never stored in evidence',
      honestBoundary: 'real-phone scan acceptance pending user; settings-panel CDP assertion pending dev-stack window',
    },
  };
  mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`\n${allPass ? 'ALL PASS' : 'FAILED'} — ${results.filter((entry) => entry.ok).length}/${results.length}`);
  console.log(`evidence: ${EVIDENCE_PATH}`);
  if (!allPass) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error('[block70-live] FAIL —', error.message);
  process.exitCode = 1;
});
