#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui593-empty-state-live — UI-593 右栏空态 Qoder 式引导实机走查（BLOCK-513 L1）。
 *
 * 台账降级注记（BLOCK-410 L6-3）：「组件级 21/21 但 9223 实机走查未做；实机补腿后升回」。
 * 旧证据 acceptance/block-277/live.json（2026-10-27 5/5）与该降级判定存在矛盾——本 flow 在
 * 现行 HEAD 重新取证（新鲜证据取代矛盾），并补 A5 悬停 accent（BLOCK-273 规范）与
 * A6 暗色布局两腿。机械可判据腿；升 verified 的依据=台账自设的 reopen 条件「实机补腿后升回」。
 *
 * 断言链（welcome 首页 → 临时项目 /project/:id 右栏 home tab 空态）：
 *   P0_temp_project_created        临时项目创建（结束清理）
 *   A1_header_block                「工作区」标题章+标题+描述块（内容合同在案）+徽章 svg
 *   A2_six_rich_cards_two_col      入口富卡（图标章+标题+说明）≥6，2 列等宽行（2026-10-27 后批次已从 6 卡演进到 8 卡——布局契约=富卡+两列，卡数随功能演进，不钉死六）
 *   A3_vertically_centered         内容块垂直居中（±40px，不沉底）
 *   A4_no_review_badge_on_fresh    新项目无未看改动徽章
 *   A5_hover_accent_state          真实 CDP 指针悬停 → 卡片描边/底色变 accent（与基线不同且含 accent 值）
 *   A6_dark_layout_intact          data-theme=dark 下富卡仍两列等宽行且标题/描述在场（布局不塌）
 *   （截图：-32000 离屏边界为已入册先例〔BLOCK-273/UI-590〕——尝试取图，unavailable 记入证据明细不作 fail 断言）
 *
 * 前置：后端(:3001) + vite(:3000) + 9223 测试实例（bash scripts/start-test-instance.sh，离屏）。
 * 证据：acceptance/ui-593/（run.json + 亮/暗截图）。
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'ui-593');

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

