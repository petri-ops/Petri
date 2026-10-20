/**
 * block217-p2ui-actions — Q-DOMAIN P2-UI 实机腿（9223 无窗口测试实例）。
 *
 * 覆盖：fixture pack 的 uiAction 进入 Q5 host → 自动打开 pack view →
 * iframe 收到 action 并回传结果 → host 标记 data-last-action-ok。
 * backend act→ack 链由 test/block217-act-ui-actions.test.mjs 覆盖；本 flow 使用
 * 合成 ackToken（不伪造后端成功），证据只主张 host→iframe 往返。
 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const OUT = path.join(process.cwd(), 'acceptance', 'block-217');
const API = 'http://127.0.0.1:3001/api/data';
const AUTH = { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' };
const PACK_ID = 'p217fixture';
const ACTION_ID = `pack:${PACK_ID}:action:ping`;
const SURFACE_ID = `pack:${PACK_ID}:lab`;

async function waitFor(client, expression, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await lib.evalJs(client, `Boolean(${expression})`).catch(() => false);
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function clickByText(client, selector, text) {
  return lib.evalJs(client, `(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const node = nodes.find((item) => (item.innerText || item.textContent || '').includes(${JSON.stringify(text)}));
    if (!node) return false;
    node.click();
    return true;
  })()`);
}

function writeInstalled(dataDir, content) {
  const file = path.join(dataDir, 'packs', 'installed.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function readInstalled(dataDir) {
  try { return fs.readFileSync(path.join(dataDir, 'packs', 'installed.json'), 'utf8'); } catch { return null; }
}

function createFixture(dataDir) {
  const packRoot = path.join(dataDir, 'p217-fixture-pack');
  fs.rmSync(packRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(packRoot, 'ui'), { recursive: true });
  fs.mkdirSync(path.join(packRoot, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'plugins', 'installed.json'), '[]');
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId: PACK_ID,
    name: 'P2-UI Fixture Pack',
    version: '0.1.0',
    provides: {
      views: [{ id: 'lab', title: '实验台', entry: 'ui/lab.html', singleton: true, order: 5 }],
      uiActions: [{ id: 'ping', label: 'Ping', surfaceId: 'lab' }],
    },
  }, null, 2));
  fs.writeFileSync(path.join(packRoot, 'ui', 'lab.html'), `<!doctype html>
<html><head><meta charset="utf-8"><title>P2-UI fixture</title>
<style>body{font:14px system-ui;padding:20px;background:#111;color:#eee}#last{color:#7fd8a4;white-space:pre-wrap;word-break:break-all}</style></head>
<body><h1>P2-UI PACK VIEW</h1><pre id="last">none</pre>
<script>
window.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'petri:ui-action') {
    document.getElementById('last').textContent = 'ACTION:' + d.actionId + ':' + JSON.stringify(d.payload || {});
    parent.postMessage({ type: 'petri:ui-action-result', actionId: d.actionId, requestId: d.requestId, ok: true, message: 'handled' }, '*');
  }
});
parent.postMessage({ type: 'petri:ready' }, '*');
</script></body></html>`);
  return packRoot;
}

async function createProject(workspacePath) {
  const response = await fetch(`${API}/projects`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({
      name: `P2UI E2E ${Date.now()}`,
      description: 'BLOCK-217 live flow fixture',
      modality: 'general',
      workspacePath,
      workspaceKind: 'local',
    }),
  });
  const data = await response.json();
  if (!response.ok || data.status !== 'ok' || !data.project?.id) {
    throw new Error(`project_create_failed: HTTP ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.project.id;
}

async function deleteProject(projectId) {
  try {
    await fetch(`${API}/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE', headers: AUTH });
  } catch { /* best-effort */ }
}

