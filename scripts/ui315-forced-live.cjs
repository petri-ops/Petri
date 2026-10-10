#!/usr/bin/env node
// platform-note: dual — powershell 出现在 agent 提示词内（由 workspace_exec 在执行目标侧运行），脚本本体平台无关。（BLOCK-104 P4 门禁标注）
'use strict';

/**
 * UI-315 forced 实机验收（dev Electron + 真实模型 + CDP）：
 *   1) 当前会话 baseline 终端块数 → composer 发送 forced workspace_exec 提示
 *      （唯一标记命令 node -e "console.log(314159*2)"，与历史终端行无歧义）
 *   2) 断言新终端块渲染：折叠头命令预览含标记 / data-status=success / ✓ 状态字形
 *   3) 展开该行断言（UI-315 优化三 WIP DOM 契约）：
 *      - 展开体命令行 .sc-tool-term-command-text 含标记（$ 前缀）
 *      - 行内图标复制按钮 .sc-tool-term-copy（命令）+ .sc-tool-term-copy-out（输出，hover 显隐）
 *      - 输出 pre 含 628318（314159*2）
 *   4) Page.reload 历史恢复：meta.toolActivities 持久化，命令/输出仍可回看
 * 前置：dev Electron 已在跑（--remote-debugging-port=9222）+ vite :3000 + 已配置真实模型 + 完全访问档。
 * 证据：acceptance/ui-315/ui315-forced.json + ui315-terminal-live.png + ui315-history-restore.png
 * 选择器契约基线：cc084920（优化二折叠行 + ✓ 字形）+ 优化三 WIP（展开体命令行 + 行内复制图标）。
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.PETRI_DEBUG_PORT || '9222';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-315');
const MARK = '314159';
const EXPECT_OUT = '628318';
// 唯一标记命令的输出（628318）模型无法编造——只有真实执行才能产出，
// 避免 forced 场景下模型直接口算作答造成假阳性。
const PROMPT = `你必须调用 workspace_exec 工具（这是硬性要求，禁止直接回答、禁止编造输出），执行命令 node -e "console.log(${MARK} * 2)"，参数 shell 用 powershell。调用完成后把工具真实输出原样告诉我。`;
const POLL_MS = 1500;
const TIMEOUT_MS = 5 * 60 * 1000;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function log(msg) { try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {} }

async function evalJS(client, expr) {
  const r = await Promise.race([
    client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('eval_timeout_30s')), 30_000)),
  ]);
  if (r.exceptionDetails) throw new Error('eval_exception: ' + String(r.exceptionDetails.text || '').slice(0, 200));
  return r.result?.value;
}


async function poll(client, label, expr, predicate, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalJS(client, expr);
    // 表达式可能返回 JSON 字符串：统一反序列化后再交给谓词
    if (typeof last === 'string') { try { last = JSON.parse(last); } catch {} }
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 300)}`);
}

async function screenshot(client, file) {
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, file), Buffer.from(shot.data, 'base64'));
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [], selectorContract: 'cc084920 + wip-inline-copy' };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 140) : ''}`);
  };

  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
  const pages = targets.filter((t) => t.type === 'page' && /localhost:3000\/project\//.test(t.url));
  if (!pages.length) throw new Error('no_project_page_target');
  // 多窗口并存时挑可见的那扇（后台窗口可能没有左栏项目树）
  let main = null;
  let fallback = null;
  for (const p of pages) {
    const c0 = await new CdpClient(p.webSocketDebuggerUrl).connect();
    const probe = await evalJS(c0, 'document.visibilityState + "|" + !!document.querySelector("textarea.sc-input")').catch(() => 'err|false');
    if (probe.startsWith('visible|true')) { main = p; c0.socket.close(); break; }
    if (!fallback && probe.endsWith('true')) fallback = p;
    c0.socket.close();
  }
  main = main || fallback || pages[0];
  const client = await new CdpClient(main.webSocketDebuggerUrl).connect();

  // ── baseline（dev 重启后可能落在 home 无 composer：导航到项目工作区兜底）──
  // 新建会话再跑 forced：干净历史下验收，同时排除长会话历史对模型行为的污染
  const base = await (async () => {
    const deadline = Date.now() + 90_000;
    for (;;) {
      const s = JSON.parse(await evalJS(client, `JSON.stringify({
        terms: document.querySelectorAll('.sc-tool-term').length,
        composer: !!document.querySelector('textarea.sc-input'),
        sendBtn: !!document.querySelector('.sc-send-cta'),
        newConvBtn: !!document.querySelector('button[title="创建新对话"]'),
      })`).catch(() => ({ composer: false })));
      if (s.composer && s.sendBtn) return s;
      if (Date.now() > deadline) throw new Error('composer_not_found_after_wait');
      await client.send('Page.navigate', { url: 'http://localhost:3000/project/p_mtkamsfu_3mxo' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 5000));
    }
  })();
  // ── 新建会话：先 reload 复位面板状态，再重试点击「创建新对话」直至空会话出现 ──
  await client.send('Page.reload');
  await new Promise((r) => setTimeout(r, 6000));
  await evalJS(client, `(() => {
    const btn = document.querySelector('button[title="创建新对话"]');
    if (btn && !btn.disabled) btn.click();
  })()`).catch(() => {});
  const freshDeadline = Date.now() + 90_000;
  let freshTerms = -1;
  for (;;) {
    if (Date.now() > freshDeadline) {
      throw new Error(`fresh_conversation_timeout :: terms=${freshTerms}`);
    }
    freshTerms = await evalJS(client, `document.querySelectorAll('.sc-tool-term').length`).catch(() => -1);
    if (freshTerms === 0) break;
    // 尚未切到空会话：重查按钮并重试点击（面板可能尚未渲染/按钮 disabled）
    await evalJS(client, `(() => {
      const btn = document.querySelector('button[title="创建新对话"]');
      if (btn && !btn.disabled) btn.click();
    })()`).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
  }
  base.terms = freshTerms;
  assert('A0 composer 在位（textarea + send 按钮）', base.composer && base.sendBtn, JSON.stringify(base));
  log('fresh conversation terms=' + freshTerms);

  // ── 发送 forced 提示 ──
  await evalJS(client, `(() => {
    const ta = document.querySelector('textarea.sc-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(PROMPT)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  await evalJS(client, `(() => {
    const btn = document.querySelector('.sc-send-cta');
    if (btn && !btn.disabled) btn.click();
  })()`);
  log('prompt sent, waiting for terminal row...');

  // ── 等新终端块出现 ──
  const countExpr = `document.querySelectorAll('.sc-tool-term').length`;
  await poll(client, 'new term row', countExpr, (n) => n > base.terms);
  assert('A1 forced exec 新终端块出现', true, `count ${base.terms} → 增量已见`);

  // ── 等该行完成（status 离开 running）且流式结束 ──
  const rowStateExpr = `(() => {
    const rows = [...document.querySelectorAll('.sc-tool-term')];
    const row = rows.filter((r) => (r.querySelector('.sc-tool-term-cmd-preview')?.textContent || '').includes('${MARK}')).pop();
    if (!row) return JSON.stringify({ found: false });
    return JSON.stringify({
      found: true,
      status: row.getAttribute('data-status'),
      headCmd: (row.querySelector('.sc-tool-term-cmd-preview')?.textContent || '').trim(),
      glyph: (row.querySelector('.sc-tool-term-status')?.textContent || '').trim(),
      streaming: (document.querySelector('.sc-send-cta')?.getAttribute('title') || '').includes('进行中'),
    });
  })()`;
  const finalState = await poll(client, 'row success + stream end', rowStateExpr,
    (s) => s.found && s.status !== 'running' && !s.streaming);
  assert('A2 折叠头命令预览含唯一标记', finalState.headCmd.includes(MARK), finalState.headCmd);
  assert('A3 终态 success + ✓ 状态字形', finalState.status === 'success' && finalState.glyph === '✓',
    `status=${finalState.status} glyph=${finalState.glyph}`);

  // ── 展开该行，断言 WIP DOM 契约 ──
  await evalJS(client, `(() => {
    const rows = [...document.querySelectorAll('.sc-tool-term')];
    const row = rows.filter((r) => (r.querySelector('.sc-tool-term-cmd-preview')?.textContent || '').includes('${MARK}')).pop();
    if (!row.querySelector('.sc-tool-term-body')) row.querySelector('.sc-tool-term-head').click();
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  const bodyState = JSON.parse(await evalJS(client, `(() => {
    const rows = [...document.querySelectorAll('.sc-tool-term')];
    const row = rows.filter((r) => (r.querySelector('.sc-tool-term-cmd-preview')?.textContent || '').includes('${MARK}')).pop();
    const q = (s) => row.querySelector(s);
    return JSON.stringify({
      body: !!q('.sc-tool-term-body'),
      cmdText: (q('.sc-tool-term-command-text')?.textContent || '').trim(),
      hasPromptGlyph: (q('.sc-tool-term-command .sc-tool-term-prompt')?.textContent || '').includes('$'),
      cmdCopyBtn: !!q('.sc-tool-term-command .sc-tool-term-copy'),
      outCopyBtn: !!q('.sc-tool-term-copy-out'),
      output: (q('.sc-tool-term-output')?.textContent || '').trim(),
    });
  })()`));
  assert('A4 展开体命令行含 $ 前缀 + 唯一标记（WIP 新增行）',
    bodyState.body && bodyState.hasPromptGlyph && bodyState.cmdText.includes(MARK),
    `cmd="${bodyState.cmdText.slice(0, 80)}"`);
  assert('A5 行内图标复制按钮（命令 + 输出）在位（WIP）',
    bodyState.cmdCopyBtn && bodyState.outCopyBtn,
    `cmd=${bodyState.cmdCopyBtn} out=${bodyState.outCopyBtn}`);
  assert('A6 输出含 628318（真实执行证据）', bodyState.output.includes(EXPECT_OUT),
    bodyState.output.slice(0, 120));
  await screenshot(client, 'ui315-terminal-live.png');
  log('screenshot ui315-terminal-live.png');

  // ── 历史恢复：reload 后 meta.toolActivities 持久化 ──
  await client.send('Page.reload');
  await new Promise((r) => setTimeout(r, 6000));
  const restoredExpr = `(() => {
    const rows = [...document.querySelectorAll('.sc-tool-term')];
    const row = rows.filter((r) => (r.querySelector('.sc-tool-term-cmd-preview')?.textContent || '').includes('${MARK}')).pop();
    if (!row) return JSON.stringify({ found: false });
    if (!row.querySelector('.sc-tool-term-body')) row.querySelector('.sc-tool-term-head').click();
    return JSON.stringify({ found: true, count: rows.length });
  })()`;
  const restored = await poll(client, 'restored row', restoredExpr,
    (s) => s.found, 60_000);
  await new Promise((r) => setTimeout(r, 400));
  const restoredBody = JSON.parse(await evalJS(client, `(() => {
    const rows = [...document.querySelectorAll('.sc-tool-term')];
    const row = rows.filter((r) => (r.querySelector('.sc-tool-term-cmd-preview')?.textContent || '').includes('${MARK}')).pop();
    return JSON.stringify({
      cmdText: (row.querySelector('.sc-tool-term-command-text')?.textContent || '').trim(),
      output: (row.querySelector('.sc-tool-term-output')?.textContent || '').trim(),
      outCopyBtn: !!row.querySelector('.sc-tool-term-copy-out'),
    });
  })()`));
  assert('A7 历史恢复：终端行 + 命令持久化', restored.found && restoredBody.cmdText.includes(MARK),
    `rows=${restored.count} cmd="${restoredBody.cmdText.slice(0, 80)}"`);
  assert('A8 历史恢复：输出与复制按钮仍可回看', restoredBody.output.includes(EXPECT_OUT) && restoredBody.outCopyBtn,
    restoredBody.output.slice(0, 120));
  await screenshot(client, 'ui315-history-restore.png');

  // ── 汇总 verdict（沿用 ui315-forced.json 既有形状 + WIP 增项）──
  const verdict = {
    terminalRendered: results.assertions.find((a) => a.name.startsWith('A1')).pass,
    commandShown: results.assertions.find((a) => a.name.startsWith('A2')).pass,
    statusGlyph: results.assertions.find((a) => a.name.startsWith('A3')).pass,
    inlineCopyButtons: results.assertions.find((a) => a.name.startsWith('A5')).pass,
    outputShown: results.assertions.find((a) => a.name.startsWith('A6')).pass,
    historyRestored: results.assertions.find((a) => a.name.startsWith('A7')).pass,
  };
  results.dom = { baselineCount: base.terms, cmd: finalState.headCmd, output: bodyState.output.slice(0, 200), status: finalState.status };
  results.verdict = verdict;
  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui315-forced.json'), JSON.stringify(results, null, 2) + '\n');
  log(`allPass=${results.allPass}`);
  client.socket.close();
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => { console.error('LIVE_ERR', e.message); process.exit(1); });
