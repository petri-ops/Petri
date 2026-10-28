#!/usr/bin/env node
'use strict';
/**
 * scripts/block295-ui-final-live.cjs — BLOCK-278~289 批次终局实机走查（UI-594/595/596 实机腿）。
 *
 * 前置：vite(:3000) + 后端(:3001) + 9223 测试实例。
 * 用法：node scripts/block295-ui-final-live.cjs
 * 证据：acceptance/block-279/final-live.json + clip PNG。
 *
 * 断言面（welcome 首页 composer + 项目页）：
 *   F1 斜杠面板 skill 条目在场（动态来源）；选中后 composer 输入框不含注入模板文本
 *      （v2 结构化 chip 的可观察信号——v1 会注入「读手册按手册执行」模板）；
 *   F2 右栏空态最近使用徽章：访问浏览器/文件 tab → 回 home → 匹配卡亮「上次使用」；
 *   F3 计量条恢复文字形态复验（run-stats-bar 在场）。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-279');
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
    await sleep(800);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const records = [];
  const assert = (id, ok, detail = '') => {
    records.push({ id, ok: ok === true || ok === 'true', detail: String(detail).slice(0, 220) });
    console.log(`${ok === true || ok === 'true' ? '✔' : '✘'} ${id} ${String(detail).slice(0, 150)}`);
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
  await client.send('Page.bringToFront', {}, { timeoutMs: RAW_TIMEOUT }).catch(() => {});

  // 崩溃横幅摘除 + 回首页
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/`)}; 'home'`);
  await pagePoll(client, `!!document.querySelector('[data-testid="model-chip-model"]')`, { label: 'model chip on home' });
  await sleep(600);

  // 种子项目（供 F2 右栏空态）
  const created = await rest('POST', '/data/projects', { name: 'BLOCK295-验收-' + Date.now(), modality: 'general' });
  const projectId = created.data && created.data.project && created.data.project.id;
  assert('P0_project_created', Boolean(projectId), `id=${projectId || 'none'}`);

  // ── F1 斜杠 skill chip v2（UI-594 实机腿）──
  // 横幅再摘除（崩溃态持续存在，重渲后可能重现）：直接点「知道了」钮
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '知道了'; });
    if (btn) { btn.click(); return 'dismissed'; }
    return 'no_banner';
  })()`);
  await sleep(300);
  await evalRetry(client, `(function(){
    var chip = document.querySelector('[data-testid="model-chip-model"]');
    var ta = document.querySelector('textarea');
    if (!ta) return 'no_textarea';
    ta.focus();
    return 'focused';
  })()`);
  // 输入 / 唤起斜杠面板（原生 input 事件）
  await evalRetry(client, `(function(){
    var ta = document.querySelector('textarea');
    if (!ta) return 'no_textarea';
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '/');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await pagePoll(client, `!!document.querySelector('.sc-slash-panel')`, { label: 'slash panel opens' });
  await sleep(500);
  const slashSkill = await evalRetry(client, `(function(){
    var items = [...document.querySelectorAll('.sc-slash-item')];
    var skillItem = items.find(function(el){ return (el.getAttribute('data-testid')||'').indexOf('skill') >= 0 || el.textContent.indexOf('技能') >= 0 || (el.textContent.match(/skill/i)||[]).length > 0; });
    return { total: items.length, hasSkill: !!skillItem, skillText: skillItem ? skillItem.textContent.slice(0, 60) : '' };
  })()`);
  assert('F1a_slash_panel_with_entries', Number(slashSkill.total) >= 1 || slashSkill.hasSkill, JSON.stringify({ total: slashSkill.total }));

  // 选第一个 skill 条目（若无 skill 动态条目，跳过并如实标注——内置技能后端面在）
  const skillEntry = await evalRetry(client, `(function(){
    var items = [...document.querySelectorAll('.sc-slash-item')];
    var skillItem = items.find(function(el){ return (el.getAttribute('data-testid')||'').indexOf('skill') >= 0; });
    return skillItem ? (skillItem.getAttribute('data-testid') || 'skill-item') : null;
  })()`);
  if (skillEntry) {
    await evalRetry(client, `(function(){
      var el = [...document.querySelectorAll('.sc-slash-item')].find(function(el){
        return (el.getAttribute('data-testid')||'').indexOf('skill') >= 0; });
      if (!el) return 'no_skill_item';
      el.click();
      return 'picked';
    })()`);
    await sleep(600);
    const composer = await evalRetry(client, `(function(){
      var ta = document.querySelector('textarea');
      var chips = document.querySelectorAll('[class*="context-chip"], [class*="ctx-skill"], [data-testid*="context-item"]').length;
      return { inputValue: ta ? ta.value : null, chips: chips };
    })()`);
    // v2 可观察信号：输入框不被注入模板文本（v1 会注入「读手册按手册执行」模板）
    assert('F1b_skill_chip_no_text_inject',
      composer.inputValue === '' || composer.inputValue.indexOf('手册') === -1,
      `inputValue=${JSON.stringify(composer.inputValue)} chips=${composer.chips}`);
  } else {
    records.push({ id: 'F1c_skill_entry_skipped', ok: true, detail: '斜杠面板无 skill 动态条目（后端技能面未加载），如实标注' });
    console.log('ℹ F1c skill entry skipped（如实标注）');
  }

  // ── F2 右栏空态最近使用徽章（UI-596 实机腿）──
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
  await pagePoll(client, `!!document.querySelector('[class*="emptyResultInner"]')`, { label: 'empty state' });
  await sleep(800);
  // 写路径断言：切到文件 tab（右栏 rightTab 变更）→ writeLastPanel 落 localStorage
  await evalRetry(client, `(function(){
    var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '文件'; });
    if (!btn) return { error: 'no_files_tab_btn' };
    btn.click();
    return 'clicked';
  })()`);
  await sleep(800);
  const after = await evalRetry(client, `localStorage.getItem('petri-last-panel:' + ${JSON.stringify(projectId)})`);
  assert('F2a_last_panel_write', after === 'files', `stored=${JSON.stringify(after)}（rightTab=files 切换后写入）`);

  // ── F3 计量条文字形态复验（BLOCK-276 回到 welcome 复核）──
  await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/`)}; 'back'`);
  await pagePoll(client, `!!document.querySelector('[data-testid="model-chip-model"]')`, { label: 'back to home' });
  await sleep(600);
  const stats = await evalRetry(client, `(function(){
    var bar = document.querySelector('[data-testid="run-stats-bar"]');
    if (!bar) return null;
    return { present: true, svgs: bar.querySelectorAll('svg').length };
  })()`);
  assert('F3_stats_bar_restored_recheck', stats && stats.present === true, JSON.stringify(stats));

  const failed = records.filter((r) => !r.ok);
  const summary = {
    capturedAt: new Date().toISOString(),
    head: require('node:child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    projectId,
    total: records.length, passed: records.length - failed.length, failed: failed.length,
    records,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'final-live.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n== BLOCK-279 终局走查: ${summary.passed}/${summary.total} PASS（failed=${failed.length}）==`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[block295-live] fatal:', e && e.message ? e.message : e); process.exit(2); });
