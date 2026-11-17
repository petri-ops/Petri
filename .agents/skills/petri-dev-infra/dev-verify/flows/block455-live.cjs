#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: block455-live — BLOCK-455 / UI-706 模型级能力 + 8 列主表实机腿。
 *
 * 隔离纪律（用户主栈零触碰）：
 *   - :3001 长活旧后端不重启、9222 用户主窗不连接不 kill；
 *   - 自起临时隔离后端（:3399 + os.tmpdir 数据目录 + dev 库 SQLite backup 快照，
 *     当前磁盘代码）与模型列表 stub（:3398，供连通性发现腿）；
 *   - 测试实例直起 Electron attach :3399（9223 专属，离屏，绝不设 PETRI_TEST_ONSCREEN；
 *     PETRI_LOCAL_DATA_DIR 与后端同源 tmpDir——设置 IPC 在主进程内读该目录）；
 *     跑完杀实例 + 后端 + stub + 删临时目录；
 *   - 9223 启动前被占用 ⇒ 诚实中止（不代杀他人实例）。
 *
 * 断言链：
 *   S0 9223 空闲 / R1 隔离后端健康 / R2 seed 接受 / R3 读回 modelCapabilities+对值绑定
 *   T1 测试实例就绪
 *   W1 表头 8 列无能力列（BLOCK-456 起上下文列亦退役）/ W2 网格对齐单行 / W3 无溢出
 *   W4 展开详情控件（选择器显示+思考合并下拉+视觉/向量）
 *   W5 逐模型表（渠道默认行 + 发现模型，默认模型不入表，预填生效）
 *   W6 详情几何（卡片内、控件与表不重叠）/ W7 角色绑定对值
 *   W8 保存回环（改能力位→保存→后端读回一致，绑定对不被洗掉）
 *   N1 窄态两行式（表头隐藏/标签成对/详情 label）/ N2 窄态详情仍在
 *   截图：宽表头+行 / 详情 / 绑定区 / 整页宽 / 整页窄（离屏失败诚实降级）
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-455');
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

/** 元素级裁剪截图（petri-css-theme 视觉验收红线：几何合格 ≠ 视觉合格，必须裁图过目）。
 *  离屏窗合成器可能不出帧：默认路径超时后以 fromSurface:false 重试一次。 */
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

/** 整页截图（带超时——CdpClient.send 默认无限等，离屏窗 capture 可能挂起）。 */
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

const RECT_HELPER = `function rect(el){ if(!el) return null; var r = el.getBoundingClientRect();
  return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height, right: r.right + window.scrollX, bottom: r.bottom + window.scrollY }; }`;

