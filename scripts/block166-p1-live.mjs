/**
 * scripts/block166-p1-live.mjs — BLOCK-166 P1 全链实机探针。
 *
 * 链路：DB 播种（项目/会话/::visualize 消息/D3 交互 fragment）→ CDP 打开项目页 →
 * 点会话 → P0 面复核（petri-genui:// iframe）→ CSP connect-src 违规事件实测
 * （fetch/WS 样本被拦）→ Network.offline + guest 重载 = 断网渲染成功（vendor 离线
 * 映射 + d3 图表在场）→ 主题明暗跟随（data-theme 切换 → guest dataset/colorScheme/
 * 背景色变化 + 截图）→ widgetState 内存回读（setWidgetState → 重载 → 初始状态恢复）
 * → openExternal 非 http(s) 拒绝分支 → data-tooltip → 证据落 acceptance/block-166/。
 *
 * 诚实边界（同 P0）：模型手写 fragment 环节以预置文件替代（dev 数据面无渠道 key）；
 * 其余全链（解析器/prepare/协议宿主/壳拼装/桥 RPC/vendor sha256/主题/离线）均为
 * 真实路径。真模型补跑=用户在应用内配好 key 后自然对话一次。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const DB_PATH = path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-166');
const CONV_TITLE = 'BLOCK-166 P1 交互探针';
const libPath = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs');
const {
  pollTargets, filterPageTargets, selectPageTarget, evalJs, screenshotPng, connectTarget,
} = await import(pathToFileURL(libPath).href).then((m) => m.default ?? m);

function openDb() {
  const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
  return new Database(DB_PATH);
}

const FRAGMENT_TEMPLATE = `
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>BLOCK-166 P1 交互探针</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
</head>
<body>
<div id="gen-ui-p1-demo" style="padding:20px">
  <h3 style="margin:0 0 4px;color:var(--foreground);font-size:15px">Gen UI P1 交互探针 · D3 图表 + 滑块</h3>
  <p style="margin:0 0 12px;color:var(--muted-foreground);font-size:12px">vendor 离线映射 · 主题变量 · widgetState · tooltip</p>
  <div id="chart"></div>
  <div style="margin-top:12px">
    <label for="threshold" style="color:var(--muted-foreground);font-size:12px">阈值滑块：<span id="threshold-value">50</span></label>
    <input id="threshold" class="form-range" type="range" min="0" max="100" value="50"
           data-tooltip="拖动调整高亮阈值，状态自动保存到宿主" style="width:240px">
  </div>
  <p style="margin:12px 0 0;font-size:12px">
    <a id="doc-link" href="https://example.com/petri-docs">外链示例（宿主裁决打开）</a>
    <span data-tooltip="内联提示目标"> · tooltip 演示文本</span>
  </p>
</div>
<script>
(function () {
  'use strict';
  var state = window.petri && window.petri.widgetState ? window.petri.widgetState : null;
  var thresholdValue = (state && state.modelContent && typeof state.modelContent.threshold === 'number')
    ? state.modelContent.threshold : 50;

  var data = [
    ['解析器', 96], ['prepare IPC', 88], ['协议宿主', 80],
    ['vendor 离线', 72], ['主题注入', 64], ['guest 桥', 58],
  ];
  var threshold = thresholdValue;

  function render() {
    var root = d3.select('#chart');
    root.selectAll('*').remove();
    var bars = root.selectAll('div.bar').data(data).enter().append('div')
      .style('display', 'flex').style('align-items', 'center').style('gap', '10px').style('margin-bottom', '6px');
    bars.append('span').text(function (d) { return d[0]; })
      .style('width', '90px').style('color', 'var(--muted-foreground)').style('font-size', '12px');
    bars.append('div').style('flex', '1').style('height', '16px').style('border-radius', '8px')
      .style('background', 'var(--muted)')
      .append('div').style('height', '16px').style('border-radius', '8px')
      .style('background', function (d) { return d[1] >= threshold ? 'var(--primary)' : 'var(--border)'; })
      .style('width', function (d) { return d[1] + '%'; });
    var badge = root.append('div').attr('class', 'viz-badge')
      .text('P1 pipeline OK · threshold=' + threshold);
    d3.select('#threshold-value').text(String(threshold));
  }

  var slider = document.getElementById('threshold');
  slider.value = String(threshold);
  slider.addEventListener('input', function () {
    threshold = Number(slider.value);
    render();
    if (window.petri && typeof window.petri.setWidgetState === 'function') {
      window.petri.setWidgetState({ modelContent: { threshold: threshold } }).catch(function () {});
    }
  });

  render();
})();
</script>
</body>
</html>
`;

function seed() {
  const ws = path.join(ROOT, 'tmp', 'block166-ws');
  fs.mkdirSync(ws, { recursive: true });
  const db = openDb();
  const now = new Date().toISOString();
  const projectId = 'p_blk166p1_' + Date.now().toString(36);
  db.prepare(
    'INSERT INTO projects (id, name, user_id, modality, created_at, updated_at, workspace_path, workspace_kind, status) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(projectId, 'block166-p1-live', 'local-user', 'general', now, now, ws, 'local', 'active');
  const convId = 'c_blk166p1_' + Date.now().toString(36);
  db.prepare(
    'INSERT INTO copilot_conversations (id, user_id, title, status, project_id, message_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(convId, 'local-user', CONV_TITLE, 'active', projectId, 2, now, now);
  db.prepare(
    'INSERT INTO copilot_messages (conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?)'
  ).run(convId, 'user', '请用沙箱可视化展示 P1 交互检查结果', null, now);
  const scopeRoot = path.join(ws, '.petri', 'gen-ui', convId);
  fs.mkdirSync(scopeRoot, { recursive: true });
  const fragPath = path.join(scopeRoot, 'p1-interactive-demo.html');
  fs.writeFileSync(fragPath, FRAGMENT_TEMPLATE, 'utf8');
  const fragPosix = fragPath.replace(/\\/g, '/');
  db.prepare(
    'INSERT INTO copilot_messages (conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?)'
  ).run(
    convId,
    'assistant',
    `P1 交互检查完成，可交互图表如下（拖动滑块保存状态）：\n\n::visualize{"path":"${fragPosix}","title":"P1 交互检查"}\n\nvendor 离线映射与主题变量由宿主注入。`,
    null,
    now
  );
  db.close();
  return { projectId, convId, fragPath };
}

function cleanup(projectId) {
  try {
    const db = openDb();
    const rows = db.prepare('SELECT id FROM copilot_conversations WHERE project_id = ?').all(projectId);
    for (const row of rows) db.prepare('DELETE FROM copilot_messages WHERE conversation_id = ?').run(row.id);
    db.prepare('DELETE FROM copilot_conversations WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    db.close();
  } catch { /* 尽力清场 */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** guest 沙箱 frame 通道（实测验证流程，diag3 同款）：Electron 沙箱 iframe 是进程
 * 隔离的 OOPIF，页面会话 Runtime 看不到它；必须先 attach 宿主页面（flatten），
 * iframe 才会作为 iframe target 出现在 browser 级 Target.getTargets —— 再直接
 * attachToTarget(flatten) 拿 guest 会话，命令带 sessionId 在同一连接路由。
 * guest reload 会换 renderer → 每次评估前重找 target。 */
