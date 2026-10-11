/**
 * scripts/block166-p2-live.mjs — BLOCK-166 P2 实机探针。
 *
 * 链路：DB 播种（D3+滑块交互 fragment）→ 打开会话 → guest setWidgetState（经
 * 主进程 REST 落 SQLite）→ **主页 reload 重开会话 → prepare 回读持久化状态**
 * （P2 核心验收：跨会话重开恢复）→ 放大预览（overlay 在场 + iframe 迁入 + 还原）
 * → follow-up（stub confirm → sendFollowUpMessage 真发 → 消息列表出现）。
 * 诚实边界：模型手写 fragment 以预置文件替代（dev 数据面无渠道 key）。
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
const CONV_TITLE = 'BLOCK-166 P2 交互探针';
const libPath = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs');
const {
  pollTargets, filterPageTargets, evalJs, screenshotPng, connectTarget,
} = await import(pathToFileURL(libPath).href).then((m) => m.default ?? m);

function openDb() {
  const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
  return new Database(DB_PATH);
}

const FRAGMENT = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>BLOCK-166 P2 交互探针</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
</head>
<body>
<div id="gen-ui-p2-demo" style="padding:20px">
  <h3 style="margin:0 0 4px;color:var(--foreground);font-size:15px">Gen UI P2 交互探针 · D3 + 滑块</h3>
  <div id="chart"></div>
  <div style="margin-top:12px">
    <label for="threshold" style="color:var(--muted-foreground);font-size:12px">阈值：<span id="threshold-value">50</span></label>
    <input id="threshold" class="form-range" type="range" min="0" max="100" value="50"
           data-tooltip="拖动保存状态（SQLite 持久化）" style="width:100%">
  </div>
</div>
<script>
(function () {
  'use strict';
  var state = window.petri && window.petri.widgetState ? window.petri.widgetState : null;
  var threshold = (state && state.modelContent && typeof state.modelContent.threshold === 'number')
    ? state.modelContent.threshold : 50;
  var data = [['A', 96], ['B', 88], ['C', 80], ['D', 72], ['E', 64], ['F', 58]];
  function render() {
    var root = d3.select('#chart');
    root.selectAll('*').remove();
    var bars = root.selectAll('div.bar').data(data).enter().append('div')
      .style('display', 'flex').style('align-items', 'center').style('gap', '10px').style('margin-bottom', '6px');
    bars.append('span').text(function (d) { return d[0]; })
      .style('width', '60px').style('color', 'var(--muted-foreground)').style('font-size', '12px');
    bars.append('div').style('flex', '1').style('height', '14px').style('border-radius', '7px')
      .style('background', 'var(--muted)')
      .append('div').style('height', '14px').style('border-radius', '7px')
      .style('background', function (d) { return d[1] >= threshold ? 'var(--primary)' : 'var(--border)'; })
      .style('width', function (d) { return d[1] + '%'; });
    root.append('div').attr('class', 'viz-badge').text('P2 pipeline OK · threshold=' + threshold);
    document.getElementById('threshold-value').textContent = String(threshold);
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
</html>`;

function seed() {
  const ws = path.join(ROOT, 'tmp', 'block166-ws');
  fs.mkdirSync(ws, { recursive: true });
  const db = openDb();
  const now = new Date().toISOString();
  const projectId = 'p_blk166p2_' + Date.now().toString(36);
  db.prepare(
    'INSERT INTO projects (id, name, user_id, modality, created_at, updated_at, workspace_path, workspace_kind, status) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(projectId, 'block166-p2-live', 'local-user', 'general', now, now, ws, 'local', 'active');
  const convId = 'c_blk166p2_' + Date.now().toString(36);
  db.prepare(
    'INSERT INTO copilot_conversations (id, user_id, title, status, project_id, message_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(convId, 'local-user', CONV_TITLE, 'active', projectId, 2, now, now);
  db.prepare(
    'INSERT INTO copilot_messages (conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?)'
  ).run(convId, 'user', '请用沙箱可视化展示 P2 检查结果', null, now);
  const scopeRoot = path.join(ws, '.petri', 'gen-ui', convId);
  fs.mkdirSync(scopeRoot, { recursive: true });
  const fragPath = path.join(scopeRoot, 'p2-interactive-demo.html');
  fs.writeFileSync(fragPath, FRAGMENT, 'utf8');
  const fragPosix = fragPath.replace(/\\/g, '/');
  db.prepare(
    'INSERT INTO copilot_messages (conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?)'
  ).run(
    convId,
    'assistant',
    `P2 检查完成（拖动滑块保存状态，重开会话自动恢复）：\n\n::visualize{"path":"${fragPosix}","title":"P2 交互检查"}\n\n完。`,
    null,
    now
  );
  db.close();
  return { projectId, convId };
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

/** guest OOPIF 通道（P1 探针同款，diag3 实证序）：先 attach 宿主页面再找 iframe target。 */
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
    throw new Error('guest_iframe_target_not_found');
  }
  async function evalInFrame(expr, timeoutMs = 15000) {
    const targetId = await findGuestTargetId();
    const att = await send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = att.sessionId;
    await send('Runtime.enable', {}, sessionId);
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId, timeoutMs),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`frame_eval_timeout_${timeoutMs}ms`)), timeoutMs)),
    ]);
    if (r.exceptionDetails) {
      throw new Error('frame_eval_exception: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300));
    }
    return r.result?.value;
  }
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
  /** 在 guest 页派发真实点击（Input 域）——产生 navigator.userActivation 原生手势。 */
  async function clickGuest(x = 8, y = 8) {
    const targetId = await findGuestTargetId();
    const att = await send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = att.sessionId;
    const base = { x, y, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' }, sessionId);
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' }, sessionId);
  }
  return { evalInFrame, pageEval, clickGuest, ws };
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const { projectId } = seed();
  let assertions = [];
  let ok = true;
  const held = { ws: null };
  try {
    const targets = await pollTargets({ timeoutMs: 20_000 });
    const page = filterPageTargets(targets, /localhost:3000/)[0];
    if (!page) throw new Error('localhost page target not found');
    const libClient = await connectTarget(page);
    const probe = await evalJs(libClient, 'document.querySelector("#root") ? "main-window" : "other"');
    if (probe !== 'main-window') throw new Error('selected target is not the main window');
    const version = await fetch('http://127.0.0.1:9222/json/version').then((r) => r.json());
    const frame = await createGuestFrameEval(version.webSocketDebuggerUrl, page.id);
    held.ws = frame.ws;

    await frame.pageEval(`location.href = 'http://localhost:3000/project/${projectId}'`);
    await sleep(3500);
    let clicked = false;
    let iframeSrc = '';
    for (let attempt = 0; attempt < 5 && !iframeSrc.startsWith('petri-genui://gen-'); attempt += 1) {
      clicked = (await frame.pageEval(`(() => {
        const els = Array.from(document.querySelectorAll('button, [role="button"], a, li, div'));
        const hit = els.find(e => e.textContent && e.textContent.includes('${CONV_TITLE}') && e.offsetParent !== null);
        if (!hit) return false;
        let t = hit;
        while (t && t !== document.body) { if (t.matches('button,[role="button"],a') || (t.onclick)) break; t = t.parentElement; }
        (t || hit).click(); return true;
      })()`)) || clicked;
      await sleep(2500);
      iframeSrc = await frame.pageEval(`(() => {
        const f = document.querySelector('[data-testid="gen-ui-card"] iframe');
        return f ? f.src : '';
      })()`);
    }

    // ── 交互保存：guest 滑块置 88 + setWidgetState（主进程 REST → SQLite）──
    const saved = await frame.evalInFrame(`(function () {
      var slider = document.getElementById('threshold');
      slider.value = '88';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return window.petri.setWidgetState({ modelContent: { threshold: 88 } }).then(function () { return 'saved'; }, function (e) { return 'save-failed:' + e.message; });
    })()`);

    // ── 放大预览（重载前验证，覆盖层在场 + iframe 迁入）──
    await frame.pageEval(`(() => {
      const btn = Array.from(document.querySelectorAll('[data-testid="gen-ui-card"] button')).find(b => b.textContent === '放大');
      if (btn) btn.click();
    })()`);
    await sleep(600);
    const overlayOn = await frame.pageEval(`(() => {
      const overlay = document.querySelector('[data-testid="gen-ui-overlay"]');
      const frameInOverlay = overlay ? overlay.querySelector('iframe') : null;
      const cardFrame = document.querySelector('[data-testid="gen-ui-card"] [class*="frameWrap"] iframe');
      return { overlay: !!overlay, moved: !!frameInOverlay, src: frameInOverlay ? frameInOverlay.src : '', stillInCard: !!cardFrame };
    })()`);
    await screenshotPng(libClient, EVIDENCE_DIR, 'p2-live-overlay.png');
    await frame.pageEval(`(() => {
      const overlay = document.querySelector('[data-testid="gen-ui-overlay"]');
      const btn = overlay ? Array.from(overlay.querySelectorAll('button')).find(b => b.textContent === '还原') : null;
      if (btn) btn.click();
    })()`);
    await sleep(600);
    const overlayOff = await frame.pageEval(`(() => {
      return { overlay: !!document.querySelector('[data-testid="gen-ui-overlay"]'), backInCard: !!document.querySelector('[data-testid="gen-ui-card"] iframe') };
    })()`);

    // ── 重开会话状态恢复（P2 核心）：主页 reload → 重新点选 → 初始状态来自 SQLite ──
    await frame.pageEval(`location.reload()`);
    await sleep(4000);
    let clicked2 = false;
    let iframeSrc2 = '';
    for (let attempt = 0; attempt < 6 && !iframeSrc2.startsWith('petri-genui://gen-'); attempt += 1) {
      clicked2 = (await frame.pageEval(`(() => {
        const els = Array.from(document.querySelectorAll('button, [role="button"], a, li, div'));
        const hit = els.find(e => e.textContent && e.textContent.includes('${CONV_TITLE}') && e.offsetParent !== null);
        if (!hit) return false;
        let t = hit;
        while (t && t !== document.body) { if (t.matches('button,[role="button"],a') || (t.onclick)) break; t = t.parentElement; }
        (t || hit).click(); return true;
      })()`)) || clicked2;
      await sleep(2500);
      iframeSrc2 = await frame.pageEval(`(() => {
        const f = document.querySelector('[data-testid="gen-ui-card"] iframe');
        return f ? f.src : '';
      })()`);
    }
    const restored = await frame.evalInFrame(`(function () {
      var s = window.petri && window.petri.widgetState;
      return { present: !!s, threshold: s && s.modelContent ? s.modelContent.threshold : null };
    })()`);

    // ── follow-up live：stub confirm → CDP 真实点击产生 userActivation（原生手势
    // 校验是规格要求，evaluate 不构成手势）→ fire-and-forget 发送（发送会追加用户
    // 消息导致行重挂载/guest target 换代，不能在旧 guest 会话上 await 回执）→
    // 以主窗消息可见性为验收 ──
    await frame.pageEval(`window.confirm = function () { return true; };`);
    await frame.clickGuest(8, 8);
    const activation = await frame.evalInFrame(`!!(navigator.userActivation && navigator.userActivation.isActive)`);
    const kicked = await frame.evalInFrame(
      `window.__p2fuR = 'pending'; window.petri.sendFollowUpMessage({ prompt: 'P2 follow-up live 探针消息', title: 'P2 探针确认' }).then(function () { window.__p2fuR = 'sent'; }, function (e) { window.__p2fuR = 'rejected:' + e.message; }); 'kicked'`
    );
    await sleep(4000);
    const followUpVisible = await frame.pageEval(`(() => {
      const texts = Array.from(document.querySelectorAll('[data-testid="gen-ui-card"], .sc-msg, [class*="message"]')).map(e => e.textContent || '').join('\\n');
      return texts.includes('P2 follow-up live 探针消息');
    })()`);

    assertions = [
      { name: '会话点选 + 沙箱 iframe（首次打开）', pass: clicked === true || iframeSrc.startsWith('petri-genui://gen-'), detail: String(iframeSrc).slice(0, 60) },
      { name: 'widgetState 保存走宿主持久化（ack=saved）', pass: saved === 'saved', detail: saved },
      { name: '放大预览：overlay 在场 + iframe 节点迁入（src 保持）', pass: overlayOn.overlay === true && overlayOn.moved === true && String(overlayOn.src).startsWith('petri-genui://gen-'), detail: JSON.stringify(overlayOn).slice(0, 120) },
      { name: '还原：overlay 消失 + iframe 回卡片', pass: overlayOff.overlay === false && overlayOff.backInCard === true, detail: JSON.stringify(overlayOff) },
      { name: '重开会话状态恢复（reload→回读 SQLite threshold=88）', pass: restored.present === true && restored.threshold === 88, detail: JSON.stringify(restored) },
      { name: 'follow-up 真发进入当前会话（真实手势+stub confirm）', pass: activation === true && kicked === 'kicked' && followUpVisible === true, detail: `gesture=${activation} kick=${kicked} visible=${followUpVisible}` },
    ];
    ok = assertions.every((a) => a.pass);
    void clicked2;
    await screenshotPng(libClient, EVIDENCE_DIR, 'p2-live-restored.png');
  } catch (error) {
    assertions.push({ name: '探针执行异常', pass: false, detail: String(error && error.message || error).slice(0, 220) });
    ok = false;
  } finally {
    cleanup(projectId);
  }
  const report = {
    at: new Date().toISOString(),
    allPass: ok,
    assertions,
    note: '模型手写 fragment 环节以预置文件替代（dev 数据面无渠道 key）；持久化/恢复/放大/follow-up 全链真实路径（widgetState 经主进程 REST 落 SQLite）。',
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p2-live.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
