#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: block456-live — BLOCK-456 / UI-707 模型级上下文/思考档 + 行悬停配置实机腿。
 *
 * 隔离纪律（用户主栈零触碰，block455-live 同构）：
 *   - :3001 长活旧后端不重启、9222 用户主窗不连接不 kill；
 *   - 自起临时隔离后端（:3399 + os.tmpdir 数据目录 + dev 库 SQLite backup 快照，
 *     当前磁盘代码）与模型列表 stub（:3398）；
 *   - 测试实例直起 Electron attach :3399（9223 专属，离屏，绝不设 PETRI_TEST_ONSCREEN；
 *     PETRI_LOCAL_DATA_DIR 与后端同源 tmpDir）；跑完杀实例 + 后端 + stub + 删临时目录；
 *   - 9223 启动前被占用 ⇒ 诚实中止（不代杀他人实例）。
 *
 * 断言链：
 *   S0 9223 空闲 / R1 隔离后端健康 / R2 seed 接受 / R3 modelPreferences 读回（渠道 fallback 不动）
 *   T1 测试实例就绪
 *   W1 设置页表头 8 列无「上下文」/ W2 网格 8 轨道 minWidth 1000 对齐
 *   M1 模型菜单 quick 块退役 + 行内配置抽屉在场（默认收起）
 *   M2 聚焦展开（focus-within；合成 mouseMoved 不触发 :hover，键盘等价路径实证）
 *   M3 值跟模型走：mini=模型级覆写 64000 / gpt-4o=渠道 fallback 128000（legacy 零变化）；
 *      mini 未声明 reasoning → 思考滑条禁 + 原因
 *   M4 写盘回环：gpt-4o 上下文 200000 + 思考 high → modelPreferences 落盘，
 *      渠道 fallback 不被污染、其它模型 fallback 不被物化
 *   M5 发送档跟模型（UI 实发 /ai/agent 请求体层）：gpt-4o→high / mini→standard（渠道兜底）
 *   M6 会话显式覆写优先：brain 菜单设 off → 切模型不回洗 → 实发 off
 *   M7 auto 发送档跟模型：清显式键 + 开 auto → 实发 high（auto 解析模型的模型级默认）
 *   截图：菜单抽屉展开 / 设置页宽态（离屏失败诚实降级）
 *
 * 诚实边界：stub 无真实模型，/v1/chat/completions 返回 404 ⇒ 运行本身失败属预期；
 * 发送档证据取「UI 实发请求体」（fetch recorder），后端消费面（agent-runner/ai-chat
 * 读 resolveModelContextWindow）由 test/block456-model-preferences.test.mjs 契约层覆盖。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-456');
const BACKEND_PORT = 3399;
const STUB_PORT = 3398;
const API = `http://127.0.0.1:${BACKEND_PORT}/api`;
const APP = 'http://localhost:3000';
const AUTH = { ...require('../local-token.cjs')(), Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(endpoint, options = {}) {
  const resp = await fetch(API + endpoint, { headers: AUTH, ...options });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
}

async function waitBackend(deadlineMs = 40_000) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

function listenerPid(port) {
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout || '';
      const line = out.split(/\r?\n/).find((l) => l.includes(`:${port}`) && /LISTENING/.test(l));
      return line ? line.trim().split(/\s+/).pop() : null;
    }
    const out = spawnSync('lsof', ['-tnP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout || '';
    return out.trim().split(/\s+/)[0] || null;
  } catch { return null; }
}

function killTree(pid) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
    else process.kill(Number(pid), 'SIGKILL');
  } catch { /* already gone */ }
}

const RECT_HELPER = `function rect(el){ if(!el) return null; var r = el.getBoundingClientRect();
  return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height, right: r.right + window.scrollX, bottom: r.bottom + window.scrollY }; }`;

