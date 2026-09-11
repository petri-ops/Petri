#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui341-welcome-chat — UI-341 欢迎页内嵌 SimpleChat 实机验收。
 *
 * 断言链：
 *   A1 welcome_rendered            欢迎页渲染（?project= 预选临时项目）
 *   A2 chat_embedded               chatMount 挂载区内嵌 SimpleChat composer（.sc-input）
 *   A3 legacy_composer_absent      手搓输入框（textarea[aria-label=任务描述]）不存在
 *   A4 project_preselected         触发器显示预选项目名
 *   A5 first_question_navigates    首问发送 → onConversationChange → 自动导航进 /project/<id>
 *   A6 conversation_auto_created   会话由 SimpleChat 自建（REST 可见，归属该项目，置队首）
 *   A7 left_panel_shows_conv       左栏会话清单可见新会话
 *   A8 assistant_reply_via_sse     工作区经 SSE 挂载 run，真实模型回复到达
 *   A9 cleanup_restored            会话/临时项目清理 + 原页面恢复
 *
 * 前置：dev Electron（9222）+ 后端（3001）。驱动主窗标签页导航到欢迎页，
 * 结束后恢复原 URL。探针提示词要求模型零工具直答「收到」，控制成本。
 * 证据：acceptance/ui-341/ui341-welcome-chat-live.json + 双截图。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const MARKER = 'UI341 实机验收探针：请不要使用任何工具，直接回复「收到」两个字。';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, data };
}

async function poll(fn, { timeoutMs, intervalMs = 1000, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last && last.ok) return last.value;
    await sleep(intervalMs);
  }
  throw new Error('poll_timeout: ' + label + ' :: ' + JSON.stringify(last && last.value).slice(0, 200));
}

