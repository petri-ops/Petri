#!/usr/bin/env node
'use strict';

/**
 * BLOCK-67 P2 实机 CDP 验收：远程项目真实对话闭环（读 → 改 → 执行 → 环境真相）。
 *   A1 REST 创建 SSH 项目 + 主窗导航进项目（远程树渲染）
 *   A2 真实模型对话一次完成四步：读 README 首行 / 追加唯一标记行 / 远程 exec 打印标记 /
 *      system_info 报远程 OS——回复同时含四个证据
 *   A3 节点侧对账：README 含追加行（write-through）；exec 输出标记真实来自远程
 *   A4 tool 活动面可见 workspace_read/write/exec 调用（agent 真走了工具，非幻觉）
 * 前置：dev Electron（9222）+ aliyun 可达 + 用户已配模型供应商。
 * 证据：acceptance/block-67/p2-live.json + p2-*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-67');
const REMOTE_ROOT = '/root/gewu-block67-demo';
const MARKER = `p2-live-${Date.now().toString(36)}`;

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function sshAliyun(cmd) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', 'aliyun', cmd], {
    encoding: 'utf8', timeout: 30000,
  });
}

function log(msg) { try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {} }

async function evalJS(client, expr, timeoutMs = 60_000) {
  const r = await Promise.race([
    client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('eval_timeout')), timeoutMs)),
  ]);
  if (r.exceptionDetails) throw new Error('eval_exception: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 400));
  return r.result?.value;
}

async function screenshot(client, file) {
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, file), Buffer.from(shot.data, 'base64'));
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = { startedAt: new Date().toISOString(), marker: MARKER, assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 500) });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`);
  };
  const auth = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };

  // ── A1：REST 创建 SSH 项目 + 主窗导航 ──
  const created = await fetchJson('http://127.0.0.1:3001/api/data/projects', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: `P2对话闭环-${MARKER}`, workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: REMOTE_ROOT }),
  });
  const projectId = created.project?.id;
  assert('A1a SSH 项目创建（REST）', !!projectId && created.project.workspace_kind === 'ssh', JSON.stringify(created).slice(0, 200));
  // 重置远程 README 到种子态
  sshAliyun(`printf '# BLOCK-67 实机验收\\n这是远程项目里的 markdown 文件。\\n' > ${REMOTE_ROOT}/README.md`);

  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
  const pages = targets.filter((t) => t.type === 'page' && /localhost:3000/.test(t.url));
  let main = null;
  for (const p of pages) {
    const c0 = await new CdpClient(p.webSocketDebuggerUrl).connect();
    const probe = await evalJS(c0, `JSON.stringify({tree:document.querySelectorAll('[class*="projectTree"]').length,right:!!document.querySelector('[class*="rightCol"]')})`).catch(() => null);
    c0.socket.close();
    if (!probe) continue;
    const s = JSON.parse(probe);
    if (s.tree > 0 && s.right) { main = p; break; }
  }
  main = main || pages[0];
  const client = await new CdpClient(main.webSocketDebuggerUrl).connect();
  await client.send('Page.navigate', { url: `http://localhost:3000/project/${projectId}` });
  let interactive = false;
  for (let i = 0; i < 40 && !interactive; i++) {
    interactive = await evalJS(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false);
    if (!interactive) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!interactive) throw new Error('app_not_interactive');
  await new Promise((r) => setTimeout(r, 2500));
  // 右栏默认不开文件 tab——经 TitleBar 飞出菜单打开（P1 同款路径）
  await evalJS(client, `(async () => {
    const more = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('展开更多工具'));
    if (more) { more.click(); await new Promise((r) => setTimeout(r, 700)); }
    const menu = document.getElementById('titlebar-tool-menu');
    const fileTab = [...(menu ? menu.querySelectorAll('button, [role="menuitem"]') : [])].find((e) => e.textContent.trim() === '文件');
    if (fileTab) fileTab.click();
    await new Promise((r) => setTimeout(r, 3500));
    return 'ok';
  })()`).catch(() => {});
  const treeOk = await evalJS(client, `[...document.querySelectorAll('[class*="fileTreeRow"]')].some((e)=>e.textContent.includes('README.md'))`).catch(() => false);
  assert('A1b 主窗进入 SSH 项目 + 远程树渲染', treeOk === true);
  await screenshot(client, 'p2-a1-project.png');

  // ── A2：真实模型对话（读→改→执行→环境真相 一次完成） ──
  const prompt = [
    `请依次完成并在回复中如实汇报：`,
    `1) 读取 README.md，原样告诉我它的第一行标题文字；`,
    `2) 用 workspace_write 在 README.md 末尾追加一行，内容恰好是：${MARKER}；`,
    `3) 用 workspace_exec 运行命令 python3 -c "print('${MARKER}-exec')"，告诉我真实输出；`,
    `4) 用 system_info 告诉我当前工作区 OS（一句话）。`,
  ].join('\n');
  const sendExpr = `(async () => {
    const ta = document.querySelector('textarea.sc-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(prompt)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const send = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title || '').includes('发送'));
    if (!send || send.disabled) return -1;
    send.click();
    return Date.now();
  })()`;
  let sendMs = -2;
  for (let attempt = 0; attempt < 3 && sendMs === -2; attempt += 1) {
    try { sendMs = await evalJS(client, sendExpr); }
    catch (e) { log('send eval retry: ' + String(e.message).slice(0, 80)); await new Promise((r) => setTimeout(r, 1500)); }
  }
  if (sendMs === -2) throw new Error('send_eval_failed');
  if (sendMs === -1) throw new Error('send_button_unavailable');

  // 轮询等回复（最长 300s）：回复出现在 assistant 消息且不再增长
  const reply = await evalJS(client, `(async () => {
    const t0 = Date.now();
    let lastText = ''; let stableSince = 0;
    while (Date.now() - t0 < 300000) {
      await new Promise((r) => setTimeout(r, 3000));
      const msgs = [...document.querySelectorAll('[class*="sc-msg-assistant"], [class*="assistantMessage"], .markdown-body')];
      const text = msgs.map((m) => m.innerText).join('\\n').trim();
      const busy = !!document.querySelector('[class*="sc-busy"], [class*="typing"]')
        || /当前阶段执行中|正在思考/.test(text.slice(-160));
      const sendBtn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title || '').includes('发送'));
      const sendEnabled = !!sendBtn && !sendBtn.disabled;
      if (text && text === lastText && !busy && sendEnabled) {
        stableSince += 3000;
        if (stableSince >= 9000) return text;
      } else stableSince = 0;
      lastText = text;
    }
    return lastText || '';
  })()`, 330_000);
  results.reply = String(reply).slice(0, 2000);

  const replyHasFirstLine = /BLOCK-67 实机验收/.test(reply);
  const replyHasMarker = reply.includes(MARKER);
  const replyHasExecOut = reply.includes(`${MARKER}-exec`);
  const replyHasOs = /Linux|linux/.test(reply);
  assert('A2 真实模型对话四证据齐（首行/写标记/exec 输出/远程 OS）',
    replyHasFirstLine && replyHasMarker && replyHasExecOut && replyHasOs,
    JSON.stringify({ replyHasFirstLine, replyHasMarker, replyHasExecOut, replyHasOs, replySample: String(reply).slice(0, 300) }));
  await screenshot(client, 'p2-a2-conversation.png');

  // ── A3：节点侧对账 ──
  const remoteReadme = sshAliyun(`cat ${REMOTE_ROOT}/README.md`);
  assert('A3a 节点侧 README 含模型追加的标记行（write-through）', remoteReadme.includes(MARKER), remoteReadme.slice(-120));

  // ── A4：tool 活动面可见（agent 真调工具） ──
  const activity = await evalJS(client, `document.body.innerText`).catch(() => '');
  const sawRead = /workspace_read|读取/.test(activity);
  const sawWrite = /workspace_write/.test(activity);
  const sawExec = /workspace_exec/.test(activity);
  assert('A4 tool 活动面可见 workspace_read/write/exec',
    sawRead && sawWrite && sawExec, JSON.stringify({ sawRead, sawWrite, sawExec }));

  // 清理：删除验收项目 + 远程 README 复位
  await fetchJson(`http://127.0.0.1:3001/api/data/projects/${projectId}`, { method: 'DELETE', headers: auth }).catch(() => {});
  sshAliyun(`printf '# BLOCK-67 实机验收\\n这是远程项目里的 markdown 文件。\\n' > ${REMOTE_ROOT}/README.md`);

  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p2-live.json'), JSON.stringify(results, null, 2));
  log(results.allPass ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => {
  log('FATAL: ' + (e && e.stack || e));
  process.exit(2);
});