module.exports = {
  id: 'block217-p2ui-actions',
  description: 'P2-UI：pack uiAction → Q5 host → pack iframe → result 往返',
  evidenceDir: OUT,
  async run({ assert }) {
    fs.mkdirSync(OUT, { recursive: true });
    const dataDir = path.join(process.cwd(), '.petri-dev-user-data', 'data');
    const workspacePath = path.join(process.cwd(), '.petri-dev-user-data', 'p217-e2e-workspace');
    fs.mkdirSync(workspacePath, { recursive: true });
    const previousInstalled = readInstalled(dataDir);
    const packRoot = createFixture(dataDir);
    writeInstalled(dataDir, JSON.stringify([{
      packId: PACK_ID,
      packRoot,
      version: '0.1.0',
      requiresRuntimes: [],
      installedAt: new Date().toISOString(),
    }], null, 2));

    let projectId = null;
    let client = null;
    try {
      projectId = await createProject(workspacePath);
      client = await lib.connectTestTarget({ timeoutMs: 30000 });
      await lib.evalJs(client, `(() => { location.href = ${JSON.stringify(`http://localhost:3000/project/${projectId}?test=p217`)}; return true; })()`);
      assert('workspace_ready', await waitFor(client, `document.querySelector('[class*="rightCol"]') && document.querySelector('[class*="centerCol"]')`, 25000), 'project workspace did not mount');
      await waitFor(client, `document.querySelector('button[aria-label="展开右侧栏"]')`);
      await lib.evalJs(client, `(() => { const b = document.querySelector('button[aria-label="展开右侧栏"]'); if (b) b.click(); return true; })()`);
      assert('right_rail_ready', await waitFor(client, `document.querySelector('button[aria-label="展开更多工具"]')`), 'right rail not ready');
      await lib.evalJs(client, `(() => { const b = document.querySelector('button[aria-label="展开更多工具"]'); if (b) b.click(); return true; })()`);
      assert('pack_action_visible_in_menu', await waitFor(client, `Array.from(document.querySelectorAll('[role="menuitem"]')).some((el) => (el.innerText || '').includes('实验台'))`), 'pack view menu item missing (contributions not loaded)');
      await clickByText(client, '[role="menuitem"]', '实验台');
      assert('pack_view_mounted', await waitFor(client, `document.querySelector('[data-testid="pack-surface-frame"][data-surface-state="ready"]')`), 'pack view not ready');

      // Synthetic uiActionRequest: same window event the unexpired tool_result path emits.
      const dispatched = await lib.evalJs(client, `(() => {
        window.dispatchEvent(new CustomEvent('petri:ui-action-request', { detail: {
          actionId: ${JSON.stringify(ACTION_ID)},
          surfaceId: ${JSON.stringify(SURFACE_ID)},
          packId: ${JSON.stringify(PACK_ID)},
          ackToken: 'ack_block217_live_fake',
          payload: { cluster: '5' }
        }}));
        return true;
      })()`);
      assert('ui_action_request_dispatched', dispatched, 'dispatch failed');
      assert('host_roundtrip_result', await waitFor(client, `document.querySelector('[data-testid="pack-surface-frame"]')?.getAttribute('data-last-action-ok') === 'true'`, 10000), 'pack iframe did not return an action result');
      const roundtripId = await lib.evalJs(client, `document.querySelector('[data-testid="pack-surface-frame"]')?.getAttribute('data-last-action-id') || ''`);
      assert('host_roundtrip_action_id', roundtripId === ACTION_ID, roundtripId);
      await lib.screenshotPng(client, OUT, 'block217-ui-action-roundtrip.png');
    } finally {
      try { client?.socket?.close(); } catch { /* already closed */ }
      if (projectId) await deleteProject(projectId);
      if (previousInstalled === null) fs.rmSync(path.join(dataDir, 'packs', 'installed.json'), { force: true });
      else writeInstalled(dataDir, previousInstalled);
      fs.rmSync(path.join(dataDir, 'p217-fixture-pack'), { recursive: true, force: true });
    }
    assert('cleanup_completed', true, `project ${projectId || '-'} / fixture removed`);
  },
};