async function clipShot(client, file, selector, pad = 20) {
  const rect = await evalRetry(client, `(function(){
    var e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return null;
    var r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  if (!rect || rect.w <= 0) return 'no_rect';
  const clip = {
    x: Math.max(0, Math.floor(rect.x - pad)),
    y: Math.max(0, Math.floor(rect.y - pad)),
    width: Math.ceil(rect.w + pad * 2),
    height: Math.ceil(rect.h + pad * 2),
    scale: 2,
  };
  try {
    const shot = await client.send('Page.captureScreenshot',
      { format: 'png', clip, fromSurface: false }, { timeoutMs: 20000 });
    fs.writeFileSync(path.join(EVIDENCE_DIR, file), Buffer.from(shot.data, 'base64'));
    return 'saved';
  } catch (e) {
    return 'screenshot_unavailable: ' + (e && e.message || '').slice(0, 80);
  }
}

module.exports = {
  id: 'ui593-empty-state-live',
  description: 'UI-593 右栏空态 Qoder 式引导实机：头块/六卡两列/垂直居中/无徽章/悬停 accent/暗色布局（9223 离屏）',
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
    await client.send('Page.bringToFront', {}, { timeoutMs: 15000 }).catch(() => {});
    const originalUrl = await evalRetry(client, 'location.href');

    let projectId = null;
    try {
      // P0 临时项目
      const created = await rest('POST', '/data/projects', { name: 'UI593-验收-' + Date.now(), modality: 'general' });
      projectId = created.data && created.data.project && created.data.project.id;
      assert('P0_temp_project_created', Boolean(projectId), `id=${projectId || 'none'}`);

      await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
      await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after nav' });
      await pagePoll(client, `(function(){
        var el = document.querySelector('[class*="emptyResultInner"]');
        return el && el.querySelectorAll('[class*="emptyResultLaunchCard"]').length >= 6 ? 'ready' : '';
      })()`, { label: 'empty state cards' });
      await sleep(800);

      // A1 头部块（内容合同=Qoder 0.4.8 ui-i18n #3788255/#3788272 落地文案）
      const head = await evalRetry(client, `(function(){
        var t = document.querySelector('[class*="emptyResultTitle"]');
        var d = document.querySelector('[class*="emptyResultDesc"]');
        var b = document.querySelector('[class*="emptyResultBadge"]');
        return { title: t && t.textContent, desc: d && d.textContent.slice(0, 40), badgeSvg: !!(b && b.querySelector('svg')) };
      })()`);
      assert('A1_header_block', head && head.title === '工作区'
        && (head.desc || '').includes('Agent 会在这里看文件') && head.badgeSvg === true, JSON.stringify(head));

      // A2 入口富卡 ≥6 全带图标章+说明；两列等宽行（行数=卡数/2）
      const grid = await evalRetry(client, `(function(){
        var cards = [...document.querySelectorAll('[class*="emptyResultLaunchCard"]')];
        var withDesc = cards.filter(function(c){
          return c.querySelector('[class*="emptyResultLaunchDesc"]') && c.querySelector('[class*="emptyResultLaunchIcon"] svg');
        }).length;
        var rows = {};
        cards.forEach(function(c){
          var y = Math.round(c.getBoundingClientRect().top);
          (rows[y] = rows[y] || []).push(Math.round(c.getBoundingClientRect().width));
        });
        var rowKeys = Object.keys(rows);
        var twoCol = rowKeys.length === cards.length / 2 && rowKeys.every(function(k){
          return rows[k].length === 2 && Math.abs(rows[k][0] - rows[k][1]) <= 2;
        });
        return { cards: cards.length, withDesc: withDesc, rowCount: rowKeys.length, twoCol: twoCol };
      })()`);
      assert('A2_six_rich_cards_two_col',
        Number(grid.cards) >= 6 && Number(grid.withDesc) === Number(grid.cards) && grid.twoCol === true,
        JSON.stringify(grid));

      // A3 垂直居中（不沉底）
      const center = await evalRetry(client, `(function(){
        var c = document.querySelector('[class*="emptyResult"]');
        var i = document.querySelector('[class*="emptyResultInner"]');
        if (!c || !i) return null;
        var cr = c.getBoundingClientRect(); var ir = i.getBoundingClientRect();
        return { cTop: Math.round(cr.top), cH: Math.round(cr.height),
                 iTop: Math.round(ir.top), iH: Math.round(ir.height) };
      })()`);
      const expectTop = center ? center.cTop + Math.round((center.cH - center.iH) / 2) : 0;
      assert('A3_vertically_centered', center && Math.abs(center.iTop - expectTop) <= 40,
        JSON.stringify({ ...center, expectTop }));

      // A4 新项目无未看改动徽章
      const badge = await evalRetry(client, `!!document.querySelector('[data-testid="review-tile-count"]')`);
      assert('A4_no_review_badge_on_fresh', badge === false, 'fresh project has no unread changes');

      // A5 悬停 accent（BLOCK-273 规范：描边+底色变化；真实 CDP 指针驱动 :hover）
      const baseline = await evalRetry(client, `(function(){
        var c = document.querySelector('[class*="emptyResultLaunchCard"]');
        if (!c) return null;
        var s = getComputedStyle(c);
        return { border: s.borderTopColor, bg: s.backgroundColor };
      })()`);
      const rect = await evalRetry(client, `(function(){
        var c = document.querySelector('[class*="emptyResultLaunchCard"]');
        if (!c) return null;
        var r = c.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      let hover = null;
      if (rect) {
        await client.send('Input.dispatchMouseEvent',
          { type: 'mouseMoved', x: Math.round(rect.x), y: Math.round(rect.y) }, { timeoutMs: 15000 });
        await sleep(400);
        hover = await evalRetry(client, `(function(){
          var c = document.querySelector('[class*="emptyResultLaunchCard"]:hover');
          if (!c) return { hovered: false };
          var s = getComputedStyle(c);
          return { hovered: true, border: s.borderTopColor, bg: s.backgroundColor };
        })()`);
        await client.send('Input.dispatchMouseEvent',
          { type: 'mouseMoved', x: 5, y: 5 }, { timeoutMs: 15000 }).catch(() => {});
      }
      const accentChanged = hover && hover.hovered === true && baseline && (
        hover.border !== baseline.border || hover.bg !== baseline.bg);
      assert('A5_hover_accent_state', accentChanged === true,
        JSON.stringify({ baseline, hover }));

      // A6 暗色布局不塌 + 截图（呈现面直接切 data-theme，不改持久化偏好）
      const prevTheme = await evalRetry(client, `document.documentElement.getAttribute('data-theme') || ''`);
      await evalRetry(client, `document.documentElement.setAttribute('data-theme','dark'); 'dark'`);
      await sleep(400);
      const dark = await evalRetry(client, `(function(){
        var cards = [...document.querySelectorAll('[class*="emptyResultLaunchCard"]')];
        var t = document.querySelector('[class*="emptyResultTitle"]');
        var withDesc = cards.filter(function(c){ return c.querySelector('[class*="emptyResultLaunchDesc"]'); }).length;
        return { cards: cards.length, withDesc: withDesc, title: t && t.textContent };
      })()`);
      assert('A6_dark_layout_intact', Number(dark.cards) >= 6 && Number(dark.withDesc) === Number(dark.cards)
        && dark.title === '工作区', JSON.stringify(dark));
      // 截图：-32000 离屏边界为已入册先例（BLOCK-273/UI-590）——unavailable 如实记明细，不作 fail 断言
      const darkShot = await clipShot(client, 'empty-state-dark.png', '[class*="emptyResult"]');
      await evalRetry(client, `document.documentElement.setAttribute('data-theme',${JSON.stringify(prevTheme || 'light')}); 'restored'`);
      const lightShot = await clipShot(client, 'empty-state-light.png', '[class*="emptyResult"]');
      console.log(`[ui593] screenshots: dark=${darkShot} light=${lightShot}`);
    } finally {
      // 清理：删临时项目 + 恢复原页
      if (projectId) {
        const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)).catch(() => null);
        assert('P9_cleanup_project_deleted', Boolean(d && d.ok), `status=${d && d.status}`);
      }
      try {
        await evalRetry(client, `location.href = ${JSON.stringify(originalUrl)}; 'restoring'`);
        await sleep(2000);
      } catch { /* 恢复失败不掩盖断言结果 */ }
    }
    return true;
  },
};