async function clipShot(client, filename, rectExpr) {
  const raw = await lib.evalJs(client, rectExpr).catch(() => 'null');
  const r = raw && raw !== 'null' ? JSON.parse(raw) : null;
  if (!r || !(r.w > 0) || !(r.h > 0)) return 'no_rect';
  const clip = { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.w + 16, height: r.h + 16, scale: 1 };
  let shot;
  try {
    shot = await client.send('Page.captureScreenshot', { format: 'png', clip }, { timeoutMs: 12_000 });
  } catch {
    shot = await client.send('Page.captureScreenshot', { format: 'png', clip, fromSurface: false }, { timeoutMs: 12_000 });
  }
  fs.writeFileSync(path.join(EVIDENCE, filename), Buffer.from(shot.data, 'base64'));
  return 'captured';
}

async function fullShot(client, filename) {
  let shot;
  try {
    shot = await client.send('Page.captureScreenshot', { format: 'png' }, { timeoutMs: 12_000 });
  } catch {
    shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: false }, { timeoutMs: 12_000 });
  }
  fs.writeFileSync(path.join(EVIDENCE, filename), Buffer.from(shot.data, 'base64'));
  return 'captured';
}

/* ── composer 探针 ─────────────────────────────────────────────────────── */

const OPEN_MENU = `(function(){
  if (document.querySelector('[data-testid="model-menu"]')) return 'already_open';
  var b = document.querySelector('[data-testid="model-chip-model"]');
  if (!b) return 'no_chip';
  b.click(); return 'clicked';
})()`;

const MENU_STATE = `(function(){
  var quick = document.querySelector('[data-testid="model-menu-quick"]');
  var panel = document.querySelector('[data-testid="model-menu-models-panel"]');
  var configs = [].slice.call(document.querySelectorAll('[data-testid^="model-row-config-"]'));
  function info(id){
    var cfg = document.querySelector('[data-testid="model-row-config-' + id + '"]');
    if (!cfg) return null;
    var ctx = cfg.querySelector('[data-testid="model-row-context-' + id + '"]');
    var think = cfg.querySelector('[data-testid="model-row-thinking-' + id + '"]');
    return {
      display: getComputedStyle(cfg).display,
      ctxValue: ctx ? ctx.getAttribute('data-value') : null,
      thinkLevel: think ? think.getAttribute('data-level') : null,
      thinkDisabled: think ? think.disabled : null,
      reason: (cfg.innerText||'').indexOf('未声明思考能力') !== -1
    };
  }
  return JSON.stringify({
    menu: !!document.querySelector('[data-testid="model-menu"]'),
    quick: !!quick,
    panel: !!panel,
    configs: configs.length,
    main: info('b456-main::gpt-4o'),
    mini: info('b456-main::gpt-4o-mini')
  });
})()`;

const FOCUS_MAIN_ROW = `(function(){
  var row = document.querySelector('[data-testid="model-row-b456-main::gpt-4o"] .sc-model-option');
  if (!row) return 'no_row';
  row.focus();
  var cfg = document.querySelector('[data-testid="model-row-config-b456-main::gpt-4o"]');
  return cfg ? getComputedStyle(cfg).display : 'no_config';
})()`;

// React 受控 range：native setter + input/change 双事件（ChangeEventPlugin 两路都听）
const WRITE_MAIN_CONFIG = `(function(){
  var ctx = document.querySelector('[data-testid="model-row-context-b456-main::gpt-4o"]');
  if (!ctx) return 'no_ctx';
  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(ctx, '3');
  ctx.dispatchEvent(new Event('input', { bubbles: true }));
  ctx.dispatchEvent(new Event('change', { bubbles: true }));
  var cfg = document.querySelector('[data-testid="model-row-config-b456-main::gpt-4o"]');
  var tick = cfg && cfg.querySelector('button[aria-label="思考强度：高"]');
  if (tick) tick.click();
  return tick ? 'written' : 'no_tick';
})()`;

const PICK_MODEL = (id) => `(function(){
  var row = document.querySelector('[data-testid="model-row-${id}"] .sc-model-option');
  if (!row) return 'no_row';
  if (row.disabled) return 'disabled';
  row.click(); return 'picked';
})()`;