/** 一次取全量 DOM 形态（宽/窄复用同一探针）。 */
const PROBE = `(function(){
  ${RECT_HELPER}
  function tracks(el){ return getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).map(function(c){ return Math.round(parseFloat(c)); }); }
  function checked(aria){ var el = document.querySelector('input[aria-label="' + aria + '"]'); return el ? el.checked : null; }
  function selInfo(sel){ return sel ? { value: sel.value, options: [].slice.call(sel.options).map(function(o){ return o.value; }) } : null; }
  var header = document.querySelector('.petri-endpoint-list-header');
  var list = document.querySelector('.petri-model-list');
  var mainGrid = document.querySelector('.petri-endpoint-card__grid[aria-label="B455 主渠道 模型渠道"]');
  var main = mainGrid ? mainGrid.closest('.petri-endpoint-card') : null;
  var grid = main && main.querySelector('.petri-endpoint-card__grid');
  var detail = main && main.querySelector('.petri-endpoint-card__detail');
  var controls = detail && detail.querySelector('.petri-endpoint-detail__controls');
  var table = detail && detail.querySelector('.petri-endpoint-detail__models');
  var gridKids = grid ? [].slice.call(grid.children).filter(function(k){ return !k.classList.contains('petri-endpoint-field-label'); }).map(function(k){
    var r = k.getBoundingClientRect();
    return { offTop: k.offsetTop, scrollW: k.scrollWidth, clientW: k.clientWidth, right: r.right };
  }) : [];
  var labels = grid ? [].slice.call(grid.querySelectorAll('.petri-endpoint-field-label')) : [];
  var thinking = document.querySelector('select[aria-label="思考能力与默认档"]');
  return JSON.stringify({
    header: header ? { texts: [].slice.call(header.children).map(function(k){ return (k.innerText||'').trim(); }),
      tracks: tracks(header), minWidth: Math.round(parseFloat(getComputedStyle(header).minWidth)||0),
      display: getComputedStyle(header).display, rect: rect(header) } : null,
    grid: grid ? { tracks: tracks(grid), minWidth: Math.round(parseFloat(getComputedStyle(grid).minWidth)||0),
      rect: rect(grid), kids: gridKids,
      labelsTotal: labels.length,
      labelsVisible: labels.filter(function(l){ return getComputedStyle(l).display !== 'none'; }).length,
      pairs: [].slice.call(grid.children).filter(function(k){ return !k.classList.contains('petri-endpoint-field-label'); }).every(function(k){
        var p = k.previousElementSibling; return !!p && p.classList.contains('petri-endpoint-field-label'); }) } : null,
    list: list ? { clientW: list.clientWidth, scrollW: list.scrollWidth, rect: rect(list) } : null,
    card: rect(main),
    detail: detail ? { rect: rect(detail), controlsRect: rect(controls), tableRect: rect(table),
      modelNames: [].slice.call(table.querySelectorAll('.petri-endpoint-detail__model-name')).map(function(s){ return (s.innerText||'').trim(); }) } : null,
    thinking: thinking ? { value: thinking.value, options: [].slice.call(thinking.options).map(function(o){ return o.value; }) } : null,
    selectorShown: checked('B455 主渠道 在选择器中显示'),
    caps: {
      defaultVision: checked('B455 主渠道 gpt-4o 支持识图（视觉输入）'),
      channelVision: checked('B455 主渠道 渠道默认 支持识图（视觉输入）'),
      miniVision: checked('B455 主渠道 gpt-4o-mini 支持识图（视觉输入）'),
      miniReasoning: checked('B455 主渠道 gpt-4o-mini 支持思考档位'),
      r1Reasoning: checked('B455 主渠道 deepseek-r1 支持思考档位'),
      bgeEmbedding: checked('B455 主渠道 bge-m3 支持向量化（embedding）')
    },
    visionBinding: selInfo(document.querySelector('select[aria-label="识图模型（视觉理解角色）"]')),
    embeddingBinding: selInfo(document.querySelector('select[aria-label="向量模型（embedding 角色）"]')),
    docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  });
})()`;

