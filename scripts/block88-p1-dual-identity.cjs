#!/usr/bin/env node
'use strict';

/**
 * BLOCK-88 P1 实机验收 — 工程师声明身份双端贯通（loopback 双节点）。
 *
 * 拓扑：被访端 B = 本机 dev 栈（:3001 admin + :3005 gateway，真实进程）；
 *       指挥席 A = 独立真实 federation-admin REST（独立 dataDir + 临时端口）。
 * 链路：A 带署名（工程师 A · macOS）→ B /m/api/pair 落会话身份 → B 健康回显 →
 *       B /api/federation/members 成员面 → A peers 注册表投影 → CDP 测试实例
 *       联邦面板「协作成员」UI 可见。
 *
 * 前置：主 dev 栈在跑（:3001 健康）且后端代码为当前 HEAD（后端变更须重启）；
 *       UI 走查用 bash scripts/start-test-instance.sh 拉起 CDP 9223 测试实例
 *       （永久红线：探针禁导航 9222 用户主窗口）。
 * 用法: node scripts/block88-p1-dual-identity.cjs
 * 证据: acceptance/block-88/p1-identity.json + p1-identity-ui.png
 */

const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const B_BASE = process.env.PETRI_B_BASE || 'http://127.0.0.1:3001';
const B_GATEWAY = process.env.PETRI_B_GATEWAY || 'http://127.0.0.1:3005';
const ENGINEER = { displayName: '工程师 A', device: 'macOS' };

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
  // 已在跑则直接用；否则 bash scripts/start-test-instance.sh 拉起（fail-fast 语义自带）。
  const lib = require(path.join(ROOT, '.agents/skills/petri-dev-infra/dev-verify/lib.cjs'));
  try {
    await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 2000 });
    return { booted: false };
  } catch {
    const proc = spawn('bash', [path.join(ROOT, 'scripts/start-test-instance.sh')], {
      cwd: ROOT, stdio: 'inherit',
    });
    await new Promise((resolve, reject) => {
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`start-test-instance exit ${code}`))));
      proc.on('error', reject);
    });
    return { booted: true };
  }
}

