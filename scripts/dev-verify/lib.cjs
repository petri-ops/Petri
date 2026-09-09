#!/usr/bin/env node
'use strict';

/**
 * scripts/dev-verify/lib.cjs — 实机校验公共原语（BLOCK-71）
 *
 * 从 block*-live.cjs 系列反复出现的样板中沉淀的四个原语：
 *   ready   pollTargets()        轮询 CDP /json 直到 dev Electron 就绪
 *   target  selectPageTarget()   按.URL 正则 + 主窗探测选中目标页
 *                                （BLOCK-68 教训：多窗口并存时壳窗口也可见，
 *                                 必须按项目树+右栏判真主窗，visibilityState 不可靠）
 *   assert  createRun()          断言记录 + PASS/FAIL 日志 + 证据 JSON 落盘
 *   capture evalJs()/screenshotPng()  带超时/异常透传的页面求值与截图
 *
 * 环境纪律（AUDIT-LOG 2026-09-09）：dev 栈以 fnm Node 24 启动且带
 * BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"；本库默认连 9222，
 * 可用 BIOF3_DEBUG_PORT 覆盖。本库只连接既有 dev 栈，不负责启动/重启 Electron
 * （后端代码变更后必须重启 dev Electron——这一步留在人/Agent 手里）。
 *
 * CDP 客户端单源复用 scripts/g0-rs-p7-cdp.cjs 的 CdpClient，不建第二套连接层。
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { CdpClient } = require('../g0-rs-p7-cdp.cjs');

const DEFAULT_PORT = process.env.BIOF3_DEBUG_PORT || '9222';

function log(msg) {
  try { fs.writeSync(1, `[dev-verify] ${msg}\n`); } catch { /* stdout closed */ }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

/** ready 原语：轮询 CDP 端点直到可列出 targets；超时抛错（信息里带启动提示）。 */
async function pollTargets({ port = DEFAULT_PORT, timeoutMs = 30_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
      if (Array.isArray(targets)) return targets;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `cdp_not_ready_on_port_${port}${lastErr ? `: ${lastErr.message}` : ''}` +
    ` — 先启动 dev 栈：BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=${port}" npm run dev`,
  );
}

/** 连接一个 CDP target，返回已连接的 CdpClient。 */
async function connectTarget(target) {
  return new CdpClient(target.webSocketDebuggerUrl).connect();
}

/** target 纯预筛：URL 命中 pattern 的 page 目标（不含探测，供测试与预筛用）。 */
function filterPageTargets(targets, urlPattern) {
  return (targets || []).filter((t) => t.type === 'page' && (!urlPattern || urlPattern.test(t.url)));
}

/**
 * target 原语：在候选页里选「真主窗」。
 * probe(client, target) 应返回 truthy 判定（如 projectTree+rightCol 探测）。
 * 依次探测，首个 truthy 即选中；全部不中则回退 fallbackSelector 或第一个候选
 * （保持 block68 行为，但探测优先）。connect 可注入以便纯逻辑单测。
 */
async function selectPageTarget(candidates, { probe, fallbackSelector, connect = connectTarget } = {}) {
  let fallback = null;
  for (const p of candidates) {
    if (!probe) return p;
    let client;
    try {
      client = await connect(p);
      const ok = await probe(client, p);
      if (ok) return p;
      if (!fallback && fallbackSelector) {
        const fb = await fallbackSelector(client, p);
        if (fb) fallback = p;
      }
    } catch { /* 探测失败的目标跳过 */ } finally {
      try { client?.socket?.close(); } catch { /* already closed */ }
    }
  }
  return fallback || candidates[0] || null;
}

/** capture 原语：带超时与异常透传的 Runtime.evaluate，返回 result.value。 */
async function evalJs(client, expr, timeoutMs = 30_000) {
  const r = await Promise.race([
    client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`eval_timeout_${timeoutMs}ms`)), timeoutMs)),
  ]);
  if (r.exceptionDetails) {
    throw new Error('eval_exception: ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300));
  }
  return r.result?.value;
}

/** capture 原语：整页 PNG 截图写入证据目录。 */
async function screenshotPng(client, evidenceDir, filename) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(evidenceDir, filename);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

/**
 * assert 原语：一次校验运行的断言记录器。
 * finish() 落盘 <slug>-live.json 并返回 allPass；证据契约与 block*-live 系列同构
 * （{startedAt, finishedAt, assertions:[{name,pass,detail}], allPass}）。
 */
function createRun({ name, evidenceDir }) {
  const slug = String(name || 'run').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
  const startedAt = new Date().toISOString();
  const assertions = [];
  return {
    get allPass() { return assertions.length > 0 && assertions.every((a) => a.pass); },
    assertions,
    assert(assertName, pass, detail = '') {
      assertions.push({ name: assertName, pass: !!pass, detail: String(detail).slice(0, 400) });
      log(`${pass ? 'PASS' : 'FAIL'} ${assertName}${detail ? ` :: ${String(detail).slice(0, 140)}` : ''}`);
    },
    async finish(extra = {}) {
      const payload = { name, startedAt, finishedAt: new Date().toISOString(), assertions, allPass: this.allPass, ...extra };
      if (evidenceDir) {
        fs.mkdirSync(evidenceDir, { recursive: true });
        const file = path.join(evidenceDir, `${slug}-live.json`);
        fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
        log(`evidence: ${file}`);
      }
      log(`run "${name}": ${assertions.filter((a) => a.pass).length}/${assertions.length} assertions, allPass=${payload.allPass}`);
      return payload;
    },
  };
}

module.exports = {
  DEFAULT_PORT,
  log,
  fetchJson,
  pollTargets,
  connectTarget,
  filterPageTargets,
  selectPageTarget,
  evalJs,
  screenshotPng,
  createRun,
};
