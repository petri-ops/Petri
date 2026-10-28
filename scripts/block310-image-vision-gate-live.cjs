#!/usr/bin/env node
'use strict';
/**
 * scripts/block310-image-vision-gate-live.cjs — BLOCK-310 / UI-614 实机腿。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例；userPrefs.autoModel=true。
 * 用法：node scripts/block310-image-vision-gate-live.cjs
 * 证据：acceptance/block-308/live-image-vision-gate.json。
 *
 * 复现用户场景：**探测期间**把 chat/agent 角色绑定临时切到一个「非视觉」聊天
 * 模型（auto 仍开），拖入图片断言入口不弹「识图模型未配置」且附件入列；有图时
 * 的自动决议仍能找到 vision 能力的 DeepSeek（当前配置唯一 vision 聊天模型）。
 * 无论断言成败，finally 恢复原绑定并重载测试页；结束后再读后端校验恢复。
 *
 * 注意：AI 设置存于共享 dev 数据，切换窗口 ~1 分钟；探针只在测试实例上操作 UI，
 * 不改用户主窗缓存。红→绿取证时改动的是前端门禁代码，不是共享设置。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-308');
const RAW_TIMEOUT = 15000;

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

async function getSettings() {
  const r = await rest('GET', '/ai/settings');
  return (r.data && (r.data.settings || r.data)) || {};
}

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1200); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 25000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(500);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 260) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 200)}`);
    return ok === true || ok === 'true';
  };

  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  const client = await lib.connectTarget(target);
  await client.send('Page.enable', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});

  // 用户偏好 autoModel（既成事实；只读，不改写 prefs）
  const prefs = await rest('GET', '/user/prefs').catch(() => null);
  const autoOn = Boolean(prefs && prefs.data && prefs.data.prefs && prefs.data.prefs.autoModel === true);
  assert('P0_auto_model_on', autoOn, `autoModel=${autoOn}（用户偏好；探针不改写）`);

  const original = await getSettings();
  const profiles = Array.isArray(original.model_profiles) ? original.model_profiles : [];
  const nonVision = profiles.find((p) => Array.isArray(p.capabilities)
    && p.capabilities.includes('chat') && !p.capabilities.includes('vision'));
  const visionProfile = profiles.find((p) => Array.isArray(p.capabilities) && p.capabilities.includes('vision'));
  const originalBindings = original.model_role_bindings || {};
  const originalActive = original.active_chat_model_id;
  assert('P1_switch_target_available',
    Boolean(nonVision && nonVision.id && visionProfile),
    `nonVision=${nonVision && nonVision.id} vision=${visionProfile && visionProfile.id}`);

  let projectId = null;
  let switched = false;
  try {
    // 临时切 chat/agent 到非视觉模型（vision 角色保持原样）
    if (nonVision) {
      const saved = await rest('POST', '/ai/settings', {
        model_role_bindings: { ...originalBindings, chat: nonVision.id, agent: nonVision.id },
        active_chat_model_id: nonVision.id,
      });
      switched = Boolean(saved.ok);
    }
    assert('P2_settings_switched', switched,
      `chat/agent=${nonVision && nonVision.id}（探测期临时；finally 恢复）`);

    const created = await rest('POST', '/data/projects', { name: 'BLOCK310-验收-' + Date.now(), modality: 'general' });
    projectId = created.data && created.data.project && created.data.project.id;
    assert('P3_project_created', Boolean(projectId), `id=${projectId || 'none'}`);
    await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
    await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after nav' });
    await evalRetry(client, `(function(){
      var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
      if (btn) { btn.click(); return 'dismissed'; }
      return 'no_banner';
    })()`);
    await pagePoll(client, `!!document.querySelector('[data-testid="model-chip-model"]')`, { label: 'model chip' });
    await sleep(900);

    const readState = () => evalRetry(client, `(function(){
      var menu = document.querySelector('[data-testid="model-menu"]');
      var auto = menu ? menu.querySelector('[data-testid="model-menu-auto"]') : null;
      var autoMeta = auto ? auto.querySelector('.sc-model-option-meta') : null;
      var notice = document.querySelector('.sc-attachment-notice[role="alert"]');
      var attachments = [...document.querySelectorAll('.sc-attachments .sc-attachment')].map(function(el){
        var n = el.querySelector('.sc-attachment-name'); return n ? n.textContent.trim() : '';
      });
      return JSON.stringify({
        autoMeta: autoMeta ? autoMeta.textContent.trim() : null,
        notice: notice ? notice.textContent.trim() : null,
        attachments: attachments,
      });
    })()`);

    // 无图时自动决议=临时绑定的非视觉 agent 模型
    await evalRetry(client, `(function(){ document.querySelector('[data-testid="model-chip-model"]').click(); return 'open'; })()`);
    await pagePoll(client, `!!document.querySelector('[data-testid="model-menu"]')`, { label: 'model menu' });
    await sleep(300);
    const before = JSON.parse(await readState());
    assert('A0_nonvision_auto_decision',
      Boolean(before.autoMeta) && Boolean(nonVision && nonVision.model)
        && before.autoMeta.includes(nonVision.model)
        && !before.autoMeta.includes('视觉能力'),
      `autoMeta=${before.autoMeta} 期望含=${nonVision && nonVision.model}`);
    await evalRetry(client, `(function(){
      var overlay = document.querySelector('.sc-model-overlay');
      if (overlay) overlay.click();
      return 'closed';
    })()`);
    await sleep(300);

    // 构造 8x8 PNG，派发与文件树拖入同一条 composer onDrop 链
    await evalRetry(client, `(async function(){
      var canvas = document.createElement('canvas');
      canvas.width = 8; canvas.height = 8;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#4f46e5'; ctx.fillRect(0, 0, 8, 8);
      var blob = await new Promise(function(resolve){ canvas.toBlob(resolve, 'image/png'); });
      var file = new File([blob], 'vision-gate-test.png', { type: 'image/png' });
      var dt = new DataTransfer();
      dt.items.add(file);
      var el = document.querySelector('.sc-composer');
      ['dragenter', 'dragover', 'drop'].forEach(function(type){
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      });
      return 'dropped';
    })()`);
    // 等附件入列或提示出现
    for (let i = 0; i < 16; i += 1) {
      await sleep(500);
      const s = JSON.parse(await readState());
      if (s.attachments.length > 0 || s.notice) break;
    }
    const afterDrop = JSON.parse(await readState());
    assert('B0_no_vision_notice',
      !afterDrop.notice || !afterDrop.notice.includes('识图模型未配置'),
      `notice=${afterDrop.notice || '(none)'}`);
    assert('B1_attachment_accepted',
      afterDrop.attachments.length >= 1,
      `attachments=${JSON.stringify(afterDrop.attachments)} notice=${afterDrop.notice || '(none)'}`);
  } finally {
    // 无条件恢复共享设置 + 重载测试页（用户主窗缓存不受影响；下次导航回真实设置）
    if (switched) {
      await rest('POST', '/ai/settings', {
        model_role_bindings: originalBindings,
        active_chat_model_id: originalActive,
      }).catch(() => null);
    }
    await evalRetry(client, `location.reload(); 'reload'`).catch(() => null);
  }

  const restored = await getSettings();
  const restoredBindings = restored.model_role_bindings || {};
  const bindingsEqual = JSON.stringify(restoredBindings) === JSON.stringify(originalBindings);
  const activeEqual = restored.active_chat_model_id === originalActive;
  assert('C0_settings_restored', bindingsEqual && activeEqual,
    `bindingsEqual=${bindingsEqual} activeEqual=${activeEqual} active=${restored.active_chat_model_id}`);

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    surface: 'composer 图片拖入（BLOCK-310/UI-614：自动模式有图决议=DeepSeek 视觉能力）',
    switch: { target: nonVision && nonVision.id, model: nonVision && nonVision.model, restored: bindingsEqual && activeEqual },
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'live-image-vision-gate.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-310 live probe: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block310-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