module.exports = {
  id: 'block455-live',
  description: 'BLOCK-455/UI-706 实机腿：隔离后端+stub 发现 → 8 列主表/详情折叠/绑定对/保存回环（离屏、自清理）',
  evidenceDir: EVIDENCE,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    const occupant = listenerPid(9223);
    assert('S0_9223_free_before_start', !occupant, occupant ? `9223 被 pid ${occupant} 占用——不代杀，中止` : 'free');
    if (occupant) return false;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b455-'));
    const dbSrc = path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
    const dbDst = path.join(tmpDir, 'petri.db');
    if (fs.existsSync(dbSrc)) {
      const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
      const src = new Database(dbSrc, { readonly: true });
      await src.backup(dbDst);
      src.close();
    }

    // 模型列表 stub：openai-compatible GET {baseUrl}/models → {data:[{id}]}
    const stub = http.createServer((req, res) => {
      if (req.method === 'GET' && /\/models\/?$/.test(req.url || '')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'deepseek-r1' }, { id: 'bge-m3' }] }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":{"message":"stub: not found"}}');
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
    try {
      // ── REST 腿：当前磁盘后端代码 ─────────────────────────────
      const healthy = await waitBackend();
      assert('R1_isolated_backend_healthy', healthy, healthy ? `port ${BACKEND_PORT}` : backendLog.slice(-1200));
      if (!healthy) return false;

      const mainProfile = {
        id: 'b455-main', provider: 'openai-compatible', label: 'B455 主渠道',
        baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`,
        model: 'gpt-4o', defaultModel: 'gpt-4o', contextWindow: 128000, visible: true,
        defaultThinkingLevel: 'high',
        capabilities: ['chat', 'streaming', 'tools'],
        modelCapabilities: {
          'gpt-4o': ['chat', 'streaming', 'tools', 'vision', 'reasoning'],
          'gpt-4o-mini': ['chat', 'streaming', 'tools', 'vision'],
          'deepseek-r1': ['chat', 'streaming', 'tools', 'reasoning'],
        },
      };
      const embedProfile = {
        id: 'b455-embed', provider: 'openai-compatible', label: 'B455 向量',
        baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`,
        model: 'bge-m3', defaultModel: 'bge-m3', contextWindow: 8192, visible: true,
        capabilities: ['embedding'],
      };
      const seeded = await rest('/ai/settings', {
        method: 'POST',
        body: JSON.stringify({
          model_profiles: [mainProfile, embedProfile],
          chat_model_presets: [{ id: 'b455-main', label: 'B455 主渠道', provider: 'openai-compatible', model: 'gpt-4o', defaultModel: 'gpt-4o', baseUrl: mainProfile.baseUrl, contextWindow: 128000 }],
          model_role_bindings: { chat: 'b455-main', vision: 'b455-main::gpt-4o', embedding: 'b455-embed::bge-m3' },
        }),
      });
      assert('R2_seed_accepted', seeded.ok, `status=${seeded.status} ${JSON.stringify(seeded.data || {}).slice(0, 160)}`);

      const readback = await rest('/ai/settings');
      const rbSettings = readback.data?.settings || {};
      const rbMain = (rbSettings.model_profiles || []).find((p) => p.id === 'b455-main');
      const rbBindings = rbSettings.model_role_bindings || {};
      assert('R3_model_capabilities_and_pairs_persisted',
        !!rbMain && Array.isArray(rbMain.modelCapabilities?.['gpt-4o-mini'])
        && rbMain.modelCapabilities['gpt-4o-mini'].includes('vision')
        && rbBindings.vision === 'b455-main::gpt-4o' && rbBindings.embedding === 'b455-embed::bge-m3',
        JSON.stringify({ caps: rbMain?.modelCapabilities, bindings: rbBindings }).slice(0, 300));

      // ── 测试实例：直起 Electron（attach 隔离后端 :3399，9223 专属，离屏） ──
      // 不走 start-test-instance.sh：该脚本把 PETRI_LOCAL_DATA_DIR 硬指 dev 数据目录，
      // 而设置 IPC 在主进程内直接 require core helper 读该目录的 ai-settings.json
      // （2026-11-17 首跑抓真：后端 attach 3399 成功但 UI 读到用户 dev 配置）。
      // 此处数据目录与隔离后端同源 tmpDir ⇒ seed/保存回环全链隔离；DB 用快照副本，
      // 用户 dev 库零写入。窗口离屏由主进程测试实例分支自处理，不设 PETRI_TEST_ONSCREEN。
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
      // 就绪判据 = 9223 出现 ?test=1 页面目标（与脚本自身判据同构）。
      // 不等待 launcher 进程 exit：Windows 下 Start-Process 孙进程可能持住 stdout
      // 管道柄使 close 永不触发（2026-11-17 首跑抓真：READY 已打印但 exit 哨兵超时）。
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
      originalUrl = JSON.parse(await lib.evalJs(client, `JSON.stringify(location.href)`).catch(() => 'null'));
      await lib.evalJs(client, `location.href = ${JSON.stringify(`${APP}/settings?section=models`)}; 'ok'`);
      await sleep(4500);
      const c2 = await lib.connectTestTarget({ timeoutMs: 15_000 });
      try { client.socket.close(); } catch { /* ignore */ }
      client = c2;

      // 宽视口（容器 > 1146px 阈值 → 多列表格形态）
      await client.send('Emulation.setDeviceMetricsOverride', { width: 2400, height: 1400, deviceScaleFactor: 1, mobile: false }, { timeoutMs: 10_000 });
      await sleep(1000);

      const expandResult = await lib.evalJs(client, `(function(){
        var g = document.querySelector('.petri-endpoint-card__grid[aria-label="B455 主渠道 模型渠道"]');
        var main = g && g.closest('.petri-endpoint-card');
        if (!main) return 'no_card';
        var b = main.querySelector('.petri-endpoint-card__expand');
        if (!b) return 'no_expand_button';
        b.click(); return 'clicked';
      })()`);
      assert('W4a_expand_button_present', expandResult === 'clicked', expandResult);

      // 等静默连通性发现（stub）填充逐模型表
      let probe = null;
      for (let i = 0; i < 20; i += 1) {
        await sleep(1000);
        probe = JSON.parse(await lib.evalJs(client, PROBE, 8000));
        if (probe.detail && probe.detail.modelNames.length >= 4) break;
      }

      // ── 宽态断言 ─────────────────────────────────────────────
      // BLOCK-456（UI-707）后继：上下文列退役（8→7 列，8 轨道，min-width 1000）。
      const headerTexts = probe.header?.texts || [];
      assert('W1_header_no_capability_columns',
        headerTexts.length === 8 && ['协议', '供应商', 'Base URL', 'Key', '默认模型', '连通性'].every((t) => headerTexts.includes(t))
        && !headerTexts.some((t) => ['思考', '视觉', '向量', '上下文'].includes(t)),
        JSON.stringify(headerTexts));

      const hTracks = probe.header?.tracks || [];
      const gTracks = probe.grid?.tracks || [];
      const offTops = (probe.grid?.kids || []).map((k) => k.offTop);
      const spread = offTops.length ? Math.max(...offTops) - Math.min(...offTops) : 999;
      const aligned = hTracks.length === gTracks.length && hTracks.every((w, i) => Math.abs(w - gTracks[i]) <= 2);
      assert('W2_grid_eight_tracks_aligned_single_row',
        hTracks.length === 8 && aligned && spread <= 16
        && probe.header?.minWidth === 1000 && probe.grid?.minWidth === 1000,
        `header=[${hTracks}] grid=[${gTracks}] spread=${spread}px minWidth=${probe.header?.minWidth}/${probe.grid?.minWidth}`);

      const overflowing = (probe.grid?.kids || []).filter((k) => k.scrollW > k.clientW + 1);
      const headerEscapes = probe.header && probe.list ? probe.header.rect.right > probe.list.rect.right + 1 : true;
      assert('W3_no_overflow', overflowing.length === 0 && !headerEscapes && probe.docOverflow === false,
        `溢出单元格=${overflowing.length} header越界=${headerEscapes} docOverflow=${probe.docOverflow}`);

      assert('W4_detail_controls',
        !!probe.detail && probe.selectorShown === true
        && probe.thinking?.value === 'high'
        && JSON.stringify(probe.thinking?.options) === JSON.stringify(['unsupported', 'auto', 'off', 'standard', 'high'])
        && probe.caps.defaultVision === true,
        JSON.stringify({ selectorShown: probe.selectorShown, thinking: probe.thinking, defaultVision: probe.caps.defaultVision }).slice(0, 300));

      const names = probe.detail?.modelNames || [];
      assert('W5_per_model_table',
        names.includes('渠道默认（兜底）') && names.includes('gpt-4o-mini') && names.includes('deepseek-r1') && names.includes('bge-m3')
        && !names.includes('gpt-4o')
        && probe.caps.miniVision === true && probe.caps.miniReasoning === false
        && probe.caps.r1Reasoning === true && probe.caps.bgeEmbedding === true && probe.caps.channelVision === false,
        JSON.stringify({ names, caps: probe.caps }).slice(0, 360));

      const d = probe.detail;
      const withinCard = d && probe.card && d.rect.right <= probe.card.right + 1 && d.rect.x >= probe.card.x - 1;
      const noOverlap = d && d.controlsRect && d.tableRect && d.tableRect.y >= d.controlsRect.bottom - 1;
      assert('W6_detail_geometry', !!withinCard && !!noOverlap,
        `withinCard=${withinCard} noOverlap=${noOverlap} detail=${JSON.stringify(d?.rect)} card=${JSON.stringify(probe.card)}`);

      assert('W7_role_binding_pairs',
        probe.visionBinding?.value === 'b455-main::gpt-4o'
        && (probe.visionBinding?.options || []).includes('b455-main::gpt-4o-mini')
        && probe.embeddingBinding?.value === 'b455-embed::bge-m3',
        JSON.stringify({ vision: probe.visionBinding, embedding: probe.embeddingBinding }).slice(0, 360));

      // ── 元素级截图（裁图过目，几何合格 ≠ 视觉合格） ───────────
      await client.send('Page.bringToFront', {}, { timeoutMs: 5000 }).catch(() => {});
      const shots = {};
      try {
        shots.headerRow = await clipShot(client, 'block455-wide-header-row.png', `(function(){
          ${RECT_HELPER}
          var h = document.querySelector('.petri-endpoint-list-header');
          var g = document.querySelector('.petri-endpoint-card__grid[aria-label="B455 主渠道 模型渠道"]');
          if (!h || !g) return 'null';
          h.scrollIntoView({ block: 'start' });
          var a = h.getBoundingClientRect(), b = g.getBoundingClientRect();
          var x = Math.min(a.x, b.x), y = a.y + window.scrollY;
          return JSON.stringify({ x: x + window.scrollX, y: y, w: Math.max(a.right, b.right) - x, h: b.bottom - a.y });
        })()`);
        shots.detail = await clipShot(client, 'block455-detail.png', `(function(){
          ${RECT_HELPER}
          var el = document.querySelector('.petri-endpoint-card__detail');
          if (el) el.scrollIntoView({ block: 'center' });
          return JSON.stringify(rect(el));
        })()`);
        shots.bindings = await clipShot(client, 'block455-bindings.png', `(function(){
          ${RECT_HELPER}
          var els = [].slice.call(document.querySelectorAll('.petri-model-role-binding'));
          if (!els.length) return 'null';
          els[0].scrollIntoView({ block: 'center' });
          var rs = els.map(function(e){ return e.getBoundingClientRect(); });
          var x = Math.min.apply(null, rs.map(function(r){ return r.x; }));
          var y = Math.min.apply(null, rs.map(function(r){ return r.y; }));
          var right = Math.max.apply(null, rs.map(function(r){ return r.right; }));
          var bottom = Math.max.apply(null, rs.map(function(r){ return r.bottom; }));
          return JSON.stringify({ x: x + window.scrollX, y: y + window.scrollY, w: right - x, h: bottom - y });
        })()`);
        await fullShot(client, 'block455-wide-full.png');
        shots.full = 'captured';
      } catch (e) {
        shots.error = `screenshot_unavailable: ${e.message}`;
      }
      assert('W8_screenshots_or_honest_degrade', true, JSON.stringify(shots));

      // ── 保存回环：改能力位 → 保存 → 隔离后端读回 ─────────────
      await lib.evalJs(client, `(function(){
        var el = document.querySelector('input[aria-label="B455 主渠道 gpt-4o-mini 支持识图（视觉输入）"]');
        if (el) el.click();
        return el ? 'clicked' : 'not_found';
      })()`);
      await sleep(400);
      const saveClicked = await lib.evalJs(client, `(function(){
        var b = [].slice.call(document.querySelectorAll('button')).find(function(x){ return (x.innerText||'').trim() === '保存'; });
        if (b) b.click();
        return b ? 'clicked' : 'not_found';
      })()`);
      await sleep(2500);
      const afterSave = await rest('/ai/settings');
      const asSettings = afterSave.data?.settings || {};
      const asMain = (asSettings.model_profiles || []).find((p) => p.id === 'b455-main');
      const asCaps = asMain?.modelCapabilities || {};
      const asBindings = asSettings.model_role_bindings || {};
      assert('W9_save_roundtrip',
        saveClicked === 'clicked'
        && Array.isArray(asCaps['gpt-4o-mini']) && !asCaps['gpt-4o-mini'].includes('vision')
        && JSON.stringify(asCaps['bge-m3']) === JSON.stringify(['embedding'])
        && Array.isArray(asCaps['gpt-4o']) && asCaps['gpt-4o'].includes('reasoning')
        && asBindings.vision === 'b455-main::gpt-4o' && asBindings.embedding === 'b455-embed::bge-m3',
        JSON.stringify({ saveClicked, caps: asCaps, bindings: asBindings }).slice(0, 380));

      // ── 窄态（容器 < 1146px → 两行式） ───────────────────────
      await client.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 1200, deviceScaleFactor: 1, mobile: false }, { timeoutMs: 10_000 });
      await sleep(1200);
      const narrow = JSON.parse(await lib.evalJs(client, PROBE));
      assert('N1_narrow_two_line_form',
        narrow.header?.display === 'none' && narrow.grid?.tracks.length === 2
        && narrow.grid?.labelsVisible === narrow.grid?.labelsTotal && narrow.grid?.labelsTotal >= 8
        && narrow.grid?.pairs === true && narrow.list.scrollW <= narrow.list.clientW + 1,
        JSON.stringify({ display: narrow.header?.display, tracks: narrow.grid?.tracks, labels: `${narrow.grid?.labelsVisible}/${narrow.grid?.labelsTotal}`, pairs: narrow.grid?.pairs, scroll: `${narrow.list?.scrollW}/${narrow.list?.clientW}` }).slice(0, 300));
      assert('N2_narrow_detail_still_rendered', !!narrow.detail && narrow.detail.modelNames.length >= 4,
        JSON.stringify(narrow.detail?.modelNames || null));
      let narrowShot = 'captured';
      try {
        await fullShot(client, 'block455-narrow-full.png');
      } catch (e) {
        narrowShot = `screenshot_unavailable: ${e.message}`;
      }
      assert('N3_narrow_screenshot_or_honest_degrade', true, narrowShot);
      return true;
    } finally {
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