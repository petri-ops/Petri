#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui475-vision-paste-live — UI-475 识图能力位实机腿（BLOCK-513 L3）。
 *
 * 台账（RW-02 d 档 P0 判定）：「补实机产物后再翻，人测腿保留」；原设实机腿=「能力位
 * true 路径放行验证」（阻断路径已由 attachments.test 单测锁定——本 flow 不改共享
 * ai-settings 以免触碰用户数据，阻断分支维持单测锁定如实登记）。
 *
 * 断言链（临时项目工作区 SimpleChat）：
 *   P0_temp_project_created        临时项目创建（结束清理）
 *   A1_backend_vision_true         后端 /ai/settings vision_configured=true（本 dev 栈形态，证据留痕）
 *   A2_paste_image_allowed         真实粘贴事件（PNG File 经 DataTransfer）→ 附件 chip 在场
 *   A3_no_blocked_notice           无 vision 阻断提示（sc-attachment-notice role=alert 阻断文案不在场）
 *   A4_remove_attachment           点移除钮 → 附件清空
 *   P9_cleanup_project_deleted     临时项目清理
 *
 * 前置：后端(:3001) + vite(:3000) + 9223 测试实例（离屏）。
 * 证据：acceptance/ui-475/ui475-vision-paste-live-darwin.json（run.cjs 落盘）。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'ui-475');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1200); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(800);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

module.exports = {
  id: 'ui475-vision-paste-live',
  description: 'UI-475 识图能力位实机腿：vision_configured=true 路径贴图放行（附件 chip+无阻断提示），阻断分支维持单测锁定（9223 离屏）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target: 9223 测试实例无 localhost:3000 页面');
    const target = await lib.selectPageTarget(pages, {
      probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
    });
    const client = await lib.connectTarget(target);
    await client.send('Page.enable', {}, { timeoutMs: 15000 }).catch(() => {});
    const originalUrl = await evalRetry(client, 'location.href');

    let projectId = null;
    try {
      // A1 后端能力位（本 dev 栈形态留痕）
      const settings = await rest('GET', '/ai/settings');
      const visionConfigured = settings.data && settings.data.settings
        ? settings.data.settings.vision_configured : undefined;
      assert('A1_backend_vision_true', visionConfigured === true, `vision_configured=${visionConfigured}`);

      const created = await rest('POST', '/data/projects', { name: 'UI475-验收-' + Date.now(), modality: 'general' });
      projectId = created.data && created.data.project && created.data.project.id;
      assert('P0_temp_project_created', Boolean(projectId), `id=${projectId || 'none'}`);

      await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
      await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after nav' });
      await pagePoll(client, `!!document.querySelector('.sc-input') ? 'composer' : ''`, { label: 'composer', timeoutMs: 30000 });
      await sleep(800);

      // A2 真实粘贴事件：PNG File 经 DataTransfer 进 onPaste 链
      await evalRetry(client, `(function(){
        var canvas = document.createElement('canvas');
        canvas.width = 8; canvas.height = 8;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0a7';
        ctx.fillRect(0, 0, 8, 8);
        var bin = atob(canvas.toDataURL('image/png').split(',')[1]);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        var file = new File([bytes], 'ui475-probe.png', { type: 'image/png' });
        var dt = new DataTransfer();
        dt.items.add(file);
        var target = document.querySelector('.sc-input');
        var evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        (target || document.querySelector('[class*="composer"]')).dispatchEvent(evt);
        return 'pasted';
      })()`);
      await pagePoll(client, `document.querySelectorAll('.sc-attachment').length >= 1 ? 'chip' : ''`, { label: 'attachment chip', timeoutMs: 15000 });
      assert('A2_paste_image_allowed', true, 'attachment chip rendered after paste');

      // A3 无阻断提示（阻断文案归 attachments.test 单测锁定分支）
      const notice = await evalRetry(client, `(function(){
        var n = document.querySelector('.sc-attachment-notice[role="alert"]');
        return n ? n.textContent.slice(0, 60) : '';
      })()`);
      assert('A3_no_blocked_notice', !notice, notice ? `unexpected notice: ${notice}` : 'no blocked notice');

      // A4 移除附件
      await evalRetry(client, `document.querySelector('.sc-attachment-remove').click(); 'removed'`);
      await pagePoll(client, `document.querySelectorAll('.sc-attachment').length === 0 ? 'cleared' : ''`, { label: 'attachment cleared', timeoutMs: 10000 });
      assert('A4_remove_attachment', true, 'attachment removed');
    } finally {
      if (projectId) {
        const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)).catch(() => null);
        assert('P9_cleanup_project_deleted', Boolean(d && d.ok), `status=${d && d.status}`);
      }
      try {
        await evalRetry(client, `location.href = ${JSON.stringify(originalUrl)}; 'restoring'`);
        await sleep(1500);
      } catch { /* 恢复失败不掩盖断言结果 */ }
    }
    return true;
  },
};
