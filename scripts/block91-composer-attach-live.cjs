#!/usr/bin/env node
'use strict';

/**
 * BLOCK-91 P3 — 聊天附件真实接入实机探针（dev 栈 + CDP:9222，ssh 项目真远端链路）。
 *
 * 合成 drop 到 composer（附件走 File 句柄直读，无需测试缝）→ 填写消息 → 发送 →
 * 断言 .chat-attachments/ 在远端工作区落盘 + 用户消息含 [附件: …] 引用行。
 *
 * Evidence: acceptance/block-91/block91-composer-attach-live.json
 */

const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

const REPO = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(REPO, 'acceptance', 'block-91');
const PROJECT_ID = process.argv[2] || 'p_mtw8183q_2txr'; // P4驻留（ssh/aliyun 真远端）

setTimeout(() => { lib.log('global watchdog: aborting stuck run'); process.exit(3); }, 150_000).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error && error.message;
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function connectPage() {
  const targets = await lib.pollTargets({ port: 9222, timeoutMs: 15_000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000/);
  if (candidates.length === 0) throw new Error('no renderer target');
  return lib.connectTarget(candidates[0]);
}

async function main() {
  const run = lib.createRun({ name: 'block91-composer-attach-live', evidenceDir: EVIDENCE_DIR });

  let client = await connectPage();

  // 确保在目标项目路由
  const current = await lib.evalJs(client, 'location.href');
  if (!current.includes(`/project/${PROJECT_ID}`)) {
    await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${PROJECT_ID}'`);
    client = await waitUntil(async () => {
      const next = await connectPage();
      if (!next) return null;
      const st = await lib.evalJs(next, 'document.readyState');
      return st === 'complete' ? next : null;
    }, 'project route load', 30_000);
  }

  // 合成 drop 到 composer：附件走 File 句柄直读（无需测试缝）
  const dropResult = await lib.evalJs(client, `
    (async () => {
      const composer = document.querySelector('.sc-composer');
      if (!composer) return { ok: false, reason: 'composer not found' };
      const file = new File(['BLOCK-91 attachment body\\nsecond line'], 'block91-attach-sample.txt', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      composer.dispatchEvent(ev);
      await new Promise((r) => setTimeout(r, 800));
      const chips = document.querySelectorAll('.sc-attachment').length;
      return { ok: chips > 0, chips };
    })()
  `);
  run.assert('composer: dropped file becomes attachment chip', dropResult.ok === true, `chips=${dropResult.chips}`);

  // 填写消息 + 发送
  const sent = await lib.evalJs(client, `
    (async () => {
      const textarea = document.querySelector('.sc-input');
      if (!textarea) return { ok: false, reason: 'textarea not found' };
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'BLOCK-91 附件接入验证：请复述附件文件的第一行内容');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const btn = document.querySelector('.sc-send-cta');
      if (!btn || btn.disabled) return { ok: false, reason: 'send button unavailable' };
      btn.click();
      await new Promise((r) => setTimeout(r, 500));
      return { ok: true };
    })()
  `);
  run.assert('send triggered with attachment', sent.ok === true, sent.reason || '');

  // 断言：.chat-attachments/ 落盘（远端真链路）+ 用户消息含引用行
  await waitUntil(async () => {
    const tree = await lib.evalJs(client, `
      fetch('http://localhost:3001/api/workspaces/${PROJECT_ID}/tree?prefix=.chat-attachments/')
        .then((r) => r.json())
        .then((d) => (d.ok ? d.entries.map((e) => e.name) : []))
    `);
    return Array.isArray(tree) && tree.length > 0 ? tree : null;
  }, '.chat-attachments on remote workspace', 30_000);
  run.assert('attachment stored under .chat-attachments/ (real remote chain)', true);

  const refInMessage = await waitUntil(async () => {
    const dom = await lib.evalJs(client, `
      (document.body.innerText || '').includes('[附件: .chat-attachments/')
    `);
    return dom ? true : null;
  }, 'reference line in sent message', 30_000);
  run.assert('sent message contains attachment reference line', refInMessage === true);

  const payload = await run.finish({
    projectId: PROJECT_ID,
    provenance: 'synthetic drop with real File handle; upload + reference composition through real send pipeline',
  });
  process.exitCode = payload.allPass ? 0 : 1;
}

main().catch((error) => {
  lib.log(error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error));
  process.exitCode = 1;
});