const TRIGGER_LEVEL = `(function(){
  var el = document.querySelector('[data-testid="thinking-level-trigger"]');
  return el ? el.getAttribute('data-level') : null;
})()`;

const SET_EXPLICIT_OFF = `(function(){
  var t = document.querySelector('[data-testid="thinking-level-trigger"]');
  if (!t) return 'no_trigger';
  t.click();
  return 'opened';
})()`;

const CLEAR_EXPLICIT_KEYS = `(function(){
  var removed = 0;
  for (var i = window.localStorage.length - 1; i >= 0; i -= 1) {
    var k = window.localStorage.key(i);
    if (k && k.indexOf('petri:thinking-level:') === 0) { window.localStorage.removeItem(k); removed += 1; }
  }
  return 'removed:' + removed;
})()`;

const INSTALL_RECORDER = `(function(){
  window.__b456sent = [];
  if (!window.__b456patched) {
    window.__b456patched = true;
    var orig = window.fetch;
    window.fetch = function () {
      try {
        var a = arguments[0], b = arguments[1];
        var url = typeof a === 'string' ? a : (a && a.url);
        if (String(url).indexOf('/ai/agent') >= 0 && b && b.method === 'POST') {
          window.__b456sent.push(String(b.body || ''));
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
  }
  return 'installed';
})()`;

const READ_RECORDER = `JSON.stringify(window.__b456sent || [])`;

const TYPE_AND_SEND = (text) => `(function(){
  var ta = document.querySelector('textarea.sc-input');
  if (!ta) return 'no_textarea';
  var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(text)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`;

const CLICK_SEND = `(function(){
  var b = [].slice.call(document.querySelectorAll('button')).find(function (x) {
    var t = (x.getAttribute('title') || '') + ' ' + (x.getAttribute('aria-label') || '');
    return t.indexOf('发送消息') >= 0;
  });
  if (!b) return 'send_button_missing';
  if (b.disabled) return 'send_disabled';
  b.click();
  return 'sent';
})()`;

async function readSentBodies(client) {
  const raw = await lib.evalJs(client, READ_RECORDER).catch(() => '[]');
  return JSON.parse(raw || '[]').map((body) => {
    try {
      const parsed = JSON.parse(body);
      return {
        modelPresetId: parsed.modelPresetId || null,
        modelName: parsed.modelName || null,
        thinkingLevel: parsed.thinkingLevel === undefined ? null : parsed.thinkingLevel,
      };
    } catch {
      return { unparsed: String(body).slice(0, 120) };
    }
  });
}

/** 发送一轮并等新请求体入 recorder（stub 无真实模型，运行失败属预期，只取实发体）。 */
async function sendRound(client, text, expectCount) {
  const typed = await lib.evalJs(client, TYPE_AND_SEND(text));
  await sleep(700);
  let sent = 'send_disabled';
  for (let i = 0; i < 20; i += 1) {
    sent = await lib.evalJs(client, CLICK_SEND);
    if (sent === 'sent') break;
    await sleep(1000);
  }
  let bodies = [];
  for (let i = 0; i < 15; i += 1) {
    await sleep(1000);
    bodies = await readSentBodies(client);
    if (bodies.length >= expectCount) break;
  }
  return { typed, sent, bodies };
}

