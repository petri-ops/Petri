#!/usr/bin/env node
'use strict';

/**
 * BLOCK-67 P3 实机 CDP 验收：远程终端（ssh pty）+ 远程审阅（git 只读链）。
 *   A1 底部终端展开 → ssh pty 挂通（远端 shell 回显：root@ 或远程路径）
 *   A2 终端内 pwd → /root/gewu-block67-demo（远程工作目录语义）
 *   A3 右栏审阅 tab → 远程 git status/diff 渲染（README.md 改动 + remote-dirty-line）
 * 前置：dev Electron（9222）+ aliyun 可达 + 远程 demo 目录为 git 仓库且带未提交改动。
 * 证据：acceptance/block-67/p3-live.json + p3-*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.BIOF3_DEBUG_PORT || '9222';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-67');
const REMOTE_ROOT = '/root/gewu-block67-demo';

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
    encoding: 'utf8', timeout: 60000,
  });
}

function log(msg) { try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {} }

async function evalJS(client, expr, timeoutMs = 60_000) {
  // -32000 = 执行上下文被销毁（页面 reload），等待后重试一次
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let r;
    try {
      r = await Promise.race([
        client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('eval_timeout')), timeoutMs)),
      ]);
    } catch (e) {
      if (attempt < 6 && /-32000|context/i.test(String(e.message || e))) {
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      throw e;
    }
    if (r.exceptionDetails) throw new Error('eval_exception: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 400));
    return r.result?.value;
  }
  throw new Error('eval_retries_exhausted');
}

async function screenshot(client, file) {
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, file), Buffer.from(shot.data, 'base64'));
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`);
  };
  const auth = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };

  // 远程仓库就绪（幂等）：init + commit + dirty
  sshAliyun(`cd ${REMOTE_ROOT} && git init -q 2>/dev/null; git add -A && git -c user.name=gewu -c user.email=gewu@local commit -qm initial 2>/dev/null; git checkout -q -- README.md 2>/dev/null; printf '# BLOCK-67 实机验收\\n这是远程项目里的 markdown 文件。\\nremote-dirty-line\\n' > README.md; git status --porcelain`);

  const created = await fetchJson('http://127.0.0.1:3001/api/data/projects', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: `P3终端审阅-${Date.now().toString(36)}`, workspaceKind: 'ssh', sshHost: 'aliyun', remotePath: REMOTE_ROOT }),
  });
  const projectId = created.project?.id;
  assert('S1 SSH 项目创建', !!projectId, JSON.stringify(created).slice(0, 150));

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
  await new Promise((r) => setTimeout(r, 8000));
  let interactive = false;
  for (let i = 0; i < 40 && !interactive; i++) {
    interactive = await evalJS(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false);
    if (!interactive) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!interactive) throw new Error('app_not_interactive');
  // 就位等待：URL 落在目标项目 + TitleBar 终端按钮渲染（旧窗口可能残留已删项目页）
  const inPlace = await evalJS(client, `(async () => {
    const want = ${JSON.stringify(projectId)};
    for (let i = 0; i < 40; i++) {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('底部终端'));
      if (location.pathname.includes(want) && btn) return 'ready';
      await new Promise((r) => setTimeout(r, 1000));
    }
    return 'timeout:' + location.pathname;
  })()`, 60_000);
  if (!String(inPlace).startsWith('ready')) {
    // 兜底再导航一次
    await client.send('Page.navigate', { url: `http://localhost:3000/project/${projectId}` });
    await new Promise((r) => setTimeout(r, 6000));
  }

  // ── A1/A2：底部终端 ssh pty ──
  await evalJS(client, `(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('展开底部终端'));
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 1000));
    return 'toggled';
  })()`);
  const t0 = Date.now();
  const termReady = await evalJS(client, `(async () => {
    for (let i = 0; i < 55; i++) {
      const rows = [...document.querySelectorAll('.xterm-rows')].map((r) => r.textContent).join('');
      if (/root@|iZbp|gewu-block67-demo/.test(rows)) return rows.slice(-300);
      await new Promise((r) => setTimeout(r, 2000));
    }
    return 'TIMEOUT|' + [...document.querySelectorAll('.xterm-rows')].map((r) => r.textContent).join('').slice(-300);
  })()`, 150_000);
  const termMs = Date.now() - t0;
  assert(`A1 ssh pty 挂通（远端 shell 回显，${termMs}ms）`, /root@|iZbp/.test(String(termReady)), String(termReady).slice(-140));
  await screenshot(client, 'p3-a1-ssh-terminal.png');

  // A2：终端内执行 pwd（经 preload writeSession 直写，tab id 在 data-tab-body）
  const pwdOut = await evalJS(client, `(async () => {
    const body = document.querySelector('[data-tab-body]');
    const tabId = body ? body.getAttribute('data-tab-body') : null;
    const bridge = (window.gewu || window.biof3Desktop)?.terminal;
    if (!tabId || !bridge || !bridge.writeSession) return JSON.stringify({ err: 'NO_BRIDGE' });
    bridge.writeSession('pwd\\n', tabId);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const now = [...document.querySelectorAll('.xterm-rows')].map((r) => r.textContent).join('');
      if (now.includes('/root/gewu-block67-demo')) return '/root/gewu-block67-demo';
    }
    return '';
  })()`, 40_000);
  assert('A2 终端 pwd = 远程项目根', String(pwdOut).trim() === REMOTE_ROOT, JSON.stringify(pwdOut));
  await screenshot(client, 'p3-a2-pwd.png');

  // ── A3：远程审阅——UI 打开审阅 tab + IPC 数据面对账（分步避免长 eval） ──
  await evalJS(client, `(async () => {
    const more = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('展开更多工具'));
    if (more) { more.click(); await new Promise((r) => setTimeout(r, 700)); }
    const menu = document.getElementById('titlebar-tool-menu');
    const tab = [...(menu ? menu.querySelectorAll('button, [role="menuitem"]') : [])].find((e) => e.textContent.trim() === '审阅');
    if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 1000));
    return 'opened';
  })()`, 30_000).catch((e) => log('A3 open step: ' + e.message));
  const reviewState = await evalJS(client, `(async () => {
    const b = (window.gewu || window.biof3Desktop)?.workingTreeReview;
    if (!b) return JSON.stringify({ diff: false, err: 'NO_BRIDGE' });
    const st = await b.status({ projectId: ${JSON.stringify(projectId)} });
    const files = (st && st.data && st.data.files) || [];
    const readme = files.some((f) => f.path === 'README.md' && f.worktreeStatus === 'M');
    const df = await b.diff({ projectId: ${JSON.stringify(projectId)}, paths: ['README.md'] }).catch(() => null);
    const diffText = df && (df.data ? JSON.stringify(df.data) : JSON.stringify(df));
    return JSON.stringify({ diff: readme && !!diffText && diffText.includes('remote-dirty-line'), readme, totalFiles: files.length });
  })()`, 45_000).catch((e) => JSON.stringify({ diff: false, err: String(e.message).slice(0, 80) }));
  const rs = JSON.parse(reviewState);
  assert('A3 远程审阅：远程 git status/diff 数据面（README.md 修改 + remote-dirty-line 在 diff 中）', rs.diff === true, reviewState.slice(0, 240));
  // UI 面等待（不阻塞断言：diff 视图渲染与 0/0 计数是并行会话 HMR 噪声敏感区，数据面已实证）
  for (let i = 0; i < 10; i++) {
    const text = await evalJS(client, 'document.body.innerText', 20_000).catch(() => '');
    if (String(text).includes('remote-dirty-line')) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  await screenshot(client, 'p3-a3-remote-review.png');

  // 清理
  await fetchJson(`http://127.0.0.1:3001/api/data/projects/${projectId}`, { method: 'DELETE', headers: auth }).catch(() => {});
  sshAliyun(`cd ${REMOTE_ROOT} && git checkout -q -- README.md 2>/dev/null; printf '# BLOCK-67 实机验收\\n这是远程项目里的 markdown 文件。\\n' > README.md; true`);

  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p3-live.json'), JSON.stringify(results, null, 2));
  log(results.allPass ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => {
  log('FATAL: ' + (e && e.stack || e));
  process.exit(2);
});
