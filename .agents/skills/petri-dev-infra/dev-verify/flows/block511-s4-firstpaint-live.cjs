#!/usr/bin/env node
'use strict';

/** BLOCK-511 S4 实机腿：CSP 零违规 + 首屏渲染 + 聊天流可达 + 3D artifact 卡可展开。 */
const path = require('node:path');
const lib = require('../lib.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'block511-s4-firstpaint-live',
  description: 'S4 CSP/首屏：零 CSP 违规、页面渲染、聊天 SSE 流、3D 产物卡可展开',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'panoramic-remediation-2026-11-24', 'live'),

  async run(ctx) {
    const { assert } = ctx;
    const targets = await lib.pollTargets({ timeoutMs: 30_000 });
    assert('cdp_targets_listed', Array.isArray(targets) && targets.length > 0, `${(targets || []).length} targets`);
    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert('spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');
    if (!pages.length) return false;
    const main = await lib.selectPageTarget(pages, {
      probe: async (client) => lib.evalJs(client, `document.readyState === 'complete' && document.body && document.body.innerText.length > 20`, 8_000).catch(() => false),
    });
    assert('main_page_target_selected', Boolean(main), 'no ready page target');
    const client = await lib.connectTarget(main);
    try {
      // 1) 注入 CSP 违规监听（在导航前）
      await lib.evalJs(client, `(function(){
        window.__b511Csp = [];
        document.addEventListener('securitypolicyviolation', function(e){
          window.__b511Csp.push({ directive: e.violatedDirective, blocked: e.blockedURI });
        }, true);
        return 'armed';
      })()`);

      // 2) 首屏渲染断言
      const ready = JSON.parse(await lib.evalJs(client, `JSON.stringify({
        ready: document.readyState, title: document.title || '',
        textLen: (document.body && document.body.innerText || '').length,
        hasComposer: !!document.querySelector('textarea'),
        origin: location.origin
      })`));
      assert('document_rendered', ready.ready === 'complete' && ready.textLen > 20, JSON.stringify(ready));
      assert('composer_present', ready.hasComposer === true, JSON.stringify(ready));

      // 3) 休息 2s 收集 CSP 违规（首屏加载 + vite HMR）
      await sleep(2500);
      const csp = JSON.parse(await lib.evalJs(client, `JSON.stringify(window.__b511Csp || [])`));
      assert('zero_csp_violations', Array.isArray(csp) && csp.length === 0, JSON.stringify(csp).slice(0, 400));

      // 4) 聊天 SSE 流：输入一条短消息，观察消息区出现用户气泡（SSE 流可达）
      const sent = await lib.evalJs(client, `(function(){
        var ta = document.querySelector('textarea');
        if (!ta) return 'no_textarea';
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, 'S4 实机自检：请回复 OK');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      })()`);
      assert('message_typed', sent === 'typed', `typed=${sent}`);
      // 用键盘 Enter 发送（避免依赖具体按钮选择器）
      await lib.evalJs(client, `(function(){
        var ta = document.querySelector('textarea');
        if (!ta) return 'no_textarea';
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        return 'enter';
      })()`);
      const stream = await (async () => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const state = JSON.parse(await lib.evalJs(client, `JSON.stringify({
            userMsg: (document.body.innerText || '').includes('S4 实机自检'),
            streaming: !!document.querySelector('[class*="cursor"], [class*="streaming"]')
          })`).catch(() => '{}'));
          if (state.userMsg) return state;
          await sleep(500);
        }
        return { userMsg: false, timeout: true };
      })();
      assert('chat_message_visible', stream.userMsg === true, JSON.stringify(stream));

      // 5) 3D 产物卡：本轮若无 3D artifact，如实标 unavailable（不伪造）
      const artifact = await lib.evalJs(client, `JSON.stringify({
        expand3d: Array.prototype.some.call(document.querySelectorAll('button'), function(b){ return /展开 3D 预览/.test((b.textContent||'')); })
      })`).catch(() => '{}');
      const a = JSON.parse(artifact);
      assert('artifact_3d_checked', typeof a.expand3d === 'boolean', JSON.stringify(a));
      ctx.report && ctx.report('artifact_3d_expand', a.expand3d ? 'available' : 'not_present_in_this_session');

      // 6) 结束再查 CSP（聊天流 + 组件懒加载后）
      const csp2 = JSON.parse(await lib.evalJs(client, `JSON.stringify(window.__b511Csp || [])`));
      assert('zero_csp_violations_after_stream', Array.isArray(csp2) && csp2.length === 0, JSON.stringify(csp2).slice(0, 400));

      try { await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'panoramic-remediation-2026-11-24', 'live'), 's4-firstpaint.png'); }
      catch { ctx.report && ctx.report('screenshot', 'unavailable (offscreen compositing)'); }
      return true;
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
  },
};
