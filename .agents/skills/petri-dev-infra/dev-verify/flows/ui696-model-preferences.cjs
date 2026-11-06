#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui696-model-preferences — UI-696 图 1 / 图 2 设置面实机腿。
 *
 * 隔离纪律（并行会话在制期）：
 *   - 不启动/不重启 Electron，不连接、不 kill 9222 用户主窗；9223 只读 DOM，
 *     记录原 URL 并在 finally 恢复；
 *   - 后端代码有改动而 :3001 是长活旧进程 ⇒ 本 flow 自起**临时隔离后端**（独立端口 +
 *     os.tmpdir 数据目录），验证当前磁盘代码，跑完 kill + 删临时目录；
 *   - 不设置任何上屏开关（隐藏窗截图失败如实标 screenshot_unavailable）。
 *
 * 断言链：
 *   R1 隔离后端健康 / R2 每模型偏好 seed 成功
 *   R3 快捷面只送 chat_model_presets 时窗口同步进权威 model_profiles
 *   R4 visible/defaultThinkingLevel/capabilities 不被归一化裁掉
 *   R5 兼容快照未被替换（id 与字段仍在）
 *   D1 默认/自定义页签在场 / D2 上下文刻度条是 range / D3 生效边界文案
 *   D4 默认页切换 / D5 模型菜单两个滑条 / D6 无横向溢出 / D7 截图（有界）
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-696');
const BACKEND_PORT = 3399;
const API = `http://127.0.0.1:${BACKEND_PORT}/api`;
const APP = 'http://localhost:3000';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };

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

