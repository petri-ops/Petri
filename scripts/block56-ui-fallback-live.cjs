#!/usr/bin/env node
'use strict';
/**
 * BLOCK-56 UI-287 收尾 — 模型降级任务条 dev Electron 实机（CDP + mock 故障注入）。
 *
 * 场景：
 *   R（请求级）：主 mock 返回 500 → gateway 同任务内切备用 profile → model_fallback
 *     事件 → 任务条 notice「已降级…」→ 备用模型完成回复（marker 回显）。
 *   T（任务级）：主 mock 返回 400 context → 原任务 failed → agent-fallback 新建
 *     fallbackOfTaskId 续跑任务 → 前端无缝切订阅 → notice + 备用 marker。
 *
 * 注入面（三处缺一不可，2026-09-04 实机教训）：
 *   - model_profiles：前端 useAiSettings 以 model_profiles 优先（chat_model_presets
 *     仅在 model_profiles 为空时兜底）；gateway 侧 profile 解析/能力校验同样读它。
 *     mock profile 必须带 capabilities:['chat','streaming','tools']（agent 角色
 *     要求 tools 能力，resolveModelProfile 硬校验）。
 *   - chat_model_presets：任务创建路径 getChatModelPreset(modelPresetId) 读它。
 *   - model_role_bindings / model_fallback_bindings / model_fallback_enabled：
 *     角色绑定 + 降级链配置。
 *
 * 配置安全：ai-settings.json 先备份，finally/exit 恢复字节级原样（chmod 600）。
 * 证据：acceptance/block-56/ui-fallback-live.json + 截图 ×2。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { execSync } = require('child_process');

const CDP_PORT = '9222';
const PROJECT_ID = 'p_mtlnsv0f_xpjb';
const DB_FILE = path.join(__dirname, '..', '.petri-dev-user-data', 'data', 'petri.db');
const SETTINGS_FILE = path.join(__dirname, '..', '.petri-dev-user-data', 'data', 'ai-settings.json');
const PRIMARY_ID = 'b56-mock-primary';
const BACKUP_ID = 'b56-mock-backup';
const BACKUP_MARKER = 'B56-BACKUP-OK — 本条回复由备用模型 B56-Mock-Backup 生成（BLOCK-56 降级链路实机验证固定回执，长度超过任务完成门限）。';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-56');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const results = { startedAt: new Date().toISOString(), assertions: [], screenshots: [] };
const assert = (name, pass, detail) => {
  results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 220)}`);
};
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

const primaryState = { mode: 'overload500', hits: [] };
const backupHits = [];

async function startMockServers() {
  const primary = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      primaryState.hits.push({ mode: primaryState.mode, path: req.url });
      if (primaryState.mode === 'overload500') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'The server is overloaded. Please try again later.' } }));
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          message: "This model's maximum context length is 131072 tokens. However, your messages resulted in 150000 tokens. Please reduce the length of the messages.",
          type: 'invalid_request_error',
        },
      }));
    });
  });

  const backup = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch {}
      backupHits.push({ path: req.url, stream: parsed.stream === true, model: parsed.model });
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

  return { primary, backup };
}

async function main() {
  const { primary, backup } = await startMockServers();
  const primaryPort = primary.port;
  const backupPort = backup.port;
  console.log(`NOTICE: mock 主=${primaryPort}（mode=${primaryState.mode}） 备=${backupPort}`);

  // —— 配置备份 + 注入（finally/exit 恢复）——
  const originalRaw = fs.readFileSync(SETTINGS_FILE, 'utf8');
  const backupFile = path.join(os.tmpdir(), `ai-settings-backup-${Date.now()}.json`);
  fs.writeFileSync(backupFile, originalRaw);
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
    // 注入面 1：model_profiles（前端模型列表权威源 + gateway profile 解析/能力校验）
    settings.model_profiles = [
      ...(settings.model_profiles || []).filter((p) => p && p.id !== PRIMARY_ID && p.id !== BACKUP_ID),
      mockProfile(PRIMARY_ID, 'mock-primary', primaryPort),
      mockProfile(BACKUP_ID, 'mock-backup', backupPort),
    ];
    // 注入面 2：chat_model_presets（任务创建路径 getChatModelPreset 读它）
    settings.chat_model_presets = [
      ...(settings.chat_model_presets || []).filter((p) => p && p.id !== PRIMARY_ID && p.id !== BACKUP_ID),
      { id: PRIMARY_ID, label: 'B56-Mock-Primary', provider: 'openai-compatible', model: 'mock-primary', baseUrl: `http://127.0.0.1:${primaryPort}/v1` },
      { id: BACKUP_ID, label: 'B56-Mock-Backup', provider: 'openai-compatible', model: 'mock-backup', baseUrl: `http://127.0.0.1:${backupPort}/v1` },
    ];
    // 注入面 3：角色绑定 + 降级链
    settings.active_chat_model_id = PRIMARY_ID;
    settings.model_role_bindings = {
      ...(settings.model_role_bindings || {}),
      chat: PRIMARY_ID,
      agent: PRIMARY_ID,
    };
    settings.model_fallback_enabled = true;
    settings.model_fallback_bindings = {
      ...(settings.model_fallback_bindings || {}),
      chat: [BACKUP_ID],
      agent: [BACKUP_ID],
    };
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
      console.error('FAIL: 配置恢复失败，备份在', backupFile, e);
    }
  };
  process.on('exit', () => { if (injected) restoreSettings(); });

  // —— CDP 客户端（send 带 30s 超时，防止主进程 event-loop 长阻塞时永久挂起）——
  const targets = await httpGetJson(`http://localhost:${CDP_PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page' && !/devtools/i.test(t.url));
  if (!page) throw new Error('no page target');
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
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJS = async (expr) => {
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (res.result && res.result.exceptionDetails) {
          const d = res.result.exceptionDetails;
          lastErr = new Error(`evaluate 异常: ${d.text || ''} ${JSON.stringify(d.exception || {}).slice(0, 200)}`);
        } else {
          return res.result && res.result.result ? res.result.result.value : undefined;
        }
      } catch (e) {
        lastErr = e;
      }
      await delay(2000);
    }
    throw lastErr;
  };
  const screenshot = async (file) => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const res = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
        results.screenshots.push(path.basename(file));
        console.log('NOTICE: 截图', path.basename(file));
        return;
      } catch (e) {
        if (attempt >= 2) console.log('WARN: 截图失败（不阻塞断言）', String(e.message || e));
        await delay(2000);
      }
    }
  };
  const sendPromptOnce = async (text) => evalJS(`(async () => {
    const ta = document.querySelector('.sc-input');
    if (!ta) return { ok: false, reason: 'no_textarea' };
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return { ok: true };
  })()`);
  const sendPrompt = async (text) => {
    let r;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      r = await sendPromptOnce(text);
      if (r && r.ok === true) return;
      console.log(`WARN: sendPrompt 第 ${attempt} 次未成功: ${JSON.stringify(r)}`);
      await delay(3000);
    }
    throw new Error(`sendPrompt 失败: ${JSON.stringify(r)}`);
  };
  const domHas = (needle) => evalJS(`document.body && document.body.innerText.includes(${JSON.stringify(needle)})`);
  const domCount = (needle) => evalJS(`(document.body && document.body.innerText.match(new RegExp(${JSON.stringify(needle)}, 'g')) || []).length`);
  const waitForDom = async (needle, timeoutMs = 12000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await domHas(needle)) return true;
      await delay(1000);
    }
    return false;
  };

  await send('Page.enable');
  await send('Page.navigate', { url: `http://localhost:3000/project/${PROJECT_ID}?mode=chat` });
  await delay(3500);

  // —— 场景 R：请求级降级（同任务内切备用）——
  injectSettings();
  // 前端在页面加载时经 IPC 取模型列表（model_profiles 权威）：注入后必须重载页面，
  // 否则新任务仍会用旧 deepseek preset（stale 前端状态）。
  await send('Page.navigate', { url: `http://localhost:3000/project/${PROJECT_ID}?mode=chat` });
  await delay(5000);
  // 前端已加载注入后的模型列表：activeModel 应为 mock-primary。
  // useAiSettings 是异步 bridge 取数（SWR 种子默认 deepseek-chat），
  // 必须等前端真正显示 mock preset 再发任务，否则又会打到旧模型。
  let frontReady = false;
  for (let i = 0; i < 30; i += 1) {
    if (await domHas('B56-Mock-Primary')) { frontReady = true; break; }
    await delay(1000);
  }
  results.frontReady = frontReady;
  console.log('NOTICE: 前端模型列表已含 B56-Mock-Primary:', frontReady);
  if (!frontReady) console.log('WARN: 30s 内前端未显示 mock preset，继续执行（大概率失败，用于取证）');
  primaryState.mode = 'overload500';
  await sendPrompt('只回复：R-SCENARIO-DONE-REPORT。不要调用任何工具。');
  console.log('NOTICE: 场景 R 已发送，等待任务终态（最长 90s）…');
  let taskR = null;
  let noticeSeenMidRun = false;
  let markerSeenMidRun = false;
  for (let i = 0; i < 90; i += 1) {
    await delay(1000);
    // mid-run 探针：区分「事件未达前端」与「落库后 overlay 被替代导致 notice 消失」
    if (!noticeSeenMidRun && await domHas('已自动降级')) noticeSeenMidRun = true;
    if (!markerSeenMidRun && await domHas(BACKUP_MARKER)) markerSeenMidRun = true;
    const row = sqlite(`SELECT id, status FROM tasks WHERE json_extract(params,'$.context.projectId')='${PROJECT_ID}' AND json_extract(params,'$.modelName')='mock-primary' ORDER BY created_at DESC LIMIT 1;`);
    const [id, status] = row.split('|');
    if (id && status !== 'running') { taskR = { id, status }; break; }
  }
  results.noticeSeenMidRun = noticeSeenMidRun;
  results.markerSeenMidRun = markerSeenMidRun;
  console.log(`NOTICE: mid-run 探针 — notice=${noticeSeenMidRun} marker=${markerSeenMidRun}`);
  assert('场景 R 任务到达终态（completed，同任务）', !!taskR && taskR.status === 'completed', JSON.stringify(taskR));
  const fbEventR = taskR ? sqlite(`SELECT count(*) FROM task_events WHERE task_id='${taskR.id}' AND payload LIKE '%model_fallback%';`) : '0';
  assert('场景 R task_events 记录 model_fallback（请求级）', Number(fbEventR) >= 1, `命中=${fbEventR}`);
  assert('场景 R mock 主模型确实被命中（500 注入生效）', primaryState.hits.length >= 1, `primaryHits=${primaryState.hits.length}`);
  const markerR = await waitForDom(BACKUP_MARKER);
  const noticeR = await waitForDom('已自动降级');
  assert('场景 R 前端可见备用回复 marker', markerR === true, `marker in DOM=${markerR}`);
  assert('场景 R 前端可见降级 notice（已自动降级 chip）', noticeR === true, `notice in DOM=${noticeR}`);
  await screenshot(path.join(EVIDENCE_DIR, 'ui287-request-level-fallback.png'));

  // —— 场景 T：任务级降级（原任务失败 → 新任务续跑 → 无缝切订阅）——
  const errorCountBeforeT = await domCount('发生未知错误');
  primaryState.mode = 'context400';
  await sendPrompt('只回复：T-SCENARIO-DONE-REPORT。不要调用任何工具。');
  console.log('NOTICE: 场景 T 已发送，等待原任务失败 + 降级续跑任务完成（最长 90s）…');
  let pairT = null;
  for (let i = 0; i < 90; i += 1) {
    await delay(1000);
    const rows = sqlite(`SELECT id, status, json_extract(params,'$.fallbackOfTaskId') FROM tasks WHERE json_extract(params,'$.context.projectId')='${PROJECT_ID}' AND (json_extract(params,'$.modelName')='mock-primary' OR json_extract(params,'$.modelName')='mock-backup') ORDER BY created_at DESC LIMIT 2;`);
    const lines = rows.split('\n').filter(Boolean).map((l) => l.split('|'));
    const failed = lines.find((x) => x[1] === 'failed');
    const resumed = lines.find((x) => x[2] && x[2] !== 'null' && x[1] === 'completed');
    if (failed && resumed && resumed[2] === failed[0]) { pairT = { failed: failed[0], resumed: resumed[0] }; break; }
  }
  assert('场景 T 原任务 failed + 续跑任务 completed（fallbackOfTaskId 溯源）', !!pairT, JSON.stringify(pairT));
  const resumedParams = pairT ? sqlite(`SELECT json_extract(params,'$.providerLabel'), json_extract(params,'$.disableProviderFallback') FROM tasks WHERE id='${pairT.resumed}';`) : '';
  assert('场景 T 续跑任务使用备用 profile 且关闭请求级 fallback（单级不连环）', /B56-Mock-Backup/.test(resumedParams), resumedParams);
  const markerT = await waitForDom(BACKUP_MARKER);
  assert('场景 T 前端可见备用回复 marker', markerT === true, `marker in DOM=${markerT}`);
  const noticeT = await waitForDom('已自动降级');
  assert('场景 T 前端可见降级 notice（持久渲染条，已自动降级 chip）', noticeT === true, `notice in DOM=${noticeT}`);
  const errorCountAfterT = await domCount('发生未知错误');
  assert('场景 T 无新增错误横幅（无缝接管，任务未消失）', errorCountAfterT === errorCountBeforeT, `before=${errorCountBeforeT} after=${errorCountAfterT}`);
  await screenshot(path.join(EVIDENCE_DIR, 'ui287-task-level-fallback.png'));

  results.taskR = taskR;
  results.pairT = pairT;
  results.primaryHits = primaryState.hits.length;
  results.backupHits = backupHits.length;

  // —— 恢复配置 ——
  restoreSettings();
  assert('ai-settings.json 已恢复原样（active 回 deepseek）', fs.readFileSync(SETTINGS_FILE, 'utf8') === originalRaw, 'byte-exact restore');
  try { fs.rmSync(backupFile, { force: true }); } catch {}
  primary.server.close();
  backup.server.close();

  results.finishedAt = new Date().toISOString();
  results.allPass = results.assertions.every((a) => a.pass);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui-fallback-live.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n证据已写入 acceptance/block-56/ui-fallback-live.json (allPass=${results.allPass})`);
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL UI-287 降级实机异常:', (e && e.stack) || e);
  process.exit(1);
});
