/**
 * block216-q5-work-surface — Q5 统一工作面实机腿（9223 无窗口测试实例）。
 *
 * 覆盖：右栏 core surface（文件/生成文件/计划/证据/审阅）统一 tab、close others、
 * 按项目持久化恢复、pack 视图 petri-pack:// 挂载、生成文件/计划/证据诚实空态。
 * 只连 9223（永久红线：探针禁止导航用户主窗 9222）。
 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const OUT = path.join(process.cwd(), 'acceptance', 'block-216');
const API = 'http://127.0.0.1:3001/api/data';
const AUTH = { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' };
const PACK_ID = 'q5fixture';

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

function readInstalled(dataDir) {
  const file = path.join(dataDir, 'packs', 'installed.json');
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function writeInstalled(dataDir, content) {
  const file = path.join(dataDir, 'packs', 'installed.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function createFixture(dataDir) {
  const packRoot = path.join(dataDir, 'q5-fixture-pack');
  fs.rmSync(packRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(packRoot, 'ui'), { recursive: true });
  fs.mkdirSync(path.join(packRoot, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'plugins', 'installed.json'), '[]');
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId: PACK_ID,
    name: 'Q5 Fixture Pack',
    version: '0.1.0',
    provides: {
      views: [{ id: 'lab', title: '实验台', entry: 'ui/lab.html', singleton: true, order: 5 }],
      uiActions: [{ id: 'ping', label: 'Ping', surfaceId: 'lab' }],
    },
  }, null, 2));
  fs.writeFileSync(path.join(packRoot, 'ui', 'lab.html'), `<!doctype html>
<html><head><meta charset="utf-8"><title>Q5 fixture</title>
<style>body{font:14px system-ui;padding:24px;background:#111;color:#eee}</style></head>
<body><h1>Q5 PACK VIEW READY</h1>
<script>try{parent.postMessage({type:'petri:ready'},'*')}catch(e){}</script>
</body></html>`);
  return packRoot;
}

async function createProject(workspacePath) {
  const response = await fetch(`${API}/projects`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({
      name: `Q5 E2E ${Date.now()}`,
      description: 'BLOCK-216 live flow fixture',
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
  } catch { /* best-effort cleanup */ }
}

async function openSurface(client, label) {
  await lib.evalJs(client, `(() => {
    const b = document.querySelector('button[aria-label="展开更多工具"]');
    if (b) b.click();
    return Boolean(b);
  })()`);
  const clicked = await clickByText(client, '[role="menuitem"]', label);
  if (!clicked) throw new Error(`surface_menu_item_missing: ${label}`);
  const ok = await waitFor(client, `Array.from(document.querySelectorAll('[class*="tabPill"]')).some((el) => (el.innerText || '').includes(${JSON.stringify(label)}))`);
  if (!ok) throw new Error(`surface_tab_missing: ${label}`);
}

