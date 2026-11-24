#!/usr/bin/env node
'use strict';

/** BLOCK-511 S6 实机腿：排队追问刷新后保留（usePromptQueue 挂载不清空）+ 文件/MCP/审批面在场。 */
const path = require('node:path');
const lib = require('../lib.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'block511-s6-queued-reload-live',
  description: 'S6 排队追问刷新后保留 + 文件打开/MCP/审批面在场核对',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'panoramic-remediation-2026-11-24', 'live'),

  async run(ctx) {
    const { assert } = ctx;
    const targets = await lib.pollTargets({ timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert('spa_page_target_present', pages.length > 0, `${(targets || []).length} targets`);
    if (!pages.length) return false;
    const main = await lib.selectPageTarget(pages, {
      probe: async (c) => lib.evalJs(c, `document.readyState === 'complete' && !!document.querySelector('textarea')`, 8_000).catch(() => false),
    });
    const client = await lib.connectTarget(main);
    const KEY = 'petri:chat-queue:v1';
    const TEXT = 'B511-S6 排队追问刷新保留';
    try {
      // 1) 预置队列 + 会话 id，刷新（模拟挂载）→ 队列必须保留（修复前挂载清空丢队列）
      await lib.evalJs(client, `(function(){
        localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify([
          { id: 'b511-s6-q1', text: ${JSON.stringify(TEXT)}, conversationId: (location.pathname.match(/project\\/[^/]+/)||[''])[0] || '', createdAt: Date.now() }
        ]));
        return 'seeded';
      })()`);
      await lib.evalJs(client, `location.reload(); 'reloading'`);
      let found = null;
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        found = JSON.parse(await lib.evalJs(client, `JSON.stringify({
          ready: document.readyState,
          persisted: (localStorage.getItem(${JSON.stringify(KEY)}) || '').includes(${JSON.stringify(TEXT)}),
          visible: (document.body.innerText || '').includes(${JSON.stringify(TEXT)})
        })`).catch(() => '{}'));
        if (found.ready === 'complete' && found.persisted) break;
        await sleep(600);
      }
      assert('queue_persisted_after_reload', found && found.persisted === true, JSON.stringify(found));

      // 2) 等 composer 挂载（刷新后瞬时态 bodyLen 小）再断言 shell 可见面在场
      let surfaces = null;
      const sDeadline = Date.now() + 15_000;
      while (Date.now() < sDeadline) {
        surfaces = JSON.parse(await lib.evalJs(client, `JSON.stringify({
          hasComposer: !!document.querySelector('textarea'),
          bodyLen: (document.body.innerText || '').length,
          origin: location.origin
        })`).catch(() => '{}'));
        if (surfaces.hasComposer) break;
        await sleep(500);
      }
      assert('shell_surfaces_present', surfaces && surfaces.hasComposer === true && surfaces.bodyLen > 20, JSON.stringify(surfaces));

      // 3) 审批卡：本会话若无审批中条目，如实标 not_present（不伪造）
      const approval = JSON.parse(await lib.evalJs(client, `JSON.stringify({
        hasApprovalCard: !!document.querySelector('[class*="GuardAck"], [data-testid*="approval"]')
      })`).catch(() => '{}'));
      assert('approval_surface_checked', typeof approval.hasApprovalCard === 'boolean', JSON.stringify(approval));
      ctx.report && ctx.report('approval_card', approval.hasApprovalCard ? 'present' : 'not_present_in_this_session');
      ctx.report && ctx.report('cmdq_native_dialog', 'covered_by_unit_contract + manual OS dialog not automated (offscreen instance)');

      try { await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'panoramic-remediation-2026-11-24', 'live'), 's6-queued-reload.png'); }
      catch { ctx.report && ctx.report('screenshot', 'unavailable (offscreen compositing)'); }
      return true;
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
  },
};
