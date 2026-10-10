#!/usr/bin/env node
'use strict';

/**
 * BLOCK-67 P1e 实机 CDP 验收：SSH 远程项目 —— 创建 → 文件树 → 预览 → 编辑保存。
 *   A1 home 创建区含「SSH 远程项目…」入口，面板可开（目标候选来自 /api/ssh-projects/targets）
 *   A2 填 aliyun + /root/petri-block67-demo → 校验并创建 → 项目工作台加载，项目卡/URL 进入新项目
 *   A3 文件树渲染远程目录（README.md + data/ 目录），展开 data/ 出 demo.csv（懒展开）
 *   A4 点开 README.md 预览显示远程内容（含中文 marker）
 *   A5 编辑追加唯一标记并保存 → 远程文件真实变更（节点侧 cat 对账）；再改由节点侧直改后保存 → 409 冲突诚实呈现
 * 前置：dev Electron（--remote-debugging-port=9222，后端含 BLOCK-67 代码）+ aliyun 可达（key 已授权）。
 * 证据：acceptance/block-67/p1-live.json + p1-*.png
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.PETRI_DEBUG_PORT || '9222';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-67');
const REMOTE_ROOT = '/root/petri-block67-demo';
const MARKER = `block67-marker-${Date.now()}`;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function sshAliyun(cmd) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', 'aliyun', cmd], {
    encoding: 'utf8', timeout: 20000,
  });
}

function log(msg) { try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {} }

async function evalJS(client, expr) {
  const r = await Promise.race([
    client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('eval_timeout_60s')), 60_000)),
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
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`);
  };

  // 主窗探测（projectTree + rightCol；多窗口并存 visibilityState 不可靠——BLOCK-68 教训），
  // 复用 ui320-workbench-live.cjs 同款判真法。home 直达会触发 isInitialEntry 自动跳最近项目，
  // 故先导航 /skills 再经其「返回首页」客户端导航回 home。
  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
  const pages = targets.filter((t) => t.type === 'page' && /localhost:3000/.test(t.url));
  if (!pages.length) throw new Error('no_page_target');
  let main = null;
  for (const p of pages) {
    const c0 = await new CdpClient(p.webSocketDebuggerUrl).connect();
    const probe = await evalJS(c0, `JSON.stringify({
      tree: document.querySelectorAll('[class*="projectTree"]').length,
      right: !!document.querySelector('[class*="rightCol"]'),
    })`).catch(() => null);
    c0.socket.close();
    if (!probe) continue;
    const s = JSON.parse(probe);
    if (s.tree > 0 && s.right) { main = p; break; }
  }
  main = main || pages[0];
  const client = await new CdpClient(main.webSocketDebuggerUrl).connect();
  // home 直达（Page.navigate）必触发 isInitialEntry 自动跳最近项目；popstate 是 POP
  // 动作 react-router 也给 key='default'。可行路径：落地 /skills 后 shadow
  // history.length=1，使其「返回首页」走 navigate('/') PUSH（key 随机 → 工作台视图）。
  await client.send('Page.navigate', { url: 'http://localhost:3000/skills' });
  await new Promise((r) => setTimeout(r, 4000));
  const landed = await evalJS(client, `(async () => {
    try { Object.defineProperty(window.history, 'length', { get: () => 1, configurable: true }); } catch {}
    let b = null;
    for (let i = 0; i < 20 && !b; i++) {
      b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').includes('返回首页'));
      if (!b) await new Promise((r) => setTimeout(r, 800));
    }
    if (!b) return 'NO_BACK_BUTTON';
    b.click();
    await new Promise((r) => setTimeout(r, 2500));
    return location.pathname;
  })()`);
  if (landed !== '/') throw new Error('home_not_reached: ' + String(landed));

  // ── A1：SSH 创建入口 + 面板打开 ──
  const a1 = await evalJS(client, `(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'SSH 远程项目…');
    if (!btn) return JSON.stringify({ entry: false });
    btn.click();
    await new Promise((r) => setTimeout(r, 1500));
    const panel = document.querySelector('[data-testid="ssh-project-panel"]');
    const aliasInput = panel ? panel.querySelector('input[aria-label="SSH 主机别名"]') : null;
    const pathInput = panel ? panel.querySelector('input[aria-label="远程项目绝对路径"]') : null;
    const targetsResp = await fetch('http://127.0.0.1:3001/api/ssh-projects/targets', { headers: { Authorization: 'Bearer desktop-local' } }).then((r) => r.json()).catch(() => null);
    return JSON.stringify({
      entry: true,
      panel: !!panel,
      alias: !!aliasInput,
      path: !!pathInput,
      targetCount: targetsResp?.targets?.length ?? -1,
      targetAliases: (targetsResp?.targets || []).map((t) => t.alias).slice(0, 6),
    });
  })()`);
  const s1 = JSON.parse(a1);
  assert('A1 home 创建区 SSH 入口 + 面板 + 目标候选 API 可用',
    s1.entry && s1.panel && s1.alias && s1.path && s1.targetCount >= 1, a1);
  await screenshot(client, 'p1-a1-ssh-panel.png');

  // ── A2：填表 → 校验并创建 ──
  const tCreate0 = Date.now();
  const a2 = await evalJS(client, `(async () => {
    const panel = document.querySelector('[data-testid="ssh-project-panel"]');
    const setVal = (input, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setVal(panel.querySelector('input[aria-label="SSH 主机别名"]'), 'aliyun');
    setVal(panel.querySelector('input[aria-label="远程项目绝对路径"]'), '${REMOTE_ROOT}');
    await new Promise((r) => setTimeout(r, 300));
    const btn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('校验并创建'));
    btn.click();
    // 等导航离开 home（最长 30s）
    for (let i = 0; i < 60 && !/\\/project\\//.test(location.pathname); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    return JSON.stringify({ url: location.pathname, error: document.querySelector('[class*="emptyHomeError"]')?.textContent || '' });
  })()`);
  const createMs = Date.now() - tCreate0;
  const s2 = JSON.parse(a2);
  assert(`A2 SSH 项目创建成功并进入工作台（创建+校验链 ${createMs}ms）`,
    /\/project\//.test(s2.url) && !s2.error, a2 + ` createMs=${createMs}`);

  // ── A3：文件树渲染远程目录（先开右栏「文件」tab——TitleBar 飞出菜单） ──
  await new Promise((r) => setTimeout(r, 2500));
  await evalJS(client, `(async () => {
    const more = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('展开更多工具') || (b.getAttribute('aria-label') || '').includes('展开更多工具'));
    if (more) { more.click(); await new Promise((r) => setTimeout(r, 700)); }
    const menu = document.getElementById('titlebar-tool-menu');
    const fileTab = [...(menu ? menu.querySelectorAll('button, [role="menuitem"]') : [])].find((e) => e.textContent.trim() === '文件');
    if (fileTab) fileTab.click();
    await new Promise((r) => setTimeout(r, 800));
    return 'files-tab-opened';
  })()`);
  const tTree0 = Date.now();
  const a3 = await evalJS(client, `(async () => {
    // 等树首次加载（远程首拉）
    for (let i = 0; i < 20; i++) {
      const rows = [...document.querySelectorAll('[class*="fileTreeRow"]')];
      if (rows.length >= 1) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const names = () => [...document.querySelectorAll('[class*="fileTreeRow"]')].map((e) => e.textContent.trim());
    const before = names();
    // 展开 data/ 目录（懒拉取）
    const dataRow = [...document.querySelectorAll('[class*="fileTreeRow"]')].find((e) => e.textContent.trim() === 'data');
    if (dataRow) {
      dataRow.click();
      await new Promise((r) => setTimeout(r, 3000));
    }
    return JSON.stringify({ before, after: names() });
  })()`);
  const treeMs = Date.now() - tTree0;
  const s3 = JSON.parse(a3);
  assert(`A3 文件树渲染远程目录 + data/ 懒展开（树链 ${treeMs}ms）`,
    s3.before.some((n) => n.includes('README.md')) && s3.before.some((n) => n.includes('data'))
      && s3.after.some((n) => n.includes('demo.csv')), a3 + ` treeMs=${treeMs}`);
  await screenshot(client, 'p1-a3-remote-tree.png');

  // ── A4：预览 README.md ──
  const tPrev0 = Date.now();
  const a4 = await evalJS(client, `(async () => {
    const row = [...document.querySelectorAll('[class*="fileTreeRow"]')].find((e) => e.textContent.includes('README.md'));
    if (!row) return JSON.stringify({ found: false });
    const t0 = performance.now();
    row.click();
    for (let i = 0; i < 100; i++) {
      const body = document.body.innerText;
      if (body.includes('BLOCK-67 实机验收')) return JSON.stringify({ found: true, rendered: true, ms: Math.round(performance.now() - t0) });
      await new Promise((r) => setTimeout(r, 200));
    }
    return JSON.stringify({ found: true, rendered: false, sample: document.body.innerText.slice(0, 200) });
  })()`);
  const prevMs = Date.now() - tPrev0;
  const s4 = JSON.parse(a4);
  const firstFrameMs = typeof s4.ms === 'number' ? s4.ms : prevMs;
  assert(`A4 远程文件预览渲染（预览首帧 ${firstFrameMs}ms ≤ 2000 预算）`,
    s4.found && s4.rendered && firstFrameMs <= 2000, a4 + ` wallMs=${prevMs}`);
  await screenshot(client, 'p1-a4-remote-preview.png');

  // ── A5：编辑 + 保存 + 远程对账 + 409 冲突 ──
  const a5 = await evalJS(client, `(async () => {
    // markdown 预览默认 'preview' 视图——先点「编辑」tab 进 CodeMirror 编辑态。
    const editTab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '编辑' && b.getAttribute('aria-pressed') !== null);
    if (editTab) { editTab.click(); await new Promise((r) => setTimeout(r, 800)); }
    const cm = document.querySelector('.cm-content[contenteditable="true"]');
    if (!cm) return JSON.stringify({ editor: false, editTab: !!editTab });
    cm.focus();
    // 光标到末尾并输入 marker 行（用键盘事件不可靠，直接设置文本 + input 事件）
    const sel = window.getSelection();
    sel.selectAllChildren(cm);
    // 直接整体重写：旧文本 + marker
    const oldText = cm.textContent;
    document.execCommand('insertText', false, oldText + '\\n${MARKER}\\n');
    await new Promise((r) => setTimeout(r, 600));
    const saveBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存');
    if (!saveBtn || saveBtn.disabled) return JSON.stringify({ editor: true, dirty: false, sample: oldText.slice(0, 80) });
    saveBtn.click();
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (saveBtn.disabled) return JSON.stringify({ editor: true, dirty: true, saved: true });
    }
    return JSON.stringify({ editor: true, dirty: true, saved: false, err: document.querySelector('[data-testid="ssh-save-error"]')?.textContent || '' });
  })()`);
  const s5 = JSON.parse(a5);
  // 远程节点对账
  const remoteContent = sshAliyun(`cat ${REMOTE_ROOT}/README.md`);
  const savedOnRemote = remoteContent.includes(MARKER);
  assert('A5a 编辑保存 write-through 直写远程（节点侧 cat 对账含唯一标记）',
    s5.saved && savedOnRemote, JSON.stringify({ ui: s5, remoteHasMarker: savedOnRemote }));

  // A5b 冲突检测：节点侧直改文件（mtime 变化），UI 内再次编辑保存 → 409 诚实呈现
  sshAliyun(`printf '\\nnode-side-change $(date +%%s)\\n' >> ${REMOTE_ROOT}/README.md`);
  const a5b = await evalJS(client, `(async () => {
    // 重新加载文件（重新点树行拿新 mtime 基线前，先用当前脏态保存 → 应 409）
    const cm = document.querySelector('.cm-content[contenteditable="true"]');
    if (!cm) return JSON.stringify({ editor: false });
    cm.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(cm);
    document.execCommand('insertText', false, cm.textContent + '\\nsecond-edit-attempt\\n');
    await new Promise((r) => setTimeout(r, 600));
    const saveBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存');
    if (!saveBtn || saveBtn.disabled) return JSON.stringify({ dirty: false });
    saveBtn.click();
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const err = document.querySelector('[data-testid="ssh-save-error"]');
      if (err && err.textContent) return JSON.stringify({ conflict: true, msg: err.textContent });
    }
    return JSON.stringify({ conflict: false });
  })()`);
  const s5b = JSON.parse(a5b);
  const nodeChangeKept = sshAliyun(`cat ${REMOTE_ROOT}/README.md`).includes('node-side-change');
  assert('A5b mtime 冲突 409 诚实呈现 + 节点侧修改未被覆盖（D3）',
    s5b.conflict && nodeChangeKept, JSON.stringify(s5b) + ` nodeChangeKept=${nodeChangeKept}`);
  await screenshot(client, 'p1-a5-conflict.png');

  // 性能预算汇总（D2）
  results.timing = { createMs, treeMs, previewFirstFrameMs: typeof s4.ms === 'number' ? s4.ms : prevMs };

  // 清理：删除验收创建的 SSH 项目（保留远程 demo 目录供复跑）
  const cleanup = await evalJS(client, `(async () => {
    const projectId = location.pathname.split('/').filter(Boolean).pop();
    const resp = await fetch('/api/data/projects/' + projectId, { method: 'DELETE', headers: { Authorization: 'Bearer desktop-local' } });
    return JSON.stringify({ status: resp.status });
  })()`).catch((e) => `cleanup_error: ${e.message}`);
  results.cleanup = cleanup;
  // 还原远程 README（去掉 marker，保留 node-side-change 也一并清掉，重置为种子内容）
  sshAliyun(`printf '# BLOCK-67 实机验收\\n这是远程项目里的 markdown 文件。\\n' > ${REMOTE_ROOT}/README.md`);

  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p1-live.json'), JSON.stringify(results, null, 2));
  log(results.allPass ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => {
  log('FATAL: ' + (e && e.stack || e));
  process.exit(2);
});