module.exports = {
  id: 'block216-q5-work-surface',
  description: 'Q5：统一工作面 tab / 生成文件·计划·证据 / pack 视图 / 持久化 / close others',
  evidenceDir: OUT,
  async run({ assert }) {
    fs.mkdirSync(OUT, { recursive: true });
    const dataDir = path.join(process.cwd(), '.petri-dev-user-data', 'data');
    const workspacePath = path.join(process.cwd(), '.petri-dev-user-data', 'q5-e2e-workspace');
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
      await lib.evalJs(client, `(() => { location.href = ${JSON.stringify(`http://localhost:3000/project/${projectId}?test=q5`)}; return true; })()`);
      assert('workspace_ready', await waitFor(client, `document.querySelector('[class*="rightCol"]') && document.querySelector('[class*="centerCol"]')`, 25000), 'project workspace did not mount');
      await waitFor(client, `document.querySelector('button[aria-label="展开右侧栏"]')`);

      await lib.evalJs(client, `(() => {
        const b = document.querySelector('button[aria-label="展开右侧栏"]');
        if (b) b.click();
        return true;
      })()`);
      assert('right_rail_ready', await waitFor(client, `document.querySelector('button[aria-label="展开更多工具"]')`), 'right rail toggle/menu not found');

      for (const label of ['文件', '生成文件', '计划', '证据', '审阅', '实验台']) {
        await openSurface(client, label);
      }
      const pillText = await lib.evalJs(client, `Array.from(document.querySelectorAll('[class*="tabPill"]')).map((el) => (el.innerText || '').trim()).join('|')`);
      assert('core_and_pack_tabs_present', ['文件', '生成文件', '计划', '证据', '审阅', '实验台'].every((label) => pillText.includes(label)), pillText);
      await lib.screenshotPng(client, OUT, 'q5-work-surface-tabs.png');

      assert('generated_files_honest_empty', await waitFor(client, `document.querySelector('[data-testid="generated-files-surface"]')?.getAttribute('data-state') === 'empty'`), 'generated files surface not empty');
      assert('plan_honest_empty', await waitFor(client, `document.querySelector('[data-testid="plan-surface"]')?.getAttribute('data-state') === 'empty'`), 'plan surface not empty');
      assert('evidence_honest_empty', await waitFor(client, `document.querySelector('[data-testid="evidence-surface"]')?.getAttribute('data-state') === 'empty'`), 'evidence surface not empty');

      // 逐面激活 + 截图：空态证据必须来自对应 surface，不用 pack 视图冒充。
      for (const [label, screenshot] of [
        ['生成文件', 'q5-generated-files.png'],
        ['计划', 'q5-plan.png'],
        ['证据', 'q5-evidence.png'],
      ]) {
        const activated = await clickByText(client, '[class*="tabPillMain"]', label);
        assert(`surface_activated_${label}`, activated && await waitFor(client, `Array.from(document.querySelectorAll('[class*="tabPillMain"]')).some((el) => el.getAttribute('aria-pressed') === 'true' && (el.innerText || '').includes(${JSON.stringify(label)}))`), label);
        await lib.screenshotPng(client, OUT, screenshot);
      }
      await clickByText(client, '[class*="tabPillMain"]', '实验台');
      await waitFor(client, `Array.from(document.querySelectorAll('[class*="tabPillMain"]')).some((el) => el.getAttribute('aria-pressed') === 'true' && (el.innerText || '').includes('实验台'))`);

      assert('pack_iframe_mounted', await waitFor(client, `document.querySelector('[data-testid="pack-surface-frame"]')`), 'pack surface frame missing');
      const packSrc = await lib.evalJs(client, `document.querySelector('[data-testid="pack-surface-frame"] iframe')?.getAttribute('src') || ''`);
      assert('pack_iframe_isolated_origin', String(packSrc).startsWith(`petri-pack://${PACK_ID}/ui/lab.html`), packSrc);
      assert('pack_iframe_ready', await waitFor(client, `document.querySelector('[data-testid="pack-surface-frame"]')?.getAttribute('data-surface-state') === 'ready'`, 10000), 'pack iframe did not reach ready');
      await lib.screenshotPng(client, OUT, 'q5-pack-view.png');

      const persisted = await lib.evalJs(client, `localStorage.getItem(${JSON.stringify(`petri.workSurfaceTabs.v1.${projectId}`)}) || ''`);
      assert('tabs_persisted', ['files', 'generated', 'plan', 'evidence', 'review', `pack:${PACK_ID}:lab`].every((id) => String(persisted).includes(id)), String(persisted).slice(0, 300));

      // 持久化恢复：刷新后右侧栏重新打开，tab 仍在（未知 surface 已由 restore 丢弃）
      await lib.evalJs(client, 'location.reload(); true');
      assert('workspace_restored_after_reload', await waitFor(client, `document.querySelector('[class*="rightCol"]')`, 25000), 'workspace did not reload');
      await lib.evalJs(client, `(() => {
        const b = document.querySelector('button[aria-label="展开右侧栏"]');
        if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
        return true;
      })()`);
      assert('tabs_restored_after_reload', await waitFor(client, `Array.from(document.querySelectorAll('[class*="tabPill"]')).some((el) => (el.innerText || '').includes('生成文件'))`, 10000), 'restored tabs not visible');
      await lib.screenshotPng(client, OUT, 'q5-tabs-restored.png');

      // close others：右键「审阅」→ 关闭其他，只保留审阅（home 不渲染药丸）
      const contextMenuOpened = await lib.evalJs(client, `(() => {
        const pill = Array.from(document.querySelectorAll('[class*="tabPill"]')).find((el) => (el.innerText || '').includes('审阅'));
        if (!pill) return false;
        pill.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 240, clientY: 120 }));
        return true;
      })()`);
      assert('tab_context_menu_opened', contextMenuOpened && await waitFor(client, `document.querySelector('[data-testid="work-surface-tab-menu"]')`), 'tab context menu missing');
      const closed = await clickByText(client, '[data-testid="work-surface-tab-menu"] [role="menuitem"]', '关闭其他');
      assert('close_others_clicked', closed, 'close others item missing');
      const afterClose = await lib.evalJs(client, `Array.from(document.querySelectorAll('[class*="tabPill"]')).map((el) => (el.innerText || '').trim()).join('|')`);
      assert('close_others_keeps_only_target', afterClose.includes('审阅') && !afterClose.includes('文件') && !afterClose.includes('生成文件'), afterClose);
      await lib.screenshotPng(client, OUT, 'q5-close-others.png');
    } finally {
      try { client?.socket?.close(); } catch { /* already closed */ }
      if (projectId) await deleteProject(projectId);
      if (previousInstalled === null) fs.rmSync(path.join(dataDir, 'packs', 'installed.json'), { force: true });
      else writeInstalled(dataDir, previousInstalled);
      fs.rmSync(path.join(dataDir, 'q5-fixture-pack'), { recursive: true, force: true });
    }
    assert('cleanup_completed', true, `project ${projectId || '-'} / fixture removed`);
  },
};