async function main() {
  // ── P0 前置：B 栈健康 ──
  const health = await json(`${B_BASE}/api/health`);
  assert_('P0_backend_3001_healthy', health.status === 200, `status=${health.status}`);

  // ── P1 B 出码（REST 出码，SKILL 第 1 条禁面板出码）──
  const invite = await json(`${B_BASE}/api/mobile/pairing/token`, {
    method: 'POST', headers: { Authorization: 'Bearer desktop-local' }, body: {},
  });
  assert_('P1_invite_token_issued', invite.status === 200 && !!invite.data.token, `status=${invite.status}`);
  const pairingUrl = `http://127.0.0.1:3005/pair?token=${invite.data.token}`;

  // ── P2 A 端带署名配对（真实 federation-admin + 独立 dataDir）──
  const cmdRoot = mkdtempSync(path.join(tmpdir(), 'petri-block88-cmd-'));
  let cmdServer = null;
  try {
    const express = require('express');
    const cmdApp = express();
    require(path.join(ROOT, 'core/petri-server/routes/federation-admin.js'))(cmdApp, { dataDir: cmdRoot });
    cmdServer = await listen(cmdApp);
    const cmdBase = `http://127.0.0.1:${cmdServer.address().port}`;

    const paired = await json(`${cmdBase}/api/federation/peers/pair`, {
      method: 'POST',
      body: { url: pairingUrl, identity: ENGINEER },
    });
    assert_('P2_pair_with_identity_ok', paired.status === 200 && paired.data.ok === true,
      JSON.stringify(paired.data).slice(0, 200));

    // A 端可见：peers 注册表投影带署名（token 仍不出）
    const peers = await json(`${cmdBase}/api/federation/peers`);
    const peer = (peers.data.peers || [])[0] || null;
    assert_('P2a_peer_registry_identity', !!peer && peer.identity && peer.identity.displayName === ENGINEER.displayName
      && peer.identity.device === ENGINEER.device, JSON.stringify(peer && peer.identity));
    assert_('P2b_peer_token_not_exposed', !!peer && peer.sessionToken === undefined);

    // ── P3 B 端会话落档：协作成员面可见 ──
    const members = await json(`${B_BASE}/api/federation/members`, {
      headers: { Authorization: 'Bearer desktop-local' },
    });
    const member = (members.data.members || []).find((m) => m.identity && m.identity.displayName === ENGINEER.displayName) || null;
    assert_('P3_members_endpoint_identity', !!member && member.identity.device === ENGINEER.device,
      JSON.stringify(member && member.identity));

    // ── P4 健康回显：B 会话身份与 A 所发一致（指挥席契约断言面）──
    const { getPeerToken } = require(path.join(ROOT, 'core/shared-backend/federation-peers.js'));
    const aToken = getPeerToken(cmdRoot, peer.peerId);
    assert_('P4a_a_side_holds_session_token', typeof aToken === 'string' && aToken.length >= 64);
    const echo = await json(`${B_GATEWAY}/federation/api/health`, {
      headers: { Authorization: `Bearer ${aToken}` },
    });
    assert_('P4b_health_echo_identity', echo.status === 200 && echo.data.session
      && echo.data.session.identity && echo.data.session.identity.displayName === ENGINEER.displayName
      && echo.data.session.identity.device === ENGINEER.device, JSON.stringify(echo.data.session));

    // ── P5 UI 走查：测试实例联邦面板「协作成员」可见（9223，禁碰 9222）──
    await ensureTestInstance();
    const lib = require(path.join(ROOT, '.agents/skills/petri-dev-infra/dev-verify/lib.cjs'));
    const client = await lib.connectTestTarget({});
    const evalJs = async (expr) => {
      const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed');
      return r.result && r.result.value;
    };

    // 联邦面板挂在工作区左栏——先进任一项目工作区（测试实例与主实例共享 :3001）
    const projects = await json(`${B_BASE}/api/data/projects`, {
      headers: { Authorization: 'Bearer desktop-local' },
    });
    const projectId = ((projects.data.projects || [])[0] || {}).id;
    assert_('P5pre_project_available', !!projectId, `projects=${(projects.data.projects || []).length}`);
    await evalJs(`location.href = '/project/${projectId}'`);
    await new Promise((r) => setTimeout(r, 3000));

    // 打开左栏联邦 → 协作成员 tab（peers）
    await evalJs(`(() => {
      const btn = document.querySelector('[data-testid="sidebar-federation"]');
      if (btn) btn.click();
      return !!btn;
    })()`);
    await new Promise((r) => setTimeout(r, 800));
    const tabOpened = await evalJs(`(() => {
      const tabs = [...document.querySelectorAll('[data-testid="federation-tab-peers"]')];
      const tab = tabs.find((el) => el.offsetParent !== null);
      if (tab) tab.click();
      return tabs.length;
    })()`);
    await new Promise((r) => setTimeout(r, 1200));
    assert_('P5a_federation_panel_reachable', tabOpened >= 1, `tab buttons=${tabOpened}`);

    const ui = await evalJs(`(() => {
      const card = document.querySelector('[data-testid="federation-members"]');
      const rows = [...document.querySelectorAll('[data-testid="federation-member-row"]')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => el.textContent || '');
      const input = document.querySelector('[data-testid="federation-engineer-name"]');
      return {
        card: !!card,
        rows,
        hasEngineerA: rows.some((t) => t.includes('${ENGINEER.displayName}')),
        hasHonestyNote: !!card && /声明身份/.test(card.textContent || ''),
        hasSignatureInput: !!input,
      };
    })()`);
    assert_('P5b_members_card_mounted', ui.card === true, JSON.stringify(ui).slice(0, 160));
    assert_('P5c_engineer_identity_visible_in_ui', ui.hasEngineerA === true, JSON.stringify(ui.rows));
    assert_('P5d_honesty_note_declared_identity', ui.hasHonestyNote === true);
    assert_('P5e_engineer_signature_input_present', ui.hasSignatureInput === true);

    const evidenceDir = path.join(ROOT, 'acceptance', 'block-88');
    mkdirSync(evidenceDir, { recursive: true });
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(evidenceDir, 'p1-identity-ui.png'), Buffer.from(shot.data, 'base64'));
    assert_('P5f_screenshot_captured', true, 'acceptance/block-88/p1-identity-ui.png');
  } finally {
    if (cmdServer) cmdServer.close();
    rmSync(cmdRoot, { recursive: true, force: true });
  }

  // ── 证据落盘 ──
  const finishedAt = new Date().toISOString();
  const allPass = assertions.every((a) => a.pass);
  const evidence = {
    package: 'BLOCK-88-ENGINEER-COLLAB',
    stage: 'P1-IDENTITY',
    topology: 'loopback dual-node: B=dev stack :3001/:3005 (real), A=real federation-admin REST (ephemeral, isolated dataDir)',
    engineer: ENGINEER,
    startedAt,
    finishedAt,
    assertions,
    allPass,
    uiNote: '协作成员 UI 在 CDP 9223 测试实例走查（与用户主实例共享 :3001 后端）；探针零触碰 9222 主窗口',
  };
  const evidenceDir = path.join(ROOT, 'acceptance', 'block-88');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, 'p1-identity.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n[BLOCK-88-P1] ${allPass ? 'PASS' : 'FAIL'} — ${assertions.filter((a) => a.pass).length}/${assertions.length} assertions → acceptance/block-88/p1-identity.json`);
  // CDP websocket 挂住事件循环——驱动脚本落盘后显式退出（0=全过 / 1=有断言红）
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(`[BLOCK-88-P1] FAIL — ${error && error.stack || error}`);
  process.exitCode = 1;
});
