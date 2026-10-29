#!/usr/bin/env node
'use strict';

/**
 * RW-02 A 线 a 档 — UI 证据债 CDP 批量取证（9223 离屏实例）。
 *
 * 分批推进（逐条断言→翻 verified；台账原文为断言契约）：
 *   第一批（欢迎页）：UI-598 计量条无消耗隐藏 + 通用 starter chips；UI-543 领域文案去核。
 *   后续批次：UI-594 斜杠 chip / UI-331 相对时间 / UI-303 档位菜单 / UI-248 / UI-301 /
 *   UI-385 / UI-462 / UI-484 / UI-596 / UI-638（面板发现腿）。
 * 证据：acceptance/rw-02-ui-evidence/rw02-ui-evidence-live.json
 */

const path = require('node:path');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.RW02_UAPI || 'http://127.0.0.1:3001';

function boxScene(height) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    name: 'RW02 ui638 probe',
    parameters: {},
    nodes: [{
      id: 'enclosure',
      type: 'box',
      name: 'Enclosure',
      dimensions: { width: 90, depth: 60, height },
      transform: { position: [0, 0, 0] },
      material: { color: '#6a8caf', roughness: 0.4 },
    }],
  };
}

async function rest(method, endpoint, body) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: {
      Authorization: 'Bearer desktop-local',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(240_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function evalJs(client, expression, timeoutMs = 15_000) {
  return lib.evalJs(client, expression, timeoutMs);
}

module.exports = {
  id: 'rw02-ui-evidence-live',
  description: 'RW-02 A 线：a 档 UI 证据债 CDP 批量取证（分批：欢迎页→斜杠→面板）',
  evidenceDir: path.join(ROOT, 'acceptance', 'rw-02-ui-evidence'),

  async run(ctx) {
    const { assert } = ctx;
    const targets = await lib.pollTargets({ timeoutMs: ctx.timeoutMs ?? 20_000 });
    assert('cdp_targets_listed', Array.isArray(targets) && targets.length > 0, `${(targets || []).length} targets`);
    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert('spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');
    if (!pages.length) return false;
    const client = await lib.connectTestTarget({ timeoutMs: 30_000 });
    try {
      // 导航到欢迎页（首页）
      await evalJs(client, `location.href = ${JSON.stringify(`${APP}/`)}; 'navigating'`).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // UI-598a：无消耗时计量条整条隐藏
      const runStats = await evalJs(client, `(function(){
        var el = document.querySelector('[class*="runStats"]');
        if (!el) return 'absent';
        var style = window.getComputedStyle(el);
        return (style.display === 'none' || style.visibility === 'hidden' || el.offsetParent === null) ? 'hidden' : 'visible';
      })()`);
      assert('ui598_runstats_hidden_without_consumption', runStats === 'absent' || runStats === 'hidden', `runStats=${runStats}`);

      // UI-598b + UI-543：starter chips 通用 agent 文案（无生信垂直词）
      const chips = await evalJs(client, `(function(){
        var text = document.body.innerText || '';
        return JSON.stringify({
          generic: ['整理笔记', '写一份总结', '代码走查', '规划任务'].filter(function (t) { return text.indexOf(t) >= 0; }),
          bioLeak: ['差异分析', '富集分析', '聚类分析', '报告解读'].filter(function (t) { return text.indexOf(t) >= 0; }),
        });
      })()`);
      const chipsParsed = JSON.parse(chips);
      assert('ui598_starter_chips_generic', chipsParsed.generic.length > 0 && chipsParsed.bioLeak.length === 0,
        `generic=${JSON.stringify(chipsParsed.generic)} bioLeak=${JSON.stringify(chipsParsed.bioLeak)}`);
      assert('ui543_welcome_copy_neutral', chipsParsed.bioLeak.length === 0, `bioLeak=${JSON.stringify(chipsParsed.bioLeak)}`);

      // UI-543b：无领域包时无领域示例卡（示例卡由 provides.examplePrompts 动态提供）
      const exampleCards = await evalJs(client, `(function(){
        var cards = document.querySelectorAll('[class*="exampleCard"], [class*="examplePrompts"], [data-example-card]');
        return JSON.stringify({ count: cards.length });
      })()`);
      const exampleParsed = JSON.parse(exampleCards);
      assert('ui543_no_domain_example_cards_without_packs', exampleParsed.count === 0, `count=${exampleParsed.count}`);

      // ===== Wave-2：项目工作页面 =====
      // 临时项目（隔离断言对象；结束删除）
      const project = await (await fetch(`${API}/api/data/projects`, {
        method: 'POST',
        headers: { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `RW02-UIEVID-${Date.now()}` }),
        signal: AbortSignal.timeout(15_000),
      })).json();
      const probeProjectId = project?.project?.id || null;
      if (probeProjectId) {
        // UI-596：右栏空态最近使用徽章（localStorage 持久化 + 匹配卡亮「上次使用」）
        await evalJs(client, `localStorage.setItem('petri-last-panel:${probeProjectId}', 'results'); 'set'`).catch(() => null);
        await evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/`)} + ${JSON.stringify(probeProjectId)}; 'navigating'`).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 3500));
        const badge = await evalJs(client, `(function(){
          var text = document.body.innerText || '';
          return JSON.stringify({
            badge: text.indexOf('上次使用') >= 0,
            rightCol: !!document.querySelector('[class*="rightCol"]'),
          });
        })()`).catch(() => '"eval_error"');
        try {
          const badgeParsed = JSON.parse(badge);
          assert('ui596_last_used_badge', badgeParsed.badge === true && badgeParsed.rightCol === true,
            `badge=${JSON.stringify(badgeParsed)}`);
        } catch (e) {
          assert('ui596_last_used_badge', false, String(badge).slice(0, 160));
        }

        // UI-462：results tab 无自有仓库提示（managed-only 退役）
        const repoHint = await evalJs(client, `(function(){
          var text = document.body.innerText || '';
          return JSON.stringify({
            ownRepoHint: ['自有仓库', '接入仓库', '仓库授权'].filter(function (t) { return text.indexOf(t) >= 0; }),
          });
        })()`).catch(() => '"eval_error"');
        try {
          const repoParsed = JSON.parse(repoHint);
          assert('ui462_no_own_repo_hint', repoParsed.ownRepoHint.length === 0, `hints=${JSON.stringify(repoParsed.ownRepoHint)}`);
        } catch (e) {
          assert('ui462_no_own_repo_hint', false, String(repoHint).slice(0, 160));
        }

        // UI-303：composer 档位下拉含第四档「计划模式」（副文案只读探索并起草计划）
        const accessMenu = await evalJs(client, `(function(){
          var buttons = Array.prototype.slice.call(document.querySelectorAll('button.sc-access-btn'));
          var trigger = buttons.find(function (b) { return !b.disabled && b.title === '选择访问模式'; })
            || buttons.find(function (b) { return !b.disabled; });
          if (!trigger) return JSON.stringify({ found: false, total: buttons.length });
          trigger.click();
          return 'clicked';
        })()`).catch(() => '"eval_error"');
        let menuSeen = null;
        if (accessMenu === 'clicked') {
          await new Promise((resolve) => setTimeout(resolve, 600));
          menuSeen = await evalJs(client, `(function(){
            var menus = Array.prototype.slice.call(document.querySelectorAll('.sc-access-menu'));
            var text = menus.map(function (m) { return m.innerText || ''; }).join('|');
            if (!text) {
              var body = document.body.innerText || '';
              text = body.indexOf('sc-access-menu') >= 0 ? body : '';
            }
            return JSON.stringify({
              menus: menus.length,
              plan: text.indexOf('计划模式') >= 0,
              sub: text.indexOf('只读探索并起草计划') >= 0,
              full: text.indexOf('完全访问') >= 0,
            });
          })()`).catch(() => '"eval_error"');
          await evalJs(client, "var ov = document.querySelector('.sc-access-overlay'); if (ov) ov.click(); 'close'").catch(() => null);
        }
        try {
          const menuParsed = JSON.parse(menuSeen || '{}');
          assert('ui303_plan_mode_in_menu', menuParsed.plan === true && menuParsed.sub === true && menuParsed.full === true,
            `menu=${JSON.stringify(menuParsed)} trigger=${String(accessMenu).slice(0, 60)}`);
        } catch (e) {
          assert('ui303_plan_mode_in_menu', false, String(menuSeen || accessMenu).slice(0, 160));
        }

        // UI-331：临时项目建会话（REST）→ 左栏会话行 .convItemTime 短式相对时间（刚刚）
        const convCreate = await (await fetch(`${API}/api/ai/conversations`, {
          method: 'POST',
          headers: { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'RW02 相对时间探针', projectId: probeProjectId }),
          signal: AbortSignal.timeout(15_000),
        })).json();
        const convOk = convCreate?.status === 'ok';
        await evalJs(client, `location.reload(); 'reloading'`).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 3500));
        const convTime = await evalJs(client, `(function(){
          var times = Array.prototype.slice.call(document.querySelectorAll('[class*="convItemTime"]'));
          return JSON.stringify({
            count: times.length,
            samples: times.slice(0, 3).map(function (t) { return (t.innerText || '').trim(); }),
            valid: times.filter(function (t) { return /^(刚刚|\\d+分|\\d+小时|\\d+天|\\d{1,2}-\\d{1,2})$/.test((t.innerText || '').trim()); }).length,
          });
        })()`).catch(() => '"eval_error"');
        try {
          const convParsed = JSON.parse(convTime);
          assert('ui331_conversation_relative_time', convOk === true && convParsed.count > 0 && convParsed.valid > 0,
            `convOk=${convOk} convTime=${JSON.stringify(convParsed)}`);
        } catch (e) {
          assert('ui331_conversation_relative_time', false, String(convTime).slice(0, 160));
        }

        // UI-594：斜杠菜单选中 skill 条目 → 结构化 chip 进 composer（textarea.sc-input）
        const composerReady = await evalJs(client, `(function(){
          var composer = document.querySelector('textarea.sc-input');
          if (!composer) return 'composer_missing';
          composer.focus();
          return 'focused';
        })()`).catch(() => '"eval_error"');
        let chipSeen = null;
        if (composerReady === 'focused') {
          await evalJs(client, `(function(){
            var el = document.activeElement;
            if (!el) return 'no-focus';
            document.execCommand('insertText', false, '/');
            return 'typed';
          })()`).catch(() => null);
          await new Promise((resolve) => setTimeout(resolve, 900));
          const picked = await evalJs(client, `(function(){
            var items = Array.prototype.slice.call(document.querySelectorAll('.sc-slash-panel .sc-slash-item'));
            var skillItem = items.find(function (el) {
              var t = (el.innerText || '');
              return /技能/.test(t) || /skill/i.test(t);
            });
            if (!skillItem) {
              return JSON.stringify({ found: false, items: items.length, sample: items.slice(0, 2).map(function (el) { return (el.innerText || '').slice(0, 30); }) });
            }
            skillItem.click();
            return 'picked';
          })()`).catch(() => '"eval_error"');
          if (picked === 'picked') {
            await new Promise((resolve) => setTimeout(resolve, 700));
            chipSeen = await evalJs(client, `(function(){
              var chips = document.querySelectorAll('.sc-selection-refs .sc-selection-ref, [class*="contextItem"]');
              return JSON.stringify({ chips: chips.length });
            })()`).catch(() => '"eval_error"');
          } else {
            console.log('[rw02-diag] ui594 pick:', String(picked).slice(0, 240));
            chipSeen = JSON.stringify({ skipped: 'pick_failed' });
          }
        } else {
          chipSeen = JSON.stringify({ skipped: String(composerReady).slice(0, 120) });
        }
        try {
          const chipParsed = JSON.parse(chipSeen);
          assert('ui594_slash_skill_chip', chipParsed.chips > 0,
            `chip=${JSON.stringify(chipParsed)}`);
        } catch (e) {
          assert('ui594_slash_skill_chip', false, String(chipSeen).slice(0, 160));
        }

        // 清理临时项目
        await fetch(`${API}/api/data/projects/${encodeURIComponent(probeProjectId)}`, {
          method: 'DELETE', headers: { Authorization: 'Bearer desktop-local' }, signal: AbortSignal.timeout(15_000),
        }).catch(() => null);
      } else {
        assert('ui596_last_used_badge', false, 'probe project unavailable');
        assert('ui462_no_own_repo_hint', false, 'probe project unavailable');
        assert('ui303_plan_mode_in_menu', false, 'probe project unavailable');
      }

      // ===== Wave-4：UI-484 联邦委托记录卡（隔离 :3011 + task_events 种子，会话预置）=====
      await evalJs(client, `location.href = ${JSON.stringify(`${APP}/settings`)}; 'navigating'`).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      // 回项目页（联邦入口在左栏页脚）
      await evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/p_mvtu0b52_9cbr`)}; 'navigating'`).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      // 点左栏页脚联邦按钮（data-testid=sidebar-federation）
      const fedNav = await evalJs(client, `(function(){
        var btn = document.querySelector('[data-testid="sidebar-federation"]');
        if (!btn) return JSON.stringify({ found: false });
        btn.click();
        return 'clicked';
      })()`).catch(() => '"eval_error"');
      let cardSeen = null;
      if (fedNav === 'clicked') {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        // 委托记录卡可能落在 peers tab：不在场则点协作成员 tab
        cardSeen = await evalJs(client, `(function(){
          var card = document.querySelector('[data-testid="federation-delegations"]');
          if (!card) {
            var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"], button'));
            var peers = tabs.find(function (el) { return /协作成员|委托/.test(el.innerText || ''); });
            if (peers) peers.click();
            return 'tab_clicked';
          }
          return 'card_present';
        })()`).catch(() => '"eval_error"');
        await new Promise((resolve) => setTimeout(resolve, 1200));
        cardSeen = await evalJs(client, `(function(){
          var card = document.querySelector('[data-testid="federation-delegations"]');
          var text = (card && card.innerText) || document.body.innerText || '';
          return JSON.stringify({
            cardPresent: !!card,
            taskCard: text.indexOf('RW02 委托记录卡探针任务') >= 0,
            peerName: text.indexOf('RW02 探针对端') >= 0,
          });
        })()`).catch(() => '"eval_error"');
      } else {
        console.log('[rw02-diag] ui484 nav:', String(fedNav).slice(0, 240));
        cardSeen = JSON.stringify({ skipped: 'nav_not_found' });
      }
      try {
        const cardParsed = JSON.parse(cardSeen);
        assert('ui484_federation_delegation_card', cardParsed.taskCard === true && cardParsed.peerName === true,
          `card=${JSON.stringify(cardParsed)} nav=${String(fedNav).slice(0, 100)}`);
      } catch (e) {
        assert('ui484_federation_delegation_card', false, String(cardSeen).slice(0, 200));
      }

      // ===== Wave-5：UI-638 面板发现腿（模型3D 产物 → Result Studio 面板列出版）=====
      // 种子：临时项目（git 夹具）+ 真实 Blender 导出（经 RW-01 链注册 revision）
      const p638 = await (await fetch(`${API}/api/data/projects`, {
        method: 'POST', headers: { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `RW02-638-${Date.now()}` }), signal: AbortSignal.timeout(15_000),
      })).json();
      const pid638 = p638?.project?.id || null;
      const ws638 = p638?.project?.workspace_path || null;
      let export638 = null;
      if (pid638 && ws638) {
        const { execSync } = require('node:child_process');
        execSync('git init -q && git config user.email t@petri.local && git config user.name t && git commit -qm init --allow-empty', { cwd: ws638, stdio: 'ignore' });
        await rest('POST', '/model3d/scene/apply', {
          projectId: pid638,
          path: 'model3d/recipes/rw02-638.scene3d.json',
          scene: boxScene(35),
          operations: [{ op: 'set_metadata', metadata: { seededBy: 'rw02-638' } }],
          reason: 'rw02_638_seed',
        });
        const sceneRead638 = await rest('POST', '/model3d/scene/read', { projectId: pid638, path: 'model3d/recipes/rw02-638.scene3d.json' });
        export638 = await rest('POST', '/model3d/scene/export', {
          projectId: pid638,
          scene: sceneRead638.data?.scene,
          scenePath: 'model3d/recipes/rw02-638.scene3d.json',
          formats: ['glb'],
          recipeId: 'rw02-638',
          recipeVersion: 1,
        });
      }
      assert('ui638_seed_export_registered', Boolean(pid638) && export638?.status === 200 && export638.data?.resultStudio?.registered === true,
        `pid=${pid638} export=${JSON.stringify(export638?.data?.resultStudio || export638?.data || null).slice(0, 200)}`);

      if (pid638) {
        // 导航到该项目，打开右栏「结果」面板，dump 对 model3d 作业/产物的呈现
        await evalJs(client, `localStorage.setItem('petri-last-panel:${pid638}', 'results'); location.href = ${JSON.stringify(`${APP}/project/`)} + ${JSON.stringify(pid638)}; 'navigating'`).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 4500));
        // 打开任务 tab（空态卡「任务」或右栏 tab），找 model3d 导出作业瓦片
        const openJobs = await evalJs(client, `(function(){
          var targets = Array.prototype.slice.call(document.querySelectorAll('button, [role="tab"], [class*="panelCard"]'));
          var card = targets.find(function (el) { var t = (el.innerText || '').trim(); return t.indexOf('指挥中心') >= 0; });
          if (card) { card.click(); return 'clicked'; }
          var tabs = targets.filter(function (el) { return /指挥中心/.test(el.innerText || ''); });
          if (tabs.length) { tabs[0].click(); return 'clicked_tab'; }
          return 'not_found';
        })()`).catch(() => '"eval_error"');
        await new Promise((resolve) => setTimeout(resolve, 2000));
        // 找 model3d 导出瓦片并点击
        const tilePick = await evalJs(client, `(function(){
          var tiles = Array.prototype.slice.call(document.querySelectorAll('[class*="jobTile"], [class*="jobCard"], [class*="tile"]'));
          var tile = tiles.find(function (el) { return (el.innerText || '').indexOf('model3d') >= 0 || (el.innerText || '').indexOf('3D 导出') >= 0; });
          if (!tile) {
            return JSON.stringify({ found: false, tiles: tiles.length, sample: tiles.slice(0, 3).map(function (el) { return (el.innerText || '').slice(0, 24); }) });
          }
          tile.click();
          return 'picked';
        })()`).catch(() => '"eval_error"');
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const dump638 = await evalJs(client, `(function(){
          var text = document.body.innerText || '';
          var tile = Array.prototype.slice.call(document.querySelectorAll('button, [class*="tile"], [class*="job"]'))
            .find(function (el) { return (el.innerText || '').indexOf('model3d_export') >= 0; });
          return JSON.stringify({
            wallListsModel3d: text.indexOf('model3d_export') >= 0 && text.indexOf('3D 导出') >= 0,
            tilePresent: !!tile,
            statusDone: text.indexOf('已完成') >= 0,
          });
        })()`).catch(() => '"eval_error"');
        console.log('[rw02-diag] ui638 dump:', String(dump638).slice(0, 400));
        // 断言（诚实口径）：发现腿=任务墙列出 model3d 导出作业（已完成态）。
        // 点开腿=瓦片点击走 wm.openResultInMainWindow（用户主窗动作）——探针红线禁止导航
        // 用户窗口，该半腿入 c 档人测清单（human-eye-checklist 第 4 条）。
        try {
          const parsed638 = JSON.parse(dump638);
          assert('ui638_model3d_in_panel', parsed638.wallListsModel3d === true && parsed638.tilePresent === true,
            `dump=${JSON.stringify(parsed638).slice(0, 260)}`);
        } catch (e) {
          assert('ui638_model3d_in_panel', false, String(dump638).slice(0, 240));
        }
        // 清理
        await fetch(`${API}/api/data/projects/${encodeURIComponent(pid638)}`, {
          method: 'DELETE', headers: { Authorization: 'Bearer desktop-local' }, signal: AbortSignal.timeout(15_000),
        }).catch(() => null);
      }

      return true;
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }
  },
};