module.exports = {
  id: 'block456-live',
  description: 'BLOCK-456/UI-707 实机腿：隔离后端 → 行悬停配置/模型级写盘回环/发送档跟模型/设置页上下文退役（离屏、自清理）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    const occupant = listenerPid(9223);
    assert('S0_9223_free_before_start', !occupant, occupant ? `9223 被 pid ${occupant} 占用——不代杀，中止` : 'free');
    if (occupant) return false;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b456-'));
    const dbSrc = path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
    const dbDst = path.join(tmpDir, 'petri.db');
    if (fs.existsSync(dbSrc)) {
      const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
      const src = new Database(dbSrc, { readonly: true });
      await src.backup(dbDst);
      src.close();
    }

    // stub：GET /models 供发现；其余（含 chat/completions）404——发送档只取 UI 实发体。
    const stub = http.createServer((req, res) => {
      if (req.method === 'GET' && /\/models\/?$/.test(req.url || '')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":{"message":"stub: no real model (send-tier evidence is UI request body)"}}');
    });
    await new Promise((resolve) => stub.listen(STUB_PORT, '127.0.0.1', resolve));

    const backend = spawn(process.execPath, ['server.js'], {
      cwd: path.join(ROOT, 'core', 'petri-server'),
      env: { ...process.env, R_SERVER_PORT: String(BACKEND_PORT), PETRI_LOCAL_DATA_DIR: tmpDir, PETRI_DB_PATH: dbDst },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let backendLog = '';
    backend.stdout.on('data', (d) => { backendLog = (backendLog + d.toString()).slice(-4000); });
    backend.stderr.on('data', (d) => { backendLog = (backendLog + d.toString()).slice(-4000); });

    let client = null;
    let originalUrl = null;
    let instanceStarted = false;
    let launcher = null;
    let probeProjectId = null;
    const observations = {};
    try {
      const healthy = await waitBackend();
      assert('R1_isolated_backend_healthy', healthy, healthy ? `port ${BACKEND_PORT}` : backendLog.slice(-1200));
      if (!healthy) return false;

      const mainProfile = {
        id: 'b456-main', provider: 'openai-compatible', label: 'B456 主渠道',
        baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`,
        model: 'gpt-4o', defaultModel: 'gpt-4o', contextWindow: 128000, visible: true,
        defaultThinkingLevel: 'standard',
        capabilities: ['chat', 'streaming', 'tools'],
        modelCapabilities: {
          'gpt-4o': ['chat', 'streaming', 'tools', 'reasoning'],
          'gpt-4o-mini': ['chat', 'streaming', 'tools'],
        },
        modelPreferences: { 'gpt-4o-mini': { contextWindow: 64000 } },
      };
      const seeded = await rest('/ai/settings', {
        method: 'POST',
        body: JSON.stringify({
          model_profiles: [mainProfile],
          chat_model_presets: [{ id: 'b456-main', label: 'B456 主渠道', provider: 'openai-compatible', model: 'gpt-4o', defaultModel: 'gpt-4o', baseUrl: mainProfile.baseUrl, contextWindow: 128000 }],
          model_role_bindings: { chat: 'b456-main', agent: 'b456-main' },
        }),
      });
      assert('R2_seed_accepted', seeded.ok, `status=${seeded.status} ${JSON.stringify(seeded.data || {}).slice(0, 160)}`);

      const readback = await rest('/ai/settings');
      const rbMain = ((readback.data?.settings || {}).model_profiles || []).find((p) => p.id === 'b456-main');
      assert('R3_model_preferences_persisted',
        rbMain?.modelPreferences?.['gpt-4o-mini']?.contextWindow === 64000
        && rbMain?.contextWindow === 128000 && rbMain?.defaultThinkingLevel === 'standard',
        JSON.stringify({ prefs: rbMain?.modelPreferences, ctx: rbMain?.contextWindow, think: rbMain?.defaultThinkingLevel }).slice(0, 260));

      // ── 测试实例（block455-live 同构：数据目录与隔离后端同源 tmpDir） ──
      const instanceEnv = {
        ...process.env,
        PETRI_TEST_INSTANCE: '1',
        PETRI_ELECTRON_USER_DATA_DIR: path.join(ROOT, '.petri-test-user-data'),
        PETRI_ELECTRON_LOG_PATH: path.join(ROOT, '.petri-test-instance.log'),
        R_SERVER_PORT: String(BACKEND_PORT),
        PETRI_LOCAL_DATA_DIR: tmpDir,
        PETRI_DB_PATH: dbDst,
      };
      delete instanceEnv.PETRI_TEST_ONSCREEN;
      delete instanceEnv.ELECTRON_RUN_AS_NODE;
      fs.mkdirSync(instanceEnv.PETRI_ELECTRON_USER_DATA_DIR, { recursive: true });
      const instanceOut = fs.openSync(path.join(ROOT, '.petri-test-instance.log'), 'a');
      const instanceErr = fs.openSync(path.join(ROOT, '.petri-test-instance.err.log'), 'a');
      launcher = spawn(process.execPath, ['node_modules/electron/cli.js', '.', '--dev', '--remote-debugging-port=9223'], {
        cwd: ROOT, env: instanceEnv, stdio: ['ignore', instanceOut, instanceErr],
      });
      launcher.unref();
      try { fs.closeSync(instanceOut); fs.closeSync(instanceErr); } catch { /* ignore */ }
      let ready = false;
      const readyDeadline = Date.now() + 150_000;
      while (Date.now() < readyDeadline) {
        try {
          const targets = await lib.pollTargets({ port: 9223, timeoutMs: 2000 });
          if (targets.some((t) => t.type === 'page' && String(t.url).includes('test=1'))) { ready = true; break; }
        } catch { /* not up yet */ }
        await sleep(1500);
      }
      instanceStarted = true;
      assert('T1_test_instance_ready', ready, ready ? 'test=1 target on 9223' : '150s 内 9223 未出现 test=1 目标（日志 .petri-test-instance.err.log）');
      if (!ready) return false;

      client = await lib.connectTestTarget({ timeoutMs: 30_000 });
      // 生产 CSP connect-src 只放行 :3000/:3001（csp-config.js），渲染层直连隔离后端
      // :3399 会被拦（getProject「Failed to fetch」→ 项目不存在假象）。测试目标页
      // 级 bypass，零生产代码改动；仅作用于 9223 测试实例页面。
      await client.send('Page.setBypassCSP', { enabled: true }, { timeoutMs: 10_000 });
      originalUrl = JSON.parse(await lib.evalJs(client, `JSON.stringify(location.href)`).catch(() => 'null'));

      // ── 设置页腿：上下文列退役（8 列 / 8 轨道 / minWidth 1000） ──
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/settings?section=models`)}; 'ok'`);
      await sleep(4500);
      const c2 = await lib.connectTestTarget({ timeoutMs: 15_000 });
      try { client.socket.close(); } catch { /* ignore */ }
      client = c2;
      await client.send('Page.setBypassCSP', { enabled: true }, { timeoutMs: 10_000 });
      await client.send('Emulation.setDeviceMetricsOverride', { width: 2400, height: 1400, deviceScaleFactor: 1, mobile: false }, { timeoutMs: 10_000 });
      await sleep(1000);
      const settingsProbe = JSON.parse(await lib.evalJs(client, `(function(){
        function tracks(el){ return getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).map(function(c){ return Math.round(parseFloat(c)); }); }
        var header = document.querySelector('.petri-endpoint-list-header');
        var grid = document.querySelector('.petri-endpoint-card__grid[aria-label="B456 主渠道 模型渠道"]');
        return JSON.stringify({
          headerTexts: header ? [].slice.call(header.children).map(function(k){ return (k.innerText||'').trim(); }) : null,
          headerTracks: header ? tracks(header) : null,
          gridTracks: grid ? tracks(grid) : null,
          headerMin: header ? Math.round(parseFloat(getComputedStyle(header).minWidth)||0) : null,
          gridMin: grid ? Math.round(parseFloat(getComputedStyle(grid).minWidth)||0) : null,
          scales: document.querySelectorAll('input[aria-label="上下文窗口"]').length
        });
      })()`));
      const ht = settingsProbe.headerTexts || [];
      assert('W1_settings_header_no_context_column',
        ht.length === 8 && !ht.includes('上下文') && ht.includes('默认模型') && ht.includes('连通性')
        && settingsProbe.scales === 0,
        JSON.stringify(settingsProbe).slice(0, 300));
      const hTracks = settingsProbe.headerTracks || [];
      const gTracks = settingsProbe.gridTracks || [];
      assert('W2_settings_grid_eight_tracks',
        hTracks.length === 8 && gTracks.length === 8
        && hTracks.every((w, i) => Math.abs(w - gTracks[i]) <= 2)
        && settingsProbe.headerMin === 1000 && settingsProbe.gridMin === 1000,
        `header=[${hTracks}] grid=[${gTracks}] min=${settingsProbe.headerMin}/${settingsProbe.gridMin}`);
      let settingsShot = 'captured';
      try { await fullShot(client, 'block456-settings-wide.png'); } catch (e) { settingsShot = `screenshot_unavailable: ${e.message}`; }

      // ── composer 腿（REST 建临时项目，跑完删除；快照库首项目可能已归档不可访问） ──
      const created = await rest('/data/projects', {
        method: 'POST',
        body: JSON.stringify({ name: `B456-live-${Date.now()}`, modality: 'general' }),
      });
      probeProjectId = created.data?.project?.id || null;
      const projectId = probeProjectId;
      assert('C0_project_available', created.status === 200 && !!projectId, JSON.stringify(created.data || {}).slice(0, 160));
      if (!projectId) return false;
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/${projectId}`)}; 'ok'`);
      await sleep(6000);
      const c3 = await lib.connectTestTarget({ timeoutMs: 15_000 });
      try { client.socket.close(); } catch { /* ignore */ }
      client = c3;
      await client.send('Page.setBypassCSP', { enabled: true }, { timeoutMs: 10_000 });
      await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false }, { timeoutMs: 10_000 });
      let composerReady = false;
      for (let i = 0; i < 30; i += 1) {
        composerReady = (await lib.evalJs(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false)) === true;
        if (composerReady) break;
        await sleep(1000);
      }
      assert('C1_composer_ready', composerReady, composerReady ? `project=${projectId}` : JSON.stringify({
        project: projectId,
        page: JSON.parse(await lib.evalJs(client, `JSON.stringify({
          url: location.href,
          textareas: document.querySelectorAll('textarea').length,
          bodyHead: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0, 400)
        })`).catch(() => 'null')),
      }));
      if (!composerReady) return false;
      await lib.evalJs(client, CLEAR_EXPLICIT_KEYS);
      await lib.evalJs(client, INSTALL_RECORDER);

      const opened = await lib.evalJs(client, OPEN_MENU);
      await sleep(1200);
      let menu = JSON.parse(await lib.evalJs(client, MENU_STATE));
      observations.menuInitial = menu;
      assert('M1_quick_retired_row_configs_present',
        (opened === 'clicked' || opened === 'already_open') && menu.menu === true && menu.quick === false && menu.panel === true && menu.configs >= 2
        && menu.main?.display === 'none' && menu.mini?.display === 'none',
        JSON.stringify(menu).slice(0, 320));

      const focusedDisplay = await lib.evalJs(client, FOCUS_MAIN_ROW);
      assert('M2_drawer_expands_on_focus', focusedDisplay === 'flex', `focus-within display=${focusedDisplay}（合成 mouseMoved 不触发 :hover，键盘等价路径）`);

      menu = JSON.parse(await lib.evalJs(client, MENU_STATE));
      assert('M3_values_follow_model',
        menu.mini?.ctxValue === '64000' && menu.main?.ctxValue === '128000'
        && menu.mini?.thinkDisabled === true && menu.mini?.reason === true
        && menu.main?.thinkDisabled === false && menu.main?.thinkLevel === 'standard',
        JSON.stringify({ main: menu.main, mini: menu.mini }).slice(0, 320));

      // ── M4 写盘回环（模型级，不污染渠道 fallback） ────────────
      const written = await lib.evalJs(client, WRITE_MAIN_CONFIG);
      await sleep(3000);
      const afterWrite = await rest('/ai/settings');
      const awMain = ((afterWrite.data?.settings || {}).model_profiles || []).find((p) => p.id === 'b456-main');
      const awPrefs = awMain?.modelPreferences || {};
      observations.afterWrite = { prefs: awPrefs, ctx: awMain?.contextWindow, think: awMain?.defaultThinkingLevel };
      assert('M4_model_level_write_roundtrip',
        written === 'written'
        && awPrefs['gpt-4o']?.contextWindow === 200000 && awPrefs['gpt-4o']?.thinkingLevel === 'high'
        && awMain?.contextWindow === 128000 && awMain?.defaultThinkingLevel === 'standard'
        && awPrefs['gpt-4o-mini']?.contextWindow === 64000 && awPrefs['gpt-4o-mini']?.thinkingLevel === undefined,
        JSON.stringify({ written, ...observations.afterWrite }).slice(0, 360));
      const noticeText = await lib.evalJs(client, `(function(){
        var n = document.querySelector('[data-testid="model-menu-quick-notice"]');
        return n ? (n.textContent||'') : null;
      })()`);
      assert('M4b_save_notice_visible', typeof noticeText === 'string' && noticeText.includes('已保存'), `notice=${noticeText}`);

      let drawerShot = 'captured';
      try {
        await lib.evalJs(client, FOCUS_MAIN_ROW);
        drawerShot = await clipShot(client, 'block456-row-drawer.png', `(function(){
          ${RECT_HELPER}
          var panel = document.querySelector('[data-testid="model-menu-models-panel"]');
          if (panel) panel.scrollIntoView({ block: 'center' });
          return JSON.stringify(rect(panel));
        })()`);
      } catch (e) { drawerShot = `screenshot_unavailable: ${e.message}`; }
      assert('M4c_screenshots_or_honest_degrade', true, JSON.stringify({ settingsShot, drawerShot }));

      // ── M5 发送档跟模型（UI 实发请求体层） ────────────────────
      await lib.evalJs(client, OPEN_MENU).catch(() => null);
      await sleep(800);
      const pickMain = await lib.evalJs(client, PICK_MODEL('b456-main::gpt-4o'));
      await sleep(1200);
      const levelMain = await lib.evalJs(client, TRIGGER_LEVEL);
      const round1 = await sendRound(client, 'BLOCK-456 探针一（gpt-4o，模型默认 high）', 1);
      const body1 = round1.bodies[round1.bodies.length - 1];
      assert('M5_send_tier_follows_model_default',
        pickMain === 'picked' && levelMain === 'high'
        && body1?.thinkingLevel === 'high' && body1?.modelName === 'gpt-4o' && body1?.modelPresetId === 'b456-main',
        JSON.stringify({ pickMain, levelMain, sent: round1.sent, body: body1 }).slice(0, 300));

      await lib.evalJs(client, OPEN_MENU).catch(() => null);
      await sleep(800);
      const pickMini = await lib.evalJs(client, PICK_MODEL('b456-main::gpt-4o-mini'));
      await sleep(1200);
      const round2 = await sendRound(client, 'BLOCK-456 探针二（mini，渠道兜底 standard）', 2);
      const body2 = round2.bodies[round2.bodies.length - 1];
      assert('M5b_send_tier_channel_fallback',
        pickMini === 'picked' && body2?.thinkingLevel === 'standard'
        && body2?.modelName === 'gpt-4o-mini' && body2?.modelPresetId === 'b456-main',
        JSON.stringify({ pickMini, sent: round2.sent, body: body2 }).slice(0, 300));

      // ── M6 会话显式覆写优先（brain 菜单 off → 切模型不回洗） ──
      await lib.evalJs(client, OPEN_MENU).catch(() => null);
      await sleep(800);
      await lib.evalJs(client, PICK_MODEL('b456-main::gpt-4o'));
      await sleep(1200);
      const openedBrain = await lib.evalJs(client, SET_EXPLICIT_OFF);
      await sleep(600);
      const offClicked = await lib.evalJs(client, `(function(){
        var o = document.querySelector('[data-testid="thinking-level-option-off"]');
        if (!o) return 'option_missing';
        o.click(); return 'clicked';
      })()`);
      await sleep(800);
      await lib.evalJs(client, OPEN_MENU).catch(() => null);
      await sleep(800);
      await lib.evalJs(client, PICK_MODEL('b456-main::gpt-4o-mini'));
      await sleep(1000);
      await lib.evalJs(client, OPEN_MENU).catch(() => null);
      await sleep(800);
      await lib.evalJs(client, PICK_MODEL('b456-main::gpt-4o'));
      await sleep(1200);
      const levelAfterSwitch = await lib.evalJs(client, TRIGGER_LEVEL);
      const round3 = await sendRound(client, 'BLOCK-456 探针三（显式 off 优先于模型默认 high）', 3);
      const body3 = round3.bodies[round3.bodies.length - 1];
      assert('M6_explicit_session_override_wins',
        openedBrain === 'opened' && offClicked === 'clicked' && levelAfterSwitch === 'off'
        && body3?.thinkingLevel === 'off',
        JSON.stringify({ levelAfterSwitch, sent: round3.sent, body: body3 }).slice(0, 300));

      // ── M7 auto 发送档跟模型（清显式键 → auto 解析模型的模型级默认） ──
      await lib.evalJs(client, CLEAR_EXPLICIT_KEYS);
      await lib.evalJs(client, OPEN_MENU).catch(() => null);
      await sleep(800);
      const autoToggled = await lib.evalJs(client, `(function(){
        var a = document.querySelector('[data-testid="model-menu-auto"]');
        if (!a) return 'no_auto_row';
        var on = (a.textContent||'').indexOf('开启') !== -1;
        if (!on) a.click();
        return on ? 'already_on' : 'toggled_on';
      })()`);
      await sleep(1000);
      await lib.evalJs(client, `(function(){
        var ov = document.querySelector('.sc-model-overlay');
        if (ov) ov.click();
        return 'closed';
      })()`).catch(() => null);
      await sleep(800);
      const round4 = await sendRound(client, 'BLOCK-456 探针四（auto，发送档跟解析模型）', 4);
      const body4 = round4.bodies[round4.bodies.length - 1];
      observations.autoBody = body4;
      assert('M7_auto_send_tier_follows_model',
        (autoToggled === 'toggled_on' || autoToggled === 'already_on')
        && body4?.thinkingLevel === 'high' && body4?.modelName === 'gpt-4o',
        JSON.stringify({ autoToggled, sent: round4.sent, body: body4 }).slice(0, 300));

      observations.sentBodies = await readSentBodies(client);
      fs.writeFileSync(path.join(EVIDENCE, 'block456-live-observations.json'), JSON.stringify(observations, null, 2));
      return true;
    } finally {
      if (probeProjectId) await rest(`/data/projects/${encodeURIComponent(probeProjectId)}`, { method: 'DELETE' }).catch(() => null);
      if (client) {
        try { await client.send('Emulation.clearDeviceMetricsOverride', {}, { timeoutMs: 5000 }); } catch { /* ignore */ }
        if (originalUrl && typeof originalUrl === 'string') {
          await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'restored'`).catch(() => {});
        }
        try { client.socket.close(); } catch { /* ignore */ }
      }
      if (instanceStarted) {
        const pid = listenerPid(9223);
        if (pid) killTree(pid);
      }
      try { if (launcher && launcher.exitCode === null) launcher.kill('SIGKILL'); } catch { /* ignore */ }
      try { backend.kill('SIGTERM'); } catch { /* ignore */ }
      await sleep(400);
      try { if (backend.exitCode === null) backend.kill('SIGKILL'); } catch { /* ignore */ }
      try { stub.close(); } catch { /* ignore */ }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  },
};