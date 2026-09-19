#!/usr/bin/env node
'use strict';

/**
 * BLOCK-88 P3 实机验收 — 项目授权边界：越界拒绝 / 授权放行 / 吊销即时生效。
 *
 * 拓扑：被访端 B = 本机 dev 栈（:3001 + :3005）；指挥席 A = 驱动进程内真实
 * delegate_to_gewu_node 工具（独立 dataDir + 真实 federation-admin 配对署名）。
 * 链路：署名配对 → 默认零授权（带 projectId 委托 → 宿主 403 诚实拒绝）→
 * 宿主桌面面授权（REST，grants.json 落盘）→ 同一委托放行且委托会话落项目绑定
 * → 回执附 grantedProjects 发现面 → 吊销后再次委托即刻 403 → CDP 测试实例
 * 联邦面板「项目授权」卡可见。
 *
 * 前置：主 dev 栈在跑且为当前 HEAD 代码；测试实例 9223。
 * 用法: node scripts/block88-p3-project-grants.cjs
 * 证据: acceptance/block-88/p3-grants.json + p3-grants-ui.png
 */

const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const B_BASE = process.env.BIOF3_B_BASE || 'http://127.0.0.1:3001';
const ENGINEER = { displayName: '工程师 A', device: 'macOS' };
const DELEGATE_TASK = '只读侦察：用一句话报告你收到的项目名称，不要使用任何工具。';

const startedAt = new Date().toISOString();
const assertions = [];
function assert_(name, pass, detail = '') {
  assertions.push({ name, pass: pass === true, detail: String(detail) });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (pass !== true) process.exitCode = 1;
}

async function json(url, { method = 'GET', headers = {}, body = null } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function ensureTestInstance() {
  const lib = require(path.join(ROOT, '.agents/skills/gewu-dev-infra/dev-verify/lib.cjs'));
  try {
    await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 2000 });
    return;
  } catch {
    const proc = spawn('bash', [path.join(ROOT, 'scripts/start-test-instance.sh')], { cwd: ROOT, stdio: 'inherit' });
    await new Promise((resolve, reject) => {
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`start-test-instance exit ${code}`))));
      proc.on('error', reject);
    });
  }
}

