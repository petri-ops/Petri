#!/usr/bin/env node
'use strict';

/**
 * BLOCK-88 P4 双真机端到端 — 真实两机跨网联邦协作全链（Mac=指挥席，Windows=被访端）。
 *
 * 拓扑：Mac 本会话（指挥席侧，独立 dataDir 持真实 peers 注册表）经局域网直连
 * Windows 格物（192.168.0.102:3005 gateway，token 由 Windows :3001 REST 签发）。
 * 链路：署名配对（工程师 A · macOS）→ 握手身份回显 → Windows 项目清点 →
 * 默认零授权委托 403 → Windows REST 授权 → 同一委托真实跑完（Windows 真实模型）→
 * meta 归属/会话 project_id 绑定（Windows 侧真相）→ 回执 grantedProjects 发现面 →
 * 吊销即刻再 403。
 *
 * 用法: node scripts/block88-p4-dual-machine.cjs <pairingUrl>
 * 证据: acceptance/block-88/p4-dual-machine.json
 */

const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ENGINEER = { displayName: '工程师 A', device: 'macOS' };
const DELEGATE_TASK = '只读侦察：用一句话报告你运行所在机器的操作系统类型，不要使用任何工具。';

const startedAt = new Date().toISOString();
const assertions = [];
function assert_(name, pass, detail = '') {
  assertions.push({ name, pass: pass === true, detail: String(detail) });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (pass !== true) process.exitCode = 1;
}

