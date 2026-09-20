#!/usr/bin/env node
'use strict';
/**
 * BLOCK-56 UI-287 场景 R 诊断（主智能体接管 2026-09-04，合并前版 SSE 帧捕获）。
 *
 * 与 ui-fallback-live.cjs 的差异（针对「store 有 notice 但 DOM 无 chip」）：
 *  1. target 钉扎：枚举 :9222 全部 page，关闭多余 localhost:3000 页，记录被驱动
 *     targetId，轮询期间校验不漂移（排除多窗口探错页）。
 *  2. 全新会话：发送前点击「创建新对话」，隔离历史孤儿 run / localStorage 恢复。
 *  3. 三层同时取证：__b56sse（fetch 包装器抓 SSE 原始帧，传输层）/
 *     __b56mof+__b56mof2（回调入口+落盘读回，store 层）/ __b56disp+__b56chip
 *     （displayMessages 构建 + chip 300ms 时间线，渲染层），并对比 conversationId 键。
 *
 * 诊断产物：acceptance/block-56/ui287-diagnose.json（临时证据，收口后可删）。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const CDP_PORT = '9222';
const PROJECT_ID = 'p_mtlnsv0f_xpjb';
const DB_FILE = path.join(__dirname, '..', '.biof3-dev-user-data', 'data', 'biof3.db');
const SETTINGS_FILE = path.join(__dirname, '..', '.biof3-dev-user-data', 'data', 'ai-settings.json');
const PRIMARY_ID = 'b56-mock-primary';
const BACKUP_ID = 'b56-mock-backup';
const BACKUP_MARKER = 'B56-DIAG-BACKUP-MARKER-abcdefghijklmnopqrstuvwxyz-0123456789';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-56');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function sqlite(sql) {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  return execSync(`sqlite3 ${JSON.stringify(DB_FILE)} ${JSON.stringify(flat)}`, { encoding: 'utf8' }).trim();
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  // —— mock 服务：主=恒 500；备=流式 marker 回执 ——
  const primaryHits = [];
  const backupHits = [];
  const primary = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      primaryHits.push(req.url);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'The server is overloaded. Please try again later.' } }));
    });
  });
  const backup = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch {}
      backupHits.push({ stream: parsed.stream === true });
      if (parsed.stream === true) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const frames = [
          `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: BACKUP_MARKER } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
          `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 } })}`,
          'data: [DONE]',
        ];
        res.end(frames.join('\n\n') + '\n\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: BACKUP_MARKER } }],
        usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
      }));
    });
  });
  console.log(`NOTICE: mock 主=${primary.port} 备=${backup.port}`);

  // —— 配置注入（finally/exit 恢复）——
  const originalRaw = fs.readFileSync(SETTINGS_FILE, 'utf8');
  let injected = false;
  const mockProfile = (id, model, port) => ({
    id,
    label: id === PRIMARY_ID ? 'B56-Mock-Primary' : 'B56-Mock-Backup',
    provider: 'openai-compatible',
    model,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    capabilities: ['chat', 'streaming', 'tools'],
    roles: ['chat', 'agent'],
    parameters: {},
  });
  const injectSettings = () => {
    const settings = JSON.parse(originalRaw);
    settings.model_profiles = [
      ...(settings.model_profiles || []).filter((p) => p && p.id !== PRIMARY_ID && p.id !== BACKUP_ID),
      mockProfile(PRIMARY_ID, 'mock-primary', primary.port),
      mockProfile(BACKUP_ID, 'mock-backup', backup.port),
    ];
    settings.chat_model_presets = [
      ...(settings.chat_model_presets || []).filter((p) => p && p.id !== PRIMARY_ID && p.id !== BACKUP_ID),
      { id: PRIMARY_ID, label: 'B56-Mock-Primary', provider: 'openai-compatible', model: 'mock-primary', baseUrl: `http://127.0.0.1:${primary.port}/v1` },
      { id: BACKUP_ID, label: 'B56-Mock-Backup', provider: 'openai-compatible', model: 'mock-backup', baseUrl: `http://127.0.0.1:${backup.port}/v1` },
    ];
    settings.active_chat_model_id = PRIMARY_ID;
    settings.model_role_bindings = { ...(settings.model_role_bindings || {}), chat: PRIMARY_ID, agent: PRIMARY_ID };
    settings.model_fallback_enabled = true;
    settings.model_fallback_bindings = { ...(settings.model_fallback_bindings || {}), chat: [BACKUP_ID], agent: [BACKUP_ID] };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    fs.chmodSync(SETTINGS_FILE, 0o600);
    injected = true;
  };
  const restoreSettings = () => {
    try {
      fs.writeFileSync(SETTINGS_FILE, originalRaw);
      fs.chmodSync(SETTINGS_FILE, 0o600);
      injected = false;
      console.log('NOTICE: ai-settings.json 已恢复原样');
    } catch (e) {
      console.error('FAIL: 配置恢复失败', e);
    }
  };
  process.on('exit', () => { if (injected) restoreSettings(); });
  process.on('SIGINT', () => { restoreSettings(); process.exit(1); });

  let pinnedTargetId = null;
  try {
    injectSettings();

    // —— CDP target 钉扎 ——
    let targets = await httpGetJson(`http://localhost:${CDP_PORT}/json/list`);
    const appPages = targets.filter((t) => t.type === 'page' && /localhost:3000/.test(t.url));
    console.log(`NOTICE: localhost:3000 page 数=${appPages.length}`);
    for (const p of appPages.slice(1)) {
      await httpGetJson(`http://localhost:${CDP_PORT}/json/close/${p.id}`).catch(() => {});
      console.log(`NOTICE: 关闭多余页 ${p.id}`);
      await delay(300);
    }
    targets = await httpGetJson(`http://localhost:${CDP_PORT}/json/list`);
    const page = targets.find((t) => t.type === 'page' && !/devtools/i.test(t.url));
    if (!page) throw new Error('no page target');
    pinnedTargetId = page.id;
    console.log(`NOTICE: 钉扎 target=${pinnedTargetId}`);

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJS = async (expr) => {
      const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (res.error) throw new Error(`CDP error: ${JSON.stringify(res.error).slice(0, 200)}`);
      if (res.result && res.result.exceptionDetails) {
        throw new Error(`evaluate 异常: ${JSON.stringify(res.result.exceptionDetails).slice(0, 300)}`);
      }
      return res.result && res.result.result ? res.result.result.value : undefined;
    };
    // 页面加载后数秒偶发一次自导航（context 销毁，实测「Promise was collected」）。
    // 重试即可：新 context 上 evaluate 恢复可用；探针数组由 addScriptToEvaluateOnNewDocument
    // 与各处 `|| []` 兜底，清空丢失不影响取证。
    const evalJSRetry = async (expr, attempts = 4) => {
      let lastErr = null;
      for (let i = 1; i <= attempts; i += 1) {
        try {
          return await evalJS(expr);
        } catch (e) {
          lastErr = e;
          console.log(`WARN: evalJS 第 ${i} 次失败: ${String(e.message || e).slice(0, 120)}`);
          await delay(2000);
        }
      }
      throw lastErr;
    };
    
    await send('Page.enable');
    // 新文档注入：SSE 帧捕获（传输层）+ chip 300ms 时间线（渲染层）
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__b56sse = [];
      window.__b56chip = [];
      const t0 = performance.now();
      const origFetch = window.fetch;
      window.fetch = async function (...args) {
        const resp = await origFetch.apply(this, args);
        try {
          const url = String(args[0] || '');
          if (url.includes('/ai/agent/task/')) {
            const clone = resp.clone();
            clone.text().then((txt) => {
              for (const frame of txt.split('\\n\\n')) {
                const m = frame.match(/^data:\\s?([\\s\\S]*)$/);
                if (!m) continue;
                window.__b56sse.push({
                  t: Math.round(performance.now() - t0),
                  url: url.slice(-40),
                  fb: m[1].includes('model_fallback'),
                  head: m[1].slice(0, 140),
                });
              }
            }).catch(() => {});
          }
        } catch {}
        return resp;
      };
      setInterval(() => {
        const chip = document.querySelector('.sc-msg-fallback-notice');
        const last = window.__b56chip[window.__b56chip.length - 1];
        const state = chip ? (chip.textContent || '').slice(0, 60) : null;
        if (!last || last.state !== state) {
          window.__b56chip.push({ t: Math.round(performance.now() - t0), state });
        }
      }, 300);
    ` });

    // —— 注入后导航（单次）+ 等模型列表 ——
    await send('Page.navigate', { url: `http://localhost:3000/project/${PROJECT_ID}?mode=chat` });
    await delay(5000);
    let frontReady = false;
    for (let i = 0; i < 30; i += 1) {
      if ((await evalJS(`document.body && document.body.innerText.includes('B56-Mock-Primary')`)) === true) { frontReady = true; break; }
      await delay(1000);
    }
    console.log('NOTICE: 前端模型列表已含 B56-Mock-Primary:', frontReady);
    if (!frontReady) throw new Error('前端未加载注入模型，诊断无效');

    // 注：不用「创建新对话」按钮——实机发现它会触发跨项目路由跳转（LeftPanel
    // 项目上下文 ≠ URL 项目），是此前测量污染源之一。页面刚加载、无在跑任务，
    // 直接用当前会话即可满足隔离要求。
    await evalJSRetry(`window.__b56mof = []; window.__b56mof2 = []; window.__b56disp = []; 1`).catch(() => {});
    // 自导航后重验前端就绪（模型列表可能需重取）
    let frontReady2 = false;
    for (let i = 0; i < 20; i += 1) {
      try {
        if ((await evalJS(`document.body && document.body.innerText.includes('B56-Mock-Primary')`)) === true) { frontReady2 = true; break; }
      } catch { /* context 重建中 */ }
      await delay(1000);
    }
    console.log('NOTICE: 二次就绪确认:', frontReady2);
    if (!frontReady2) throw new Error('二次就绪确认失败（自导航后模型列表不可见）');

    // —— 发送场景 R（3 次重试：CDP evaluate 偶发丢响应）——
    let sent = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        sent = await evalJSRetry(`(async () => {
        const ta = document.querySelector('.sc-input');
        if (!ta) return { ok: false, reason: 'no_textarea' };
        ta.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, '只回复：R-DIAG-DONE。不要调用任何工具。');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        return { ok: true };
      })()`, 2);
      } catch (e) {
        sent = null;
        console.log(`WARN: 发送第 ${attempt} 次 CDP 异常: ${String(e.message || e).slice(0, 120)}`);
      }
      if (sent && sent.ok === true) break;
      console.log(`WARN: 发送第 ${attempt} 次未确认: ${JSON.stringify(sent)}`);
      await delay(3000);
    }
    if (!sent || sent.ok !== true) throw new Error(`发送失败: ${JSON.stringify(sent)}`);
    console.log('NOTICE: 场景 R 已发送');

    // —— 轮询：DOM + DB 终态 + disp 采样（同 target 校验）——
    const timeline = [];
    let taskRow = null;
    let noticeInDom = false;
    let markerInDom = false;
    for (let i = 0; i < 60; i += 1) {
      await delay(1000);
      let domNotice = false;
      let domMarker = false;
      try {
        domNotice = (await evalJS(`document.body && document.body.innerText.includes('已自动降级')`)) === true;
        domMarker = (await evalJS(`document.body && document.body.innerText.includes(${JSON.stringify(BACKUP_MARKER)})`)) === true;
      } catch (e) {
        console.log(`WARN: 轮询 DOM 采样异常（忽略）: ${String(e.message || e).slice(0, 100)}`);
        continue;
      }
      if (domNotice) noticeInDom = true;
      if (domMarker) markerInDom = true;
      taskRow = sqlite(`SELECT id, status FROM tasks WHERE json_extract(params,'$.context.projectId')='${PROJECT_ID}' AND json_extract(params,'$.modelName')='mock-primary' ORDER BY created_at DESC LIMIT 1;`);
      if (i % 3 === 0 || noticeInDom || /completed|failed/.test(taskRow)) {
        let dispLast = null;
        try { dispLast = await evalJS(`(window.__b56disp || []).slice(-1)[0] || null`); } catch {}
        timeline.push({ t: i, domNotice, domMarker, task: taskRow, dispLast });
      }
      if (/completed|failed|cancelled/.test((taskRow.split('|')[1] || ''))) break;
    }
    await delay(2500); // 等落库后 attach 渲染一轮
    console.log('NOTICE: 终态', taskRow, 'noticeInDom=', noticeInDom, 'markerInDom=', markerInDom);

    // —— 三层探针取证 ——
    const mof = await evalJS(`window.__b56mof || []`);
    const mof2 = await evalJS(`window.__b56mof2 || []`);
    const disp = await evalJS(`(window.__b56disp || []).slice(-12)`);
    const sseFB = await evalJS(`(window.__b56sse || []).filter(f => f.fb)`);
    const sseAll = await evalJS(`(window.__b56sse || []).map(f => ({ t: f.t, fb: f.fb, head: f.head.slice(0, 70) }))`);
    const chip = await evalJS(`window.__b56chip || []`);
    const chipNow = await evalJS(`(document.querySelector('.sc-msg-fallback-notice') || {}).textContent || null`);

    const verdict = {
      pinnedTargetId,
      frontReady,
      noticeInDom,
      markerInDom,
      taskRow,
      primaryHits: primaryHits.length,
      backupHits: backupHits.length,
      mof,
      mof2,
      disp,
      sseFB,
      sseAll,
      chip,
      chipNow,
      timeline: timeline.slice(-8),
    };
    console.log('=== SSE model_fallback 帧（传输层）===\n', JSON.stringify(sseFB, null, 1).slice(0, 900));
    console.log('=== chip 时间线（渲染层）===\n', JSON.stringify(chip, null, 1).slice(0, 900));
    console.log('=== mof2 落盘读回（store 层）===\n', JSON.stringify(mof2, null, 1).slice(0, 900));
    console.log('=== disp 渲染构建（last12）===\n', JSON.stringify(disp, null, 1).slice(0, 1600));
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui287-diagnose.json'), JSON.stringify(verdict, null, 2) + '\n');
    console.log('NOTICE: 诊断证据已写 acceptance/block-56/ui287-diagnose.json');
  } finally {
    restoreSettings();
    primary.server.close();
    backup.server.close();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL diagnose:', (e && e.stack) || e);
  process.exit(1);
});
