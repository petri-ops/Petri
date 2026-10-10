#!/usr/bin/env node
'use strict';

/**
 * BLOCK-88 P2 实机验收 — 委托任务归属隔离（loopback 双节点，真实 delegate 工具）。
 *
 * 拓扑：被访端 B = 本机 dev 栈（:3001 + :3005，真实进程）；指挥席 A = 驱动进程
 * 内的**真实 delegate_to_petri_node 工具**（独立 dataDir + 真实 federation-admin 配对）。
 * 链路：A 署名配对 → A 的 agent 工具把任务委托给 B → B 经 gateway 会话门识别
 * 访客身份（req.mobileSession.identity）→ 开**独立委托会话**（origin 标记，不复用
 * 宿主活跃会话）→ 任务落 params.federated → 默认视图隔离 + includeFederated 可见
 * → meta 透出 federatedFrom → CDP 测试实例左栏「联邦委托」面可见。
 *
 * 前置：主 dev 栈在跑且为当前 HEAD 代码（后端变更须重启）；测试实例 9223。
 * 用法: node scripts/block88-p2-delegate-attribution.cjs
 * 证据: acceptance/block-88/p2-attribution.json + p2-attribution-ui.png
 */

const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const B_BASE = process.env.PETRI_B_BASE || 'http://127.0.0.1:3001';
const ENGINEER = { displayName: '工程师 A', device: 'macOS' };
const DELEGATE_TASK = '只读侦察：用一句话报告你运行所在机器的操作系统类型和当前时间，不要使用任何工具。';

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
  const lib = require(path.join(ROOT, '.agents/skills/petri-dev-infra/dev-verify/lib.cjs'));
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
  // ── P0 前置 ──
  const health = await json(`${B_BASE}/api/health`);
  assert_('P0_backend_3001_healthy', health.status === 200, `status=${health.status}`);

  // ── P1 A 署名配对进 B（真实 federation-admin REST + 独立 dataDir）──
  const invite = await json(`${B_BASE}/api/mobile/pairing/token`, {
    method: 'POST', headers: { Authorization: 'Bearer desktop-local' }, body: {},
  });
  assert_('P1_invite_token_issued', invite.status === 200 && !!invite.data.token);
  const pairingUrl = `http://127.0.0.1:3005/pair?token=${invite.data.token}`;

  const cmdRoot = mkdtempSync(path.join(tmpdir(), 'petri-block88-p2-cmd-'));
  let cmdServer = null;
  try {
    const express = require('express');
    const cmdApp = express();
    require(path.join(ROOT, 'core/petri-server/routes/federation-admin.js'))(cmdApp, { dataDir: cmdRoot });
    cmdServer = await listen(cmdApp);
    const cmdBase = `http://127.0.0.1:${cmdServer.address().port}`;
    const paired = await json(`${cmdBase}/api/federation/peers/pair`, {
      method: 'POST', body: { url: pairingUrl, identity: ENGINEER },
    });
    assert_('P1a_pair_with_identity_ok', paired.status === 200 && paired.data.ok === true);
    const peerId = paired.data.peer && paired.data.peer.peerId;

    // ── P2 真实委托：A 侧 delegate_to_petri_node 工具（env 指向 A 的 dataDir）──
    process.env.PETRI_LOCAL_DATA_DIR = cmdRoot;
    const { tool_delegate_to_petri_node } = require(path.join(ROOT, 'core/petri-server/agent-tools/federation-tools.js'));
    const receipt = await tool_delegate_to_petri_node({ peerId, task: DELEGATE_TASK, timeoutMinutes: 6 });
    assert_('P2_delegate_tool_ok', receipt.ok === true, `agentStatus=${receipt.agentStatus} err=${receipt.error || 'none'} reply=${String(receipt.reply || '').slice(0, 80)}`);
    const peerTaskId = receipt.peerTaskId;
    assert_('P2a_peer_task_id_returned', !!peerTaskId);

    // ── P3 B 端归属断言：meta 透出 federatedFrom + 委托会话标题 ──
    const meta = await json(`${B_BASE}/api/ai/agent/task/${encodeURIComponent(peerTaskId)}/meta`, {
      headers: { Authorization: 'Bearer desktop-local' },
    });
    assert_('P3a_meta_federated_from', meta.status === 200 && meta.data.federatedFrom === ENGINEER.displayName,
      JSON.stringify({ federatedFrom: meta.data.federatedFrom, err: meta.data.error }));
    assert_('P3b_meta_conversation_title_from_x', typeof meta.data.conversationTitle === 'string'
      && meta.data.conversationTitle.startsWith(`来自${ENGINEER.displayName}的委托`), `title=${meta.data.conversationTitle}`);

    // ── P4 默认视图隔离 + includeFederated 可见 ──
    const convId = meta.data.conversationId;
    const def = await json(`${B_BASE}/api/ai/conversations?status=all`, { headers: { Authorization: 'Bearer desktop-local' } });
    const leaked = (def.data.conversations || []).filter((c) => c.id === convId);
    assert_('P4a_default_view_excludes_delegation', leaked.length === 0, `default list contains fed conv: ${leaked.length}`);

    const incl = await json(`${B_BASE}/api/ai/conversations?status=all&includeFederated=1`, { headers: { Authorization: 'Bearer desktop-local' } });
    const fed = (incl.data.conversations || []).find((c) => c.id === convId);
    assert_('P4b_includeFederated_reveals_with_origin', !!fed && fed.origin === 'federation-delegation'
      && String(fed.title).startsWith(`来自${ENGINEER.displayName}的委托`), JSON.stringify(fed && { title: fed.title, origin: fed.origin }));

    // 宿主活跃会话零污染：默认视图最新一条不是委托会话
    const newest = (def.data.conversations || [])[0] || null;
    assert_('P4c_host_active_conversation_untouched', !!newest && newest.id !== convId, `newest=${newest && newest.title}`);

    // ── P5 CDP 走查：测试实例左栏「联邦委托」查看面（9223，禁碰 9222）──
    await ensureTestInstance();
    const lib = require(path.join(ROOT, '.agents/skills/petri-dev-infra/dev-verify/lib.cjs'));
    const client = await lib.connectTestTarget({});
    const evalJs = async (expr) => {
      const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed');
      return r.result && r.result.value;
    };
    const projects = await json(`${B_BASE}/api/data/projects`, { headers: { Authorization: 'Bearer desktop-local' } });
    const projectId = ((projects.data.projects || [])[0] || {}).id;
    await evalJs(`location.href = '/project/${projectId}'`);
    await new Promise((r) => setTimeout(r, 3000));
    await evalJs(`(() => { const b = document.querySelector('[data-testid="sidebar-federation"]'); if (b) b.click(); return !!b; })()`);
    await new Promise((r) => setTimeout(r, 800));
    const toggled = await evalJs(`(() => {
      const btn = document.querySelector('[data-testid="fed-conv-toggle"]');
      if (btn) btn.click();
      return !!btn;
    })()`);
    await new Promise((r) => setTimeout(r, 1200));
    const ui = await evalJs(`(() => {
      const list = document.querySelector('[data-testid="fed-conv-list"]');
      const rows = list ? [...list.querySelectorAll('li')].map((el) => (el.textContent || '').trim()) : [];
      return { list: !!list, rows };
    })()`);
    assert_('P5a_fed_conv_toggle_opens_section', toggled && ui.list, JSON.stringify(ui).slice(0, 120));
    assert_('P5b_fed_conversation_visible_from_x', ui.rows.some((t) => t.includes(`来自${ENGINEER.displayName}的委托`)),
      JSON.stringify(ui.rows));

    const evidenceDir = path.join(ROOT, 'acceptance', 'block-88');
    mkdirSync(evidenceDir, { recursive: true });
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(evidenceDir, 'p2-attribution-ui.png'), Buffer.from(shot.data, 'base64'));
    assert_('P5c_screenshot_captured', true, 'acceptance/block-88/p2-attribution-ui.png');
  } finally {
    if (cmdServer) cmdServer.close();
    rmSync(cmdRoot, { recursive: true, force: true });
  }

  const finishedAt = new Date().toISOString();
  const allPass = assertions.every((a) => a.pass);
  const evidence = {
    package: 'BLOCK-88-ENGINEER-COLLAB',
    stage: 'P2-ATTRIBUTION',
    topology: 'loopback dual-node: B=dev stack :3001/:3005 (real), A=real delegate_to_petri_node tool (isolated dataDir)',
    engineer: ENGINEER,
    delegateTask: DELEGATE_TASK,
    startedAt,
    finishedAt,
    assertions,
    allPass,
    uiNote: '联邦委托会话查看面在 CDP 9223 测试实例走查；探针零触碰 9222 主窗口',
  };
  const evidenceDir = path.join(ROOT, 'acceptance', 'block-88');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, 'p2-attribution.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n[BLOCK-88-P2] ${allPass ? 'PASS' : 'FAIL'} — ${assertions.filter((a) => a.pass).length}/${assertions.length} assertions → acceptance/block-88/p2-attribution.json`);
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(`[BLOCK-88-P2] FAIL — ${error && error.stack || error}`);
  process.exitCode = 1;
});