async function json(url, { method = 'GET', headers = {}, body = null, timeoutMs = 30000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function main() {
  const pairingUrl = process.argv[2];
  if (!pairingUrl) { console.error('usage: node scripts/block88-p4-dual-machine.cjs <pairingUrl>'); process.exit(2); }

  const cmdRoot = mkdtempSync(path.join(tmpdir(), 'petri-block88-p4-cmd-'));
  try {
    // ── L1 Mac 指挥席署名配对 Windows（真实 addPeerFromPairingUrl 全链）──
    const federation = require(path.join(ROOT, 'core/shared-backend/federation-peers.js'));
    const paired = await federation.addPeerFromPairingUrl(cmdRoot, pairingUrl, { identity: ENGINEER });
    assert_('L1_pair_with_identity_ok', paired.ok === true, JSON.stringify(paired).slice(0, 200));
    if (!paired.ok) return;
    const peerId = paired.peer.peerId;

    // L1a 握手身份回显：Windows 侧记录的署名与 Mac 所发一致（P1 契约跨真机）
    const peer = federation.getPeer(cmdRoot, peerId);
    const health = await json(`${peer.baseUrl}/federation/api/health`, {
      headers: { Authorization: `Bearer ${federation.getPeerToken(cmdRoot, peerId)}` },
    });
    assert_('L1a_health_echoes_identity', health.status === 200 && health.data.session
      && health.data.session.identity
      && health.data.session.identity.displayName === ENGINEER.displayName
      && health.data.session.identity.device === ENGINEER.device,
      JSON.stringify(health.data.session));

    // ── L2 Windows 侧项目清点（会话门内全量路由）──
    const token = federation.getPeerToken(cmdRoot, peerId);
    const projects = await json(`${peer.baseUrl}/api/data/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const target = ((projects.data.projects || [])[0]) || null;
    assert_('L2_windows_projects_reachable', projects.status === 200 && !!target,
      `status=${projects.status} count=${(projects.data.projects || []).length}`);

    // ── L3 默认零授权：带 projectId 委托 → Windows 诚实 403 ──
    process.env.PETRI_LOCAL_DATA_DIR = cmdRoot;
    const { tool_delegate_to_petri_node } = require(path.join(ROOT, 'core/petri-server/agent-tools/federation-tools.js'));
    const denied = await tool_delegate_to_petri_node({ peerId, task: DELEGATE_TASK, projectId: target.id, timeoutMinutes: 3 });
    assert_('L3_ungarnted_denied_cross_machine', denied.ok !== true && denied.error === 'federation_project_not_granted',
      JSON.stringify({ error: denied.error, message: denied.message }).slice(0, 180));

    // ── L4 Windows REST 授权（宿主桌面面，经会话门）──
    const grant = await json(`${peer.baseUrl}/api/federation/grants`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { engineer: ENGINEER.displayName, projectId: target.id },
    });
    assert_('L4_windows_grant_ok', grant.status === 200 && grant.data.ok === true);

    // ── L5 授权放行：真实委托在 Windows 跑完（真实模型轮次）──
    const receipt = await tool_delegate_to_petri_node({ peerId, task: DELEGATE_TASK, projectId: target.id, timeoutMinutes: 8 });
    assert_('L5_granted_delegate_done_cross_machine', receipt.ok === true,
      `agentStatus=${receipt.agentStatus} err=${receipt.error || 'none'} reply=${String(receipt.reply || '').slice(0, 90)}`);

    // ── L6 Windows 侧真相断言：归属 + 会话项目绑定 ──
    const meta = await json(`${peer.baseUrl}/api/ai/agent/task/${encodeURIComponent(receipt.peerTaskId)}/meta`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert_('L6a_meta_federated_from_on_windows', meta.status === 200 && meta.data.federatedFrom === ENGINEER.displayName,
      JSON.stringify({ federatedFrom: meta.data.federatedFrom }));
    assert_('L6b_meta_conversation_title_from_x', typeof meta.data.conversationTitle === 'string'
      && meta.data.conversationTitle.startsWith(`来自${ENGINEER.displayName}的委托`), `title=${meta.data.conversationTitle}`);
    const incl = await json(`${peer.baseUrl}/api/ai/conversations?status=all&includeFederated=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fed = (incl.data.conversations || []).find((c) => c.id === meta.data.conversationId);
    assert_('L6c_windows_conversation_project_bound', !!fed && fed.project_id === target.id && fed.origin === 'federation-delegation',
      JSON.stringify(fed && { project_id: fed.project_id, origin: fed.origin }));

    // ── L7 发现面：不带 projectId 委托回执附 grantedProjects ──
    const receipt2 = await tool_delegate_to_petri_node({ peerId, task: DELEGATE_TASK, timeoutMinutes: 8 });
    assert_('L7_discovery_granted_projects', receipt2.ok === true && Array.isArray(receipt2.grantedProjects)
      && receipt2.grantedProjects.some((p) => p.projectId === target.id),
      JSON.stringify(receipt2.grantedProjects || receipt2.error));

    // ── L8 吊销即刻生效 ──
    const revoke = await json(`${peer.baseUrl}/api/federation/grants?engineer=${encodeURIComponent(ENGINEER.displayName)}&projectId=${encodeURIComponent(target.id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert_('L8a_windows_revoke_ok', revoke.status === 200);
    const deniedAgain = await tool_delegate_to_petri_node({ peerId, task: DELEGATE_TASK, projectId: target.id, timeoutMinutes: 3 });
    assert_('L8b_revoked_denied_again_cross_machine', deniedAgain.ok !== true && deniedAgain.error === 'federation_project_not_granted',
      JSON.stringify({ error: deniedAgain.error }).slice(0, 120));
  } finally {
    rmSync(cmdRoot, { recursive: true, force: true });
  }

  const finishedAt = new Date().toISOString();
  const allPass = assertions.every((a) => a.pass);
  const evidence = {
    package: 'BLOCK-88-ENGINEER-COLLAB',
    stage: 'P4-DUAL-MACHINE',
    topology: `real dual-machine: Mac(command seat, isolated dataDir, real federation stack) -> Windows host ${'192.168.0.102:3005 LAN'} (token issued by Windows :3001 REST)`,
    engineer: ENGINEER,
    delegateTask: DELEGATE_TASK,
    startedAt,
    finishedAt,
    assertions,
    allPass,
  };
  const evidenceDir = path.join(ROOT, 'acceptance', 'block-88');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, 'p4-dual-machine.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n[BLOCK-88-P4] ${allPass ? 'PASS' : 'FAIL'} — ${assertions.filter((a) => a.pass).length}/${assertions.length} assertions → acceptance/block-88/p4-dual-machine.json`);
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(`[BLOCK-88-P4] FAIL — ${error && error.stack || error}`);
  process.exitCode = 1;
});