module.exports = {
  id: 'ui696-model-preferences',
  description: 'UI-696 实机腿：隔离后端写回同步 + 9223 设置页/模型菜单滑条形态（离屏、自清理）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-ui696-'));
    // 空库缺 projects 表（db.js 在 require 期就 prepare）⇒ 用 SQLite backup API
    // 从已迁移的 dev 库复制一份一致快照到临时目录，绝不写用户库。
    const dbSrc = path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
    const dbDst = path.join(tmpDir, 'petri.db');
    if (fs.existsSync(dbSrc)) {
      const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
      const src = new Database(dbSrc, { readonly: true });
      await src.backup(dbDst);
      src.close();
    }
    const backend = spawn(process.execPath, ['server.js'], {
      cwd: path.join(ROOT, 'core', 'petri-server'),
      env: {
        ...process.env,
        R_SERVER_PORT: String(BACKEND_PORT),
        PETRI_LOCAL_DATA_DIR: tmpDir,
        PETRI_DB_PATH: dbDst,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let backendLog = '';
    backend.stdout.on('data', (d) => { backendLog = (backendLog + d.toString()).slice(-4000); });
    backend.stderr.on('data', (d) => { backendLog = (backendLog + d.toString()).slice(-4000); });

    let client = null;
    let originalUrl = null;
    try {
      // ── REST 腿：当前磁盘的后端代码 ──────────────────────────
      const healthy = await waitBackend();
      assert('R1_isolated_backend_healthy', healthy, healthy ? `port ${BACKEND_PORT}` : backendLog.slice(-1200));
      if (!healthy) return false;

      const seedProfile = {
        id: 'ui696-probe', provider: 'deepseek', model: 'deepseek-chat',
        label: 'UI696 Probe', contextWindow: 64000,
        visible: false, defaultThinkingLevel: 'high', capabilities: ['chat', 'reasoning'],
      };
      const seeded = await rest('/ai/settings', {
        method: 'POST',
        body: JSON.stringify({
          model_profiles: [seedProfile],
          chat_model_presets: [seedProfile],
          model_role_bindings: { chat: 'ui696-probe' },
        }),
      });
      assert('R2_seed_preferences', seeded.ok, JSON.stringify(seeded.data || {}).slice(0, 200));

      const quick = await rest('/ai/settings', {
        method: 'POST',
        body: JSON.stringify({ chat_model_presets: [{ ...seedProfile, contextWindow: 200000 }] }),
      });
      assert('R3_quick_patch_accepted', quick.ok, `status=${quick.status}`);

      const after = await rest('/ai/settings');
      const settings = after.data?.settings || {};
      const profile = (settings.model_profiles || []).find((p) => p.id === 'ui696-probe');
      const preset = (settings.chat_model_presets || []).find((p) => p.id === 'ui696-probe');
      assert('R4_window_synced_to_authoritative_profiles', profile?.contextWindow === 200000,
        `model_profiles.contextWindow=${profile?.contextWindow}（期望 200000）`);
      assert('R5_other_preferences_preserved',
        profile?.visible === false && profile?.defaultThinkingLevel === 'high'
        && Array.isArray(profile?.capabilities) && profile.capabilities.includes('reasoning'),
        JSON.stringify({ visible: profile?.visible, level: profile?.defaultThinkingLevel, caps: profile?.capabilities }));
      assert('R6_compat_snapshot_window_in_sync',
        !!preset && preset.label === 'UI696 Probe' && preset.contextWindow === 200000,
        `chat_model_presets=${JSON.stringify(preset || null).slice(0, 200)}`);

      // ── DOM 腿：9223 测试实例，只读 + 恢复原 URL ──────────────
      client = await lib.connectTestTarget({ timeoutMs: 30_000 });
      originalUrl = JSON.parse(await lib.evalJs(client, `JSON.stringify(location.href)`).catch(() => 'null'));

      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/settings?section=models`)}; 'ok'`);
      await sleep(3000);
      const c2 = await lib.connectTestTarget({ timeoutMs: 15_000 });
      try { client.socket.close(); } catch { /* ignore */ }
      client = c2;

      const settingsDom = JSON.parse(await lib.evalJs(client, `(function(){
        var tabs = [].slice.call(document.querySelectorAll('[role="tab"]')).map(function(b){
          return { text: (b.innerText||'').trim(), selected: b.getAttribute('aria-selected') };
        });
        var scales = [].slice.call(document.querySelectorAll('input[aria-label="上下文窗口"]'));
        var hint = [].slice.call(document.querySelectorAll('span')).some(function(s){
          return (s.innerText||'').indexOf('运行中的回复保持当前设置') !== -1;
        });
        return JSON.stringify({
          tabs: tabs,
          scales: scales.map(function(el){ return { type: el.type, value: el.getAttribute('data-value'), testId: el.getAttribute('data-testid') }; }),
          hint: hint,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        });
      })()`).catch((e) => JSON.stringify({ error: e.message })));

      const tabTexts = (settingsDom.tabs || []).map((t) => t.text);
      assert('D1_default_custom_tabs', tabTexts.includes('默认') && tabTexts.includes('自定义'), JSON.stringify(tabTexts));
      const scale = (settingsDom.scales || []).find((s) => s.type === 'range');
      assert('D2_context_scale_is_range', !!scale && !!scale.value, JSON.stringify(settingsDom.scales || []).slice(0, 240));
      assert('D3_effective_boundary_hint', settingsDom.hint === true, `hint=${settingsDom.hint}`);
      assert('D4_no_horizontal_overflow_settings', settingsDom.overflow === false, `overflow=${settingsDom.overflow}`);

      const defaultSwitched = await lib.evalJs(client, `(function(){
        var b = [].slice.call(document.querySelectorAll('[role="tab"]')).find(function(x){ return (x.innerText||'').trim() === '默认'; });
        if (!b) return 'no_tab';
        b.click(); return 'clicked';
      })()`);
      await sleep(700);
      const defaultPane = await lib.evalJs(client, `document.body.innerText.indexOf('默认偏好') !== -1`);
      assert('D5_default_tab_switches', defaultSwitched === 'clicked' && defaultPane === true,
        `clicked=${defaultSwitched} pane=${defaultPane}`);

      // 模型菜单（图 1 形态）
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/?test=1`)}; 'ok'`);
      await sleep(3000);
      const c3 = await lib.connectTestTarget({ timeoutMs: 15_000 });
      try { client.socket.close(); } catch { /* ignore */ }
      client = c3;
      await lib.evalJs(client, `(function(){
        var b = document.querySelector('.sc-model-name-btn');
        if (b) b.click();
        return b ? 'clicked' : 'no_button';
      })()`).catch(() => 'no_button');
      await sleep(1200);
      const menu = JSON.parse(await lib.evalJs(client, `(function(){
        var q = document.querySelector('[data-testid="model-menu-quick"]');
        if (!q) return JSON.stringify({ present: false });
        var ranges = [].slice.call(q.querySelectorAll('input[type="range"]'));
        return JSON.stringify({
          present: true,
          ranges: ranges.map(function(r){ return { label: r.getAttribute('aria-label'), testId: r.getAttribute('data-testid'), disabled: r.disabled }; }),
          text: (q.innerText||'').slice(0, 220),
        });
      })()`).catch((e) => JSON.stringify({ error: e.message })));
      const labels = (menu.ranges || []).map((r) => r.label);
      assert('D6_model_menu_two_sliders', menu.present === true
        && labels.includes('上下文窗口') && labels.includes('思考强度'),
        JSON.stringify(menu).slice(0, 300));

      let shot = 'captured';
      try {
        await lib.screenshotPng(client, EVIDENCE, 'ui696-model-preferences.png');
      } catch (e) {
        shot = `screenshot_unavailable: ${e.message}`;
      }
      assert('D7_screenshot_or_honest_degrade', true, shot);
      return true;
    } finally {
      if (client) {
        if (originalUrl && typeof originalUrl === 'string') {
          await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'restored'`).catch(() => {});
        }
        try { client.socket.close(); } catch { /* ignore */ }
      }
      try { backend.kill('SIGTERM'); } catch { /* ignore */ }
      await sleep(400);
      try { if (backend.exitCode === null) backend.kill('SIGKILL'); } catch { /* ignore */ }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  },
};