async function createGuestFrameEval(browserWsUrl, pageTargetId) {
  const ws = new WebSocket(browserWsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('guest_ws_open_failed')), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const payload = JSON.parse(String(event.data || '{}'));
    if (payload.id && pending.has(payload.id)) {
      const p = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) p.reject(new Error(`cdp_error:${JSON.stringify(payload.error).slice(0, 200)}`));
      else p.resolve(payload.result);
    }
  });
  function send(method, params = {}, sessionId, timeoutMs = 15000) {
    const id = nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    ws.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`guest_cdp_timeout:${method}`)); }
      }, timeoutMs);
    });
  }
  const pageSession = await send('Target.attachToTarget', { targetId: pageTargetId, flatten: true });
  const pageSessionId = pageSession.sessionId;
  await send('Runtime.enable', {}, pageSessionId);
  async function findGuestTargetId(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const all = await send('Target.getTargets');
      const guest = (all.targetInfos || []).find((t) => String(t.url).startsWith('petri-genui://'));
      if (guest) return guest.targetId;
      await sleep(300);
    }
    let dump = '';
    try {
      const all2 = await send('Target.getTargets');
      dump = (all2.targetInfos || []).map((t) => `${t.type}:${String(t.url).slice(0, 50)}`).join(' | ');
    } catch { /* ignore */ }
    throw new Error(`guest_iframe_target_not_found [targets=${dump}]`);
  }
  async function evalInFrame(expr, timeoutMs = 15000) {
    const targetId = await findGuestTargetId();
    const att = await send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = att.sessionId;
    await send('Runtime.enable', {}, sessionId);
    if (guestOffline) {
      // 离线演示按 guest 会话施加（OOPIF 会话级网络模拟）
      await send('Network.enable', {}, sessionId).catch(() => {});
      await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId).catch(() => {});
    }
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId, timeoutMs),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`frame_eval_timeout_${timeoutMs}ms`)), timeoutMs)),
    ]);
    if (r.exceptionDetails) {
      throw new Error('frame_eval_exception: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300));
    }
    return r.result?.value;
  }
  let guestOffline = false;
  /** 导航/点选/主题开关等宿主页操作统一走本连接的页面会话（diag3 实证序）。 */
  async function pageEval(expr, timeoutMs = 15000) {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pageSessionId, timeoutMs),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`page_eval_timeout_${timeoutMs}ms`)), timeoutMs)),
    ]);
    if (r.exceptionDetails) {
      throw new Error('page_eval_exception: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300));
    }
    return r.result?.value;
  }
  async function setGuestOffline(flag) { guestOffline = flag; }
  return { evalInFrame, pageEval, setGuestOffline, ws };
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const { projectId } = seed();
  let assertions = [];
  let ok = true;
  const client2 = { held: null };
  try {
    const targets = await pollTargets({ timeoutMs: 20_000 });
    const candidates = filterPageTargets(targets, /localhost:3000/);
    const target = await selectPageTarget(candidates, {
      probe: async (c) => !!(await evalJs(c, 'document.querySelector("#root")')),
    });
    const client = await connectTarget(target);
    client2.held = client;
    // guest OOPIF 通道先行：attach 宿主页面必须在 iframe 创建之前（diag3 实证序），
    // 之后创建的 iframe 才会作为 target 被 getTargets 看到；
    // 导航/点选/主题开关统一走本连接的页面会话（pageEval，与 diag3 完全同构）。
    const version = await fetch('http://127.0.0.1:9222/json/version').then((r) => r.json());
    const frame = await createGuestFrameEval(version.webSocketDebuggerUrl, target.id);
    await frame.pageEval(`location.href = 'http://localhost:3000/project/${projectId}'`);
    await sleep(3500);
    const clickOnce = () => frame.pageEval(`(() => {
      const els = Array.from(document.querySelectorAll('button, [role="button"], a, li, div'));
      const hit = els.find(e => e.textContent && e.textContent.includes('${CONV_TITLE}') && e.offsetParent !== null);
      if (!hit) return false;
      let target = hit;
      while (target && target !== document.body) {
        if (target.matches('button,[role="button"],a') || (target.onclick)) break;
        target = target.parentElement;
      }
      (target || hit).click();
      return true;
    })()`);
    // 栈冷启动时会话列表晚就绪：点选 + 卡片出现轮询重试
    let clicked = false;
    let iframeSrc = '';
    for (let attempt = 0; attempt < 5 && !iframeSrc.startsWith('petri-genui://gen-'); attempt += 1) {
      clicked = (await clickOnce()) || clicked;
      await sleep(2500);
      iframeSrc = await frame.pageEval(`(() => {
        const f = document.querySelector('[data-testid="gen-ui-card"] iframe');
        return f ? f.src : '';
      })()`);
    }

    // ── P0 面复核（在线）：卡片 + petri-genui:// iframe ──
    const bridgeOnline = await frame.evalInFrame(`typeof window.petri === 'object' && !!window.petri.setWidgetState`);

    // ── CSP connect-src 实测（在线下做，区分「CSP 拦」与「offline 断」）──
    const cspProbe = await frame.evalInFrame(`(function () {
      return new Promise(function (resolve) {
        var violations = [];
        var onViolation = function (e) { violations.push(e.violatedDirective + ':' + (e.blockedURL || '').slice(0, 40)); };
        document.addEventListener('securitypolicyviolation', onViolation);
        fetch('http://127.0.0.1:9222/json').then(function () {}, function () {});
        try { new WebSocket('ws://127.0.0.1:9222'); } catch (e) { violations.push('ws-exception'); }
        setTimeout(function () {
          document.removeEventListener('securitypolicyviolation', onViolation);
          resolve({ violations: violations });
        }, 1200);
      });
    })()`);
    const connectBlocked = (cspProbe.violations || []).some((v) => v.startsWith('connect-src'));

    // ── 断网渲染：guest 会话 offline + 重载 → vendor 离线映射全链 ──
    await frame.setGuestOffline(true);
    await frame.evalInFrame('location.reload()');
    await sleep(2500);
    const offlineRender = await frame.evalInFrame(`(function () {
      var svgBars = document.querySelectorAll('#chart > div').length;
      return {
        d3: typeof window.d3 === 'object' && typeof window.d3.select === 'function',
        bars: svgBars,
        bridge: typeof window.petri === 'object',
        badge: (document.querySelector('.viz-badge') || {}).textContent || '',
        fatalBanner: !!document.getElementById('petri-gen-ui-fatal'),
      };
    })()`);
    await frame.setGuestOffline(false);

    // ── 主题明暗跟随 ──
    const themeBefore = await frame.evalInFrame(`(function () {
      return {
        dataset: document.documentElement.dataset.theme || '',
        bg: getComputedStyle(document.documentElement).backgroundColor,
      };
    })()`);
    const pageThemeBefore = await frame.pageEval(`document.documentElement.dataset.theme || ''`);
    const flipped = pageThemeBefore === 'dark' ? 'light' : 'dark';
    await frame.pageEval(`document.documentElement.setAttribute('data-theme', '${flipped}')`);
    await sleep(600);
    const themeAfter = await frame.evalInFrame(`(function () {
      return {
        dataset: document.documentElement.dataset.theme || '',
        colorScheme: document.documentElement.style.colorScheme || '',
        bg: getComputedStyle(document.documentElement).backgroundColor,
      };
    })()`);
    await screenshotPng(client, EVIDENCE_DIR, 'p1-live-dark-theme.png');
    await frame.pageEval(`document.documentElement.setAttribute('data-theme', '${pageThemeBefore || 'light'}')`);
    await sleep(400);

    // ── widgetState 内存回读：setWidgetState → 重载 → 初始状态恢复 ──
    const saved = await frame.evalInFrame(
      `window.petri.setWidgetState({ modelContent: { threshold: 73 } }).then(function () { return 'saved'; }, function (e) { return 'save-failed:' + e.message; })`
    );
    await frame.evalInFrame('location.reload()');
    await sleep(2500);
    const restored = await frame.evalInFrame(`(function () {
      var s = window.petri && window.petri.widgetState;
      return { present: !!s, threshold: s && s.modelContent ? s.modelContent.threshold : null };
    })()`);

    // ── openExternal 非 http(s) 拒绝分支（live）──
    const openReject = await frame.evalInFrame(
      `window.petri.openExternal({ href: 'javascript:alert(1)' }).then(function () { return 'allowed'; }, function () { return 'rejected'; })`
    );

    // ── data-tooltip ──
    const tooltip = await frame.evalInFrame(`(function () {
      var target = document.querySelector('[data-tooltip]');
      if (!target) return { present: false };
      target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      return new Promise(function (resolve) {
        setTimeout(function () {
          var tip = document.querySelector('[role="tooltip"]');
          resolve({ present: !!tip, text: tip ? tip.textContent.slice(0, 30) : '' });
        }, 300);
      });
    })()`);

    // offline 复原（探针共用 dev 窗口，必须归还干净状态）
    await client.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    }, { timeoutMs: 5000 });

    await screenshotPng(client, EVIDENCE_DIR, 'p1-live-card.png');

    assertions = [
      { name: 'P0 面复核：卡片+petri-genui:// iframe', pass: String(iframeSrc).startsWith('petri-genui://gen-'), detail: String(iframeSrc).slice(0, 60) },
      { name: 'guest 桥安装（在线）', pass: bridgeOnline === true },
      { name: 'CSP connect-src 拦截 fetch/WS（securitypolicyviolation 实证）', pass: connectBlocked, detail: JSON.stringify(cspProbe.violations || []).slice(0, 120) },
      { name: '断网渲染成功（offline 重载：d3+图表+桥在场，无失败横幅）', pass: offlineRender.d3 === true && offlineRender.bars >= 6 && offlineRender.bridge === true && offlineRender.fatalBanner === false, detail: JSON.stringify(offlineRender).slice(0, 140) },
      { name: '主题跟随：data-theme 切换 → guest theme/colorScheme/背景色变化', pass: themeAfter.dataset === flipped && themeAfter.colorScheme === flipped && themeAfter.bg !== themeBefore.bg, detail: `before=${JSON.stringify(themeBefore)} after=${JSON.stringify(themeAfter)}` },
      { name: 'widgetState 内存回读（setWidgetState → 重载恢复）', pass: saved === 'saved' && restored.present === true && restored.threshold === 73, detail: `saved=${saved} restored=${JSON.stringify(restored)}` },
      { name: 'openExternal 非 http(s) 拒绝（live）', pass: openReject === 'rejected' },
      { name: 'data-tooltip 建立角色 tooltip', pass: tooltip.present === true, detail: JSON.stringify(tooltip).slice(0, 80) },
    ];
    ok = assertions.every((a) => a.pass);
    void clicked;
  } catch (error) {
    assertions.push({ name: '探针执行异常', pass: false, detail: String(error && error.message || error).slice(0, 200) });
    ok = false;
  } finally {
    // 兜底复原 offline
    try {
      if (client2.held) {
        await client2.held.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, { timeoutMs: 3000 });
      }
    } catch { /* 已断开则忽略 */ }
    cleanup(projectId);
  }
  const report = {
    at: new Date().toISOString(),
    allPass: ok,
    assertions,
    note: '模型手写 fragment 环节以预置文件替代（dev 数据面无渠道 key）；解析器/prepare/协议宿主/壳拼装/guest 桥/vendor sha256/主题/离线全链真实路径。',
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p1-live.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
