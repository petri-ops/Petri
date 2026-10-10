'use strict';

/**
 * BLOCK-164 W1 — federation_list_peers 委托入口可自足契约。
 *
 * 盘点断点【高】：delegate_to_gewu_node 需要 gpeer_* ID，但 agent 没有任何列节点
 * 工具——首次使用者卡死在「模型不知道 peerId」。契约：
 *  ①空节点诚实态：nodes=[] + 引导文案（去联邦面板配对）。
 *  ②节点清单：peerId/name/identity/在线态（lastProbe 陈旧度 <2min）；
 *    对端不可达时 grantedToMe=null + 诚实 note（委托仍可尝试）。
 *  ③本机授权概览：grants.json 真值进回执（myGrants）。
 *  ④delegate 文案指向：missing_peer_id / unknown_peer 均提示先调 federation_list_peers。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// BLOCK-164 W2 — db 引导（BIOF3_DB_PATH 必须先于任何 db/store require）
process.env.BIOF3_DB_PATH = path.join(tmpdir(), `gewu-b164-${Date.now()}.db`);
// 全量 schema 先行（db.getDatabase 需要 projects 等表；agent-concurrency.test.mjs 同款先例）
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.BIOF3_DB_PATH, path.join(ROOT, 'src', 'migrations'));
const TOOLS_PATH = path.join(ROOT, 'core/biof3-server/agent-tools/federation-tools.js');
const ADMIN_PATH = path.join(ROOT, 'core/biof3-server/routes/federation-admin.js');

const { tool_federation_list_peers, tool_delegate_to_gewu_node } = require(TOOLS_PATH);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitFor timeout (${timeoutMs}ms)`);
    await sleep(5);
  }
}

function writePeers(dataDir, peers) {
  mkdirSync(path.join(dataDir, 'federation'), { recursive: true });
  writeFileSync(path.join(dataDir, 'federation', 'peers.json'), JSON.stringify({ version: 1, peers }));
}
function writeGrants(dataDir, grants) {
  mkdirSync(path.join(dataDir, 'federation'), { recursive: true });
  writeFileSync(path.join(dataDir, 'federation', 'grants.json'), JSON.stringify({ version: 1, grants }));
}

test('BLOCK-164 ① 空节点诚实态：nodes=[] + 配对引导文案', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gewu-b164-empty-'));
  const prev = process.env.BIOF3_LOCAL_DATA_DIR;
  process.env.BIOF3_LOCAL_DATA_DIR = dir;
  try {
    const result = await tool_federation_list_peers();
    assert.equal(result.ok, true);
    assert.deepEqual(result.nodes, []);
    assert.ok(result.message.includes('尚未配对'), '空态必须给配对引导');
  } finally {
    process.env.BIOF3_LOCAL_DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-164 ② 节点清单：在线态按 lastProbe 陈旧度；对端不可达 grantedToMe=null+诚实 note', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gewu-b164-peers-'));
  const prev = process.env.BIOF3_LOCAL_DATA_DIR;
  process.env.BIOF3_LOCAL_DATA_DIR = dir;
  try {
    const now = new Date().toISOString();
    writePeers(dir, [
      { peerId: 'gpeer_aaaabbbbccccdddd', baseUrl: 'http://127.0.0.1:1', sessionToken: 'tok', name: 'Mac 实验室', identity: { displayName: '工程师A' }, lastProbeAt: now },
      { peerId: 'gpeer_ddddccccbbbbaaaa', baseUrl: 'http://127.0.0.1:1', sessionToken: 'tok2', name: '旧节点' }, // 从未探活
    ]);
    const result = await tool_federation_list_peers();
    assert.equal(result.ok, true);
    assert.equal(result.nodes.length, 2);
    const online = result.nodes.find((n) => n.peerId === 'gpeer_aaaabbbbccccdddd');
    assert.equal(online.online, true, 'lastProbe 2min 内=在线');
    assert.equal(online.identity.displayName, '工程师A');
    assert.equal(online.grantedToMe, null, '对端不可达（:1 拒连）');
    assert.ok(online.note.includes('不可达'), '不可达必须诚实标注');
    const stale = result.nodes.find((n) => n.peerId === 'gpeer_ddddccccbbbbaaaa');
    assert.equal(stale.online, false, '从未探活=离线');
  } finally {
    process.env.BIOF3_LOCAL_DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-164 ③ 本机授权概览：grants.json 真值进回执 myGrants', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gewu-b164-grants-'));
  const prev = process.env.BIOF3_LOCAL_DATA_DIR;
  process.env.BIOF3_LOCAL_DATA_DIR = dir;
  try {
    writePeers(dir, []);
    writeGrants(dir, [{ engineer: '工程师A', projectId: 'proj-1', grantedAt: '2026-10-10T00:00:00Z' }]);
    const result = await tool_federation_list_peers();
    assert.deepEqual(result.myGrants, [{ engineer: '工程师A', projectId: 'proj-1', grantedAt: '2026-10-10T00:00:00Z' }]);
  } finally {
    process.env.BIOF3_LOCAL_DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-164 ④ delegate 文案指向 federation_list_peers（缺参/未知 peer 两处）', async () => {
  const missing = await tool_delegate_to_gewu_node({});
  assert.equal(missing.error, 'missing_peer_id');
  assert.ok(missing.message.includes('federation_list_peers'), '缺参文案必须指向列节点工具');

  const dir = mkdtempSync(path.join(tmpdir(), 'gewu-b164-copy-'));
  const prev = process.env.BIOF3_LOCAL_DATA_DIR;
  process.env.BIOF3_LOCAL_DATA_DIR = dir;
  try {
    writePeers(dir, []);
    const unknown = await tool_delegate_to_gewu_node({ peerId: 'gpeer_nope', task: 'x' });
    assert.equal(unknown.error, 'unknown_peer');
    assert.ok(unknown.message.includes('federation_list_peers'), '未知 peer 文案必须指向列节点工具');
  } finally {
    process.env.BIOF3_LOCAL_DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── BLOCK-164 W2 — 委托历史聚合契约 ─────────────────────────────────────

test('BLOCK-164 ⑤ 委托历史聚合：call/result 对 → 状态/对方/回复/归属；无结果=running', async () => {
  const store = require('../core/biof3-server/agent-task-store');
  const { collectDelegations } = require(ADMIN_PATH);
  const { getDatabase } = require('../core/biof3-server/db');
  const db = getDatabase();

  store.insertAgentTask({ taskId: 'task-del-a', userId: 'local-user', params: { conversationId: 'conv-a', projectId: 'proj-a' } });
  store.appendAgentTaskEvent('task-del-a', 1, 'tool_call', { event: 'tool_call', name: 'delegate_to_gewu_node', args: { peerId: 'gpeer_x', task: '跑一个差异分析' } });
  store.appendAgentTaskEvent('task-del-a', 2, 'tool_result', { event: 'tool_result', name: 'delegate_to_gewu_node', toolResult: { callId: 'c1', status: 'completed', data: { ok: true, peerName: 'Mac 实验室', reply: '差异分析已完成，产物已生成' } } });

  store.insertAgentTask({ taskId: 'task-del-b', userId: 'local-user', params: {} });
  store.appendAgentTaskEvent('task-del-b', 1, 'tool_call', { event: 'tool_call', name: 'delegate_to_gewu_node', args: { peerId: 'gpeer_y', task: '另一个委托' } });

  const rows = collectDelegations(db, 'local-user');
  assert.equal(rows.length, 2);
  const done = rows.find((r) => r.taskId === 'task-del-a');
  assert.equal(done.status, 'done');
  assert.equal(done.peerName, 'Mac 实验室');
  assert.equal(done.conversationId, 'conv-a');
  assert.equal(done.projectId, 'proj-a');
  assert.ok(done.replyHead.includes('差异分析已完成'));
  const running = rows.find((r) => r.taskId === 'task-del-b');
  assert.equal(running.status, 'running', '无结果帧的委托按 running 呈现');
  assert.equal(running.replyHead, null);
});

// ── BLOCK-164 W3 — 节点心跳契约 ─────────────────────────────────────────

test('BLOCK-164 ⑥ 心跳：逐 peer 探活、失败静默、stop 后停表', async () => {
  const { startPeerHeartbeat } = require(ADMIN_PATH);
  const probed = [];
  let failFirst = true;
  const probe = async (dir, id) => {
    if (failFirst && id === 'p1') { failFirst = false; throw new Error('probe boom'); }
    probed.push(id);
    return { ok: true };
  };
  const hb = startPeerHeartbeat({
    dataDir: 'ignored',
    intervalMs: 20,
    probe,
    listPeers: () => ({ peers: [{ peerId: 'p1' }, { peerId: 'p2' }] }),
  });
  await waitFor(() => probed.length >= 4, 3000);
  hb.stop();
  const at = probed.length;
  await sleep(80);
  assert.equal(probed.length, at, 'stop 后不再探活');
  assert.ok(probed.includes('p1') && probed.includes('p2'), '逐 peer 探活');
});

test('BLOCK-164 ⑦ 心跳关闭档：intervalMs=0 完全不探活', async () => {
  const { startPeerHeartbeat } = require(ADMIN_PATH);
  let calls = 0;
  const hb = startPeerHeartbeat({
    dataDir: 'x',
    intervalMs: 0,
    probe: () => { calls += 1; return { ok: true }; },
    listPeers: () => ({ peers: [{ peerId: 'p' }] }),
  });
  await sleep(80);
  assert.equal(calls, 0, '关闭档不得探活');
  assert.equal(hb.intervalMs, 0);
  hb.stop();
});