module.exports = {
  id: 'ui341-welcome-chat',
  description: 'UI-341 欢迎页内嵌 SimpleChat：首问建会话→导航工作区→SSE 续聊（临时项目+清理）',
  evidenceDir: path.join(ROOT, 'acceptance', 'ui-341'),

  async run({ assert }) {
    const evidenceDir = path.join(ROOT, 'acceptance', 'ui-341');
    fs.mkdirSync(evidenceDir, { recursive: true });

    // ── 就绪 + 选主窗 ──
    const targets = await lib.pollTargets({ timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target: dev Electron 主窗未找到（localhost:3000）');
    const probeFn = async (client) => {
      const v = await lib.evalJs(client, 'JSON.stringify({ w: !!document.querySelector(\'[aria-label="欢迎页"]\'), t: document.querySelectorAll(\'[class*="projectTree"]\').length, r: !!document.querySelector(\'[class*="rightCol"]\') })').catch(() => null);
      if (!v) return false;
      const o = JSON.parse(v);
      return o.w || (o.t > 0 && o.r);
    };
    const target = await lib.selectPageTarget(pages, { probe: probeFn });
    const client = await lib.connectTarget(target);
    const originalUrl = target.url;

    // ── 环境提示（非断言）──
    // 工作区布局响应式断点 960px（useWorkspaceLayout compact）：窗口低于断点时
    // 左栏收起。A7 已自适应（自动点「展开左侧栏」），此处仅提示，不影响 allPass。
    const widthNow = await lib.evalJs(client, 'window.innerWidth').catch(() => 0);
    if (widthNow < 1000) {
      lib.log(`note: innerWidth=${widthNow} < 断点 960，左栏将自动展开；如需常规宽度可跑 powershell -File scripts/resize-electron-window.ps1`);
    }

    // ── A0b SPA 状态重置 ──
    // leftOpen 一旦因 compact（<960px）被置 false 就不会自行恢复（useWorkspacePanels
    // useState(true) 非持久化，但没有 compact→wide 的重开逻辑），SPA 长活期间残留。
    // reload 重置面板状态（窗口已宽，重载后 leftOpen=true）。
    await lib.evalJs(client, "location.reload(); 'reloading'");
    for (let i = 0; i < 20; i++) {
      if (await lib.evalJs(client, "!!document.querySelector('[aria-label=\"欢迎页\"]')").catch(() => false)) break;
      await sleep(1000);
    }
    await sleep(800);

    let projectId = null;
    let conversationId = null;

    try {
      // ── 临时项目 ──
      const created = await rest('POST', '/data/projects', { name: 'UI341-验收-' + Date.now(), modality: 'general' });
      if (!created.ok || !created.data || !created.data.project) throw new Error('create_project_failed: ' + JSON.stringify(created.data).slice(0, 200));
      projectId = created.data.project.id;

      // ── 导航欢迎页（带预选参数，同 UI-338 加映二的传参契约）──
      await lib.evalJs(client, "location.href = '" + APP_ORIGIN + "/?project=" + projectId + "'; 'navigating'");
      await poll(async () => {
        const v = await lib.evalJs(client, '!!document.querySelector(\'[aria-label="欢迎页"]\')').catch(() => false);
        return { ok: v === true, value: v };
      }, { timeoutMs: 30_000, label: 'welcome_mount' });

      const probe = JSON.parse(await lib.evalJs(client, 'JSON.stringify({\n' +
        '  trigger: (document.querySelector(\'button[aria-label="选择项目"]\') || {}).textContent || "",\n' +
        '  mount: document.querySelectorAll(\'[class*="chatMount"]\').length,\n' +
        '  chatInput: document.querySelectorAll(\'[class*="chatMount"] textarea.sc-input\').length,\n' +
        '  chatInputVisible: (function(){ var t = document.querySelector(\'[class*="chatMount"] textarea.sc-input\'); return !!t && t.offsetParent !== null; })(),\n' +
        '  emptyStateHidden: (function(){ var e = document.querySelector(\'[class*="chatMount"] .sc-empty\'); return !e || e.offsetParent === null; })(),\n' +
        '  legacy: document.querySelectorAll(\'textarea[aria-label="任务描述"]\').length\n' +
        '})'));
      assert('A1_welcome_rendered', true, 'url=' + (await lib.evalJs(client, 'location.href')));
      // UI-341 加映后 composer-only：DOM 在场且必须**可见**（display:none 的
      // 元素 querySelector 照样命中——断言必须查 offsetParent），空态/建议卡隐藏
      assert('A2_chat_embedded', probe.mount > 0 && probe.chatInput > 0 && probe.chatInputVisible && probe.emptyStateHidden,
        'chatMount=' + probe.mount + ' scInput=' + probe.chatInput + ' visible=' + probe.chatInputVisible + ' emptyHidden=' + probe.emptyStateHidden);
      assert('A3_legacy_composer_absent', probe.legacy === 0, 'legacy 任务描述 textarea count=' + probe.legacy);
      assert('A4_project_preselected', probe.trigger.indexOf('UI341-验收') >= 0, 'trigger=' + probe.trigger.slice(0, 60));

      await lib.screenshotPng(client, evidenceDir, 'ui341-welcome.png');

      // ── 首问直发（React 受控 textarea：原生 setter + input 事件 → 点发送）──
      const typed = await lib.evalJs(client,
        "(function(){\n" +
        "  var ta = document.querySelector('[class*=\"chatMount\"] textarea.sc-input');\n" +
        "  if (!ta) return 'no_textarea';\n" +
        "  var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;\n" +
        "  setter.call(ta, " + JSON.stringify(MARKER) + ");\n" +
        "  ta.dispatchEvent(new Event('input', { bubbles: true }));\n" +
        "  return 'typed:' + ta.value.length;\n" +
        "})()");
      if (typed !== 'typed:' + MARKER.length) throw new Error('type_into_composer_failed: ' + typed);

      const clicked = await lib.evalJs(client,
        "(function(){\n" +
        "  var btns = document.querySelectorAll('[class*=\"chatMount\"] button');\n" +
        "  for (var i = 0; i < btns.length; i++) {\n" +
        "    if ((btns[i].getAttribute('title') || '').indexOf('发送消息') >= 0) { btns[i].click(); return 'clicked'; }\n" +
        "  }\n" +
        "  return 'send_button_not_found';\n" +
        "})()");
      if (clicked !== 'clicked') throw new Error('click_send_failed: ' + clicked);

      // ── A5 自动导航进工作区 ──
      await poll(async () => {
        const href = await lib.evalJs(client, 'location.href').catch(() => '');
        return { ok: href.indexOf('/project/' + projectId) >= 0, value: href };
      }, { timeoutMs: 25_000, label: 'navigate_after_first_question' });
      assert('A5_first_question_navigates', true, 'url=' + APP_ORIGIN + '/project/' + projectId);

      // ── A6 会话由 SimpleChat 自建（REST 对账）──
      const conv = await poll(async () => {
        const r = await rest('GET', '/ai/conversations?status=active&project_id=' + encodeURIComponent(projectId));
        const list = (r.data && r.data.conversations) || [];
        return { ok: list.length > 0, value: list[0] || null };
      }, { timeoutMs: 20_000, label: 'conversation_created' });
      conversationId = conv.id;
      assert('A6_conversation_auto_created', true, 'convId=' + conv.id + ' title=' + conv.title + ' project=' + conv.project_id);

      // ── A7 左栏可见 ──
      // 窄窗口（<960 断点）或 compact 残留会让左栏收起（LeftPanel 不渲染）。
      // 此时先点 TitleBar 的「展开左侧栏」再断言——验收的是产品真实路径。
      const treeAbsent = await lib.evalJs(client,
        "document.querySelector('[class*=\"projectTree\"]') ? 'present' : 'absent'").catch(() => 'eval_err');
      if (treeAbsent === 'absent') {
        await lib.evalJs(client, `(function(){
          var b = [...document.querySelectorAll('button')].find(function(x){
            return (x.getAttribute('aria-label')||'') === '展开左侧栏';
          });
          if (b) b.click();
          return b ? 'expanded' : 'toggle_not_found';
        })()`).catch(() => {});
        await sleep(1200);
      }
      const leftOk = await poll(async () => {
        const v = await lib.evalJs(client,
          "(function(){ var el = document.querySelector('[class*=\"projectTree\"]'); return el ? el.textContent : ''; })()").catch(() => '');
        return { ok: v.indexOf(conv.title) >= 0 || v.indexOf('新对话') >= 0, value: v.slice(0, 120) };
      }, { timeoutMs: 15_000, label: 'left_panel_conversation' });
      assert('A7_left_panel_shows_conv', true, 'leftPanel contains conversation title (was ' + treeAbsent + ')');

      // ── A8 工作区 SSE 续聊：真实模型回复到达 ──
      const reply = await poll(async () => {
        const r = await rest('GET', '/ai/conversations/' + encodeURIComponent(conversationId) + '/messages?limit=50');
        const msgs = (r.data && r.data.messages) || [];
        const assistant = msgs.filter(function (m) { return m.role === 'assistant'; });
        const hit = assistant.find(function (m) { return (m.content || '').indexOf('收到') >= 0; });
        return { ok: !!hit, value: assistant.length ? String(assistant[assistant.length - 1].content).slice(0, 120) : '(no assistant yet)' };
      }, { timeoutMs: 120_000, intervalMs: 3000, label: 'assistant_reply' });
      assert('A8_assistant_reply_via_sse', true, 'assistant=' + String(reply).slice(0, 80));

      // ── A8b 视觉续聊：工作区聊天区 DOM 必须渲染出首问与回复（不只是 REST 在）──
      // 首问标记不会出现在 composer 输入框（innerText 不含 textarea value），
      // 只会作为消息气泡出现在对话流里；空态文案「开始新的对话」=未挂载会话。
      try {
        await poll(async () => {
          const v = await lib.evalJs(client, 'document.body.innerText').catch(() => '');
          return { ok: v.indexOf('UI341 实机验收探针') >= 0 && v.indexOf('收到') >= 0, value: 'hasMarker=' + (v.indexOf('UI341 实机验收探针') >= 0) + ' hasReply=' + (v.indexOf('收到') >= 0) };
        }, { timeoutMs: 20_000, intervalMs: 2000, label: 'workspace_chat_dom' });
        assert('A8b_workspace_chat_shows_transcript', true, '首问与回复均渲染于工作区聊天区');
      } catch (e) {
        assert('A8b_workspace_chat_shows_transcript', false, '工作区聊天区未渲染会话内容（20s）：' + String(e.message).slice(0, 160));
      }

      // ── A8c composer 残留：发送成功后工作区 composer 不得回填已发送文本 ──
      // （空会话发送路径的 migrateConversationDraft 曾把待发文本迁到新会话键且
      // 启动成功后未清，工作区挂载读草稿即回填——看起来像没发出去，易误重发。）
      const residue = await lib.evalJs(client,
        "(function(){ var ta = document.querySelector('main textarea.sc-input, [class*=\"centerCol\"] textarea.sc-input, textarea.sc-input'); return ta ? ta.value : '(no textarea)'; })()");
      assert('A8c_composer_cleared_after_send', residue === '' , 'composer value=' + JSON.stringify(String(residue).slice(0, 80)));

      await sleep(1500);
      await lib.screenshotPng(client, evidenceDir, 'ui341-workspace.png');
    } finally {
      // ── 清理（会话→项目→原页面），清理失败如实判失败 ──
      let cleanup = [];
      if (conversationId) {
        const d = await rest('DELETE', '/ai/conversations/' + encodeURIComponent(conversationId));
        cleanup.push('conv=' + d.ok);
      }
      if (projectId) {
        const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId));
        cleanup.push('project=' + d.ok);
      }
      try {
        await lib.evalJs(client, "location.href = " + JSON.stringify(originalUrl) + "; 'restoring'");
        await sleep(2500);
        cleanup.push('restored=' + ((await lib.evalJs(client, 'location.href').catch(() => '')) === originalUrl));
      } catch { cleanup.push('restored=eval_failed'); }
      assert('A9_cleanup_restored', cleanup.every(function (s) { return s.indexOf('true') >= 0 || s.indexOf('=true') >= 0; }), cleanup.join(' '));
    }
    return true;
  },
};