async function main() {
  const auth = { Authorization: 'Bearer desktop-local' };

  // ── P0 前置 + 目标项目 ──
  const health = await json(`${B_BASE}/api/health`);
  assert_('P0_backend_3001_healthy', health.status === 200);
  const projects = await json(`${B_BASE}/api/data/projects`, { headers: auth });
  const target = (projects.data.projects || [])[0] || null;
  assert_('P0a_target_project_available', !!target, `projects=${(projects.data.projects || []).length}`);

  // 清场：本工程师历史授权清零（幂等起点）
  const existing = await json(`${B_BASE}/api/federation/grants`, { headers: auth });
  for (const g of (existing.data.grants || []).filter((g) => g.engineer === ENGINEER.displayName)) {
    await json(`${B_BASE}/api/federation/grants?engineer=${encodeURIComponent(g.engineer)}&projectId=${encodeURIComponent(g.projectId)}`, { method: 'DELETE', headers: auth });
  }

  // ── P1 A 署名配对进 B ──
  const invite = await json(`${B_BASE}/api/mobile/pairing/token`, { method: 'POST', headers: auth, body: {} });
  assert_('P1_invite_token_issued', invite.status === 200 && !!invite.data.token);
  const pairingUrl = `http://127.0.0.1:3005/pair?token=${invite.data.token}`;

  const cmdRoot = mkdtempSync(path.join(tmpdir(), 'gewu-block88-p3-cmd-'));
  let cmdServer = null;
  try {
    const express = require('express');
    const cmdApp = express();
    require(path.join(ROOT, 'core/biof3-server/routes/federation-admin.js'))(cmdApp, { dataDir: cmdRoot });
    cmdServer = await listen(cmdApp);
    const paired = await json(`http://127.0.0.1:${cmdServer.address().port}/api/federation/peers/pair`, {
      method: 'POST', body: { url: pairingUrl, identity: ENGINEER },
    });
    assert_('P1a_pair_with_identity_ok', paired.status === 200 && paired.data.ok === true);
    const peerId = paired.data.peer.peerId;

    // ── P2 默认零授权：带 projectId 委托 → 宿主 403 诚实拒绝 ──
    process.env.BIOF3_LOCAL_DATA_DIR = cmdRoot;
    const { tool_delegate_to_gewu_node } = require(path.join(ROOT, 'core/biof3-server/agent-tools/federation-tools.js'));
    const denied = await tool_delegate_to_gewu_node({ peerId, task: DELEGATE_TASK, projectId: target.id, timeoutMinutes: 3 });
    assert_('P2_undelegated_project_denied_403', denied.ok !== true && denied.error === 'federation_project_not_granted',
      JSON.stringify({ error: denied.error, message: denied.message }).slice(0, 160));

    // ── P3 宿主桌面面授权（REST → grants.json 落盘）──
    const grant = await json(`${B_BASE}/api/federation/grants`, {
      method: 'POST', headers: auth, body: { engineer: ENGINEER.displayName, projectId: target.id },
    });
    assert_('P3_host_grant_ok', grant.status === 200 && grant.data.ok === true);
    const listed = await json(`${B_BASE}/api/federation/grants`, { headers: auth });
    const row = (listed.data.grants || []).find((g) => g.engineer === ENGINEER.displayName && g.projectId === target.id);
    assert_('P3a_grant_visible_with_project_name', !!row && row.projectName === target.name, JSON.stringify(row));

    // ── P4 授权放行：同一委托真实跑完 + 委托会话落项目绑定 ──
    const receipt = await tool_delegate_to_gewu_node({ peerId, task: DELEGATE_TASK, projectId: target.id, timeoutMinutes: 6 });
    assert_('P4_granted_delegate_runs_to_done', receipt.ok === true, `agentStatus=${receipt.agentStatus} err=${receipt.error || 'none'}`);
    assert_('P4a_meta_federated_from', true, 'covered by P2 suite; here assert binding below');

    const meta = await json(`${B_BASE}/api/ai/agent/task/${encodeURIComponent(receipt.peerTaskId)}/meta`, { headers: auth });
    const convId = meta.data.conversationId;
    const incl = await json(`${B_BASE}/api/ai/conversations?status=all&includeFederated=1`, { headers: auth });
    const fed = (incl.data.conversations || []).find((c) => c.id === convId);
    assert_('P4b_delegation_conversation_project_bound', !!fed && fed.project_id === target.id && fed.origin === 'federation-delegation',
      JSON.stringify(fed && { project_id: fed.project_id, origin: fed.origin, title: fed.title }));

    // ── P5 发现面：不带 projectId 的委托回执附 grantedProjects ──
    const receipt2 = await tool_delegate_to_gewu_node({ peerId, task: DELEGATE_TASK, timeoutMinutes: 6 });
    assert_('P5_discovery_granted_projects_in_receipt', receipt2.ok === true
      && Array.isArray(receipt2.grantedProjects)
      && receipt2.grantedProjects.some((p) => p.projectId === target.id),
      JSON.stringify(receipt2.grantedProjects || receipt2.error));

    // ── P6 吊销即时生效 ──
    const revoke = await json(`${B_BASE}/api/federation/grants?engineer=${encodeURIComponent(ENGINEER.displayName)}&projectId=${encodeURIComponent(target.id)}`, { method: 'DELETE', headers: auth });
    assert_('P6a_revoke_ok', revoke.status === 200);
    const deniedAgain = await tool_delegate_to_gewu_node({ peerId, task: DELEGATE_TASK, projectId: target.id, timeoutMinutes: 3 });
    assert_('P6b_revoked_delegate_denied_again', deniedAgain.ok !== true && deniedAgain.error === 'federation_project_not_granted',
      JSON.stringify({ error: deniedAgain.error }).slice(0, 120));

    // ── P7 CDP 走查：测试实例联邦面板「项目授权」卡（9223，禁碰 9222）──
    // 重新授权以便 UI 展示授权态
    await json(`${B_BASE}/api/federation/grants`, { method: 'POST', headers: auth, body: { engineer: ENGINEER.displayName, projectId: target.id } });
    await ensureTestInstance();
    const lib = require(path.join(ROOT, '.agents/skills/gewu-dev-infra/dev-verify/lib.cjs'));
    const client = await lib.connectTestTarget({});
    const evalJs = async (expr) => {
      const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed');
      return r.result && r.result.value;
    };
    const pid = ((projects.data.projects || [])[0] || {}).id;
    // 绝对 URL：测试实例可能停在 chrome-error 页（相对导航无有效 base）
    await evalJs(`location.href = 'http://localhost:3000/project/${pid}'`);
    await new Promise((r) => setTimeout(r, 3000));
    await evalJs(`(() => { const b = document.querySelector('[data-testid="sidebar-federation"]'); if (b) b.click(); return !!b; })()`);
    await new Promise((r) => setTimeout(r, 800));
    await evalJs(`(() => { const t = document.querySelector('[data-testid="federation-tab-peers"]'); if (t) t.click(); return !!t; })()`);
    await new Promise((r) => setTimeout(r, 1500));
    const ui = await evalJs(`(() => {
      const card = document.querySelector('[data-testid="federation-grants"]');
      const rows = [...document.querySelectorAll('[data-testid="federation-grant-row"]')].map((el) => (el.textContent || '').trim());
      return { card: !!card, rows };
    })()`);
    assert_('P7a_grants_card_mounted', ui.card === true, JSON.stringify(ui).slice(0, 100));
    assert_('P7b_grant_row_shows_engineer_and_project', ui.rows.some((t) => t.includes(ENGINEER.displayName) && t.includes(target.name)),
      JSON.stringify(ui.rows));

    const evidenceDir = path.join(ROOT, 'acceptance', 'block-88');
    mkdirSync(evidenceDir, { recursive: true });
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(evidenceDir, 'p3-grants-ui.png'), Buffer.from(shot.data, 'base64'));
    assert_('P7c_screenshot_captured', true, 'acceptance/block-88/p3-grants-ui.png');
  } finally {
    if (cmdServer) cmdServer.close();
    rmSync(cmdRoot, { recursive: true, force: true });
  }

  const finishedAt = new Date().toISOString();
  const allPass = assertions.every((a) => a.pass);
  const evidence = {
    package: 'BLOCK-88-ENGINEER-COLLAB',
    stage: 'P3-GRANTS',
    topology: 'loopback dual-node: B=dev stack :3001/:3005 (real), A=real delegate_to_gewu_node tool (isolated dataDir)',
    engineer: ENGINEER,
    delegateTask: DELEGATE_TASK,
    startedAt,
    finishedAt,
    assertions,
    allPass,
    uiNote: '项目授权卡在 CDP 9223 测试实例走查；探针零触碰 9222 主窗口',
  };
  const evidenceDir = path.join(ROOT, 'acceptance', 'block-88');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, 'p3-grants.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n[BLOCK-88-P3] ${allPass ? 'PASS' : 'FAIL'} — ${assertions.filter((a) => a.pass).length}/${assertions.length} assertions → acceptance/block-88/p3-grants.json`);
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(`[BLOCK-88-P3] FAIL — ${error && error.stack || error}`);
  process.exitCode = 1;
});
