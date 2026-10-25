#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: q9rem-adjudication-live — BLOCK-261（Q9-REM 余项裁决）实机腿。
 *
 * A0a backend_rest_healthy        后端 REST 可达
 * A0b app_page_ready              SPA 根节点就绪
 * A1a quit_preview_opened         测试实例预览退出摘要（真实 seed 数据，非合成计数）
 * A1b quit_dialog_rendered        弹窗真的挂在 DOM（缺失时带诊断快照）
 * A1c quit_items_visible          逐项行含排队作业/无主作业/运行任务
 * A2a stop_pending_job            排队作业点「取消」→ 界面显示「已取消。」
 * A2b stop_orphan_job             无进程归属的运行作业 → 显示拒绝强制终止，不谎称已停
 * A2c stop_running_task           运行任务点「停止」→ 「已请求停止。」
 * A3a dialog_closed_by_cancel     用真实「取消」动作钮收起弹窗
 * A3b reopen_preview              再次预览（新一轮摘要）
 * A3c new_summary_drops_old_results 已取消作业不再出现；旧结论不跟跑到新一轮
 * A4  dialog_closed_clean         收尾再取消，弹窗收起
 * A5  spa_clean                   回到 ?test=1，应用级边界未被触发
 *
 * 诚实边界：截图离屏 unavailable；审批项逐项停止与 K1 应用级边界不在实机腿内
 * （分别由 Node 契约测试与组件测试覆盖，脚本报告已列明）。
 */

const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
let activeClient = null;

async function ensureClient() {
  if (activeClient) {
    try { await lib.evalJs(activeClient, '1', 4000); return activeClient; } catch { activeClient = null; }
  }
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const chosen = await lib.selectPageTarget(pages, { probe: async (candidate) => lib.evalJs(candidate, `!!document.getElementById('root')`).catch(() => false) });
  activeClient = await lib.connectTarget(chosen);
  return activeClient;
}

async function evalRetry(_client, expr, tries = 4) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(await ensureClient(), expr, 8000); } catch (e) { lastErr = e; await sleep(500); }
  }
  throw lastErr;
}

async function navigate(url) {
  const live = await ensureClient();
  try { await live.send('Page.navigate', { url }); } catch { activeClient = null; }
  await sleep(1200);
}

async function pagePoll(_client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await Promise.race([
      evalRetry(null, expr, 1),
      new Promise((resolve) => setTimeout(resolve, 6000, 'poll_timeout')),
    ]).catch((e) => `eval_err:${e.message}`);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(600);
  }
  throw new Error(`page_poll_timeout: ${label} :: ${String(last).slice(0, 200)}`);
}

function resultText(id) {
  return `(function(){ var b=document.querySelector('[data-testid="quit-summary-stop-result-${id}"]'); return b ? String(b.textContent || '') : ''; })()`;
}

/** 只在结果文案出现期望片段时才回值——否则轮询会立刻读到旧的 status 文案。 */
function resultContains(id, needle) {
  return `(function(){ var b=document.querySelector('[data-testid="quit-summary-stop-result-${id}"]'); var t=b?String(b.textContent||''):''; return t.indexOf(${JSON.stringify(needle)})>=0 ? t : ''; })()`;
}

function clickStop(id) {
  return `(function(){ var b=document.querySelector('[data-testid="quit-summary-stop-${id}"]'); if(!b) return 'no_button'; if(b.disabled) return 'disabled'; b.click(); return 'clicked'; })()`;
}

function clickDecision(action) {
  return `(function(){ var b=document.querySelector('[data-testid="quit-summary-decision-${action}"]'); if(!b) return 'no_button'; b.click(); return 'clicked'; })()`;
}

async function openPreview() {
  const preview = await evalRetry(null, `(function(){ return window.petriDesktop.app.previewQuitSummary(); })()`);
  return Boolean(preview && preview.ok !== false);
}

module.exports = {
  id: 'q9rem-adjudication-live',
  description: 'BLOCK-261 Q9-REM 余项裁决：退出摘要逐项停止（成功/幂等失败/新摘要复位）',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-261'),

  async run(ctx) {
    const { assert, jobIdPending, jobIdOrphan, taskId } = ctx;
    let client = null;

    const health = await fetch(API + '/data/projects', { headers: AUTH });
    assert('A0a_backend_rest_healthy', health.ok, `status=${health.status}`);
    client = await ensureClient();
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'root', timeoutMs: 30000 });
    assert('A0b_app_page_ready', true, 'root 就绪');

    // 与 BLOCK-260 腿同形：先进项目会话页（欢迎页的首启浮层不参与本轮验收）。
    await navigate(`${APP_ORIGIN}/project/${encodeURIComponent(ctx.projectId)}/chat`);
    await evalRetry(null, `(function(){
      var btn = document.querySelector('[data-testid="role-reveal-start"]');
      if (btn) { btn.click(); return 'dismissed'; }
      return 'absent';
    })()`).catch(() => 'ignore');

    assert('A1a_quit_preview_opened', await openPreview(), '测试实例预览退出摘要');
    const dialogUp = await pagePoll(client, `String(!!document.querySelector('[data-testid="quit-summary-dialog"]'))`, { label: 'quit dialog', timeoutMs: 15000 })
      .catch((error) => `dialog_missing::${String(error.message).slice(0, 120)}`);
    if (String(dialogUp) !== 'true') {
      const diag = await evalRetry(null, `(function(){
        var app = document.querySelector('[data-testid="error-boundary-app"]');
        return JSON.stringify({
          url: location.pathname + location.search,
          appBoundary: app ? String((app.textContent || '').slice(0, 80)) : null,
          providerMounted: !document.querySelector('[data-testid="quit-summary-dialog"]'),
          hasBridge: typeof (window.petriDesktop && window.petriDesktop.app && window.petriDesktop.app.previewQuitSummary) === 'function',
          body: String(document.body.innerText || '').slice(0, 200),
        });
      })()`).catch((error) => `diag_err:${error.message}`);
      assert('A1b_quit_dialog_rendered', false, `${dialogUp} :: ${diag}`);
      return;
    }
    assert('A1b_quit_dialog_rendered', true, `dialog=${dialogUp}`);
    const itemsText = await evalRetry(null, `(function(){ var box=document.querySelector('[data-testid="quit-summary-items"]'); return box ? String(box.innerText || '') : ''; })()`);
    const items = String(itemsText);
    assert('A1c_quit_items_visible', items.includes('排队中的差异分析') && items.includes('无主的运行中作业') && items.includes('运行中的长任务'), items.slice(0, 240));

    const clickPending = await evalRetry(null, clickStop(jobIdPending));
    const pendingResult = await pagePoll(client, resultContains(jobIdPending, '已取消'), { label: 'pending job → 已取消', timeoutMs: 12000 })
      .catch(async (error) => `poll_fail:${String(error.message).slice(0, 80)}::now=${await evalRetry(null, resultText(jobIdPending)).catch(() => 'err')}`);
    assert('A2a_stop_pending_job', clickPending === 'clicked' && String(pendingResult).includes('已取消'), `${clickPending} / ${pendingResult}`);

    const clickOrphan = await evalRetry(null, clickStop(jobIdOrphan));
    const orphanResult = await pagePoll(client, resultContains(jobIdOrphan, '拒绝强制终止'), { label: 'orphan job → 拒绝强制终止', timeoutMs: 12000 })
      .catch(async (error) => `poll_fail:${String(error.message).slice(0, 80)}::now=${await evalRetry(null, resultText(jobIdOrphan)).catch(() => 'err')}`);
    assert('A2b_stop_orphan_job_refuses_false_success',
      clickOrphan === 'clicked' && String(orphanResult).includes('拒绝强制终止') && !String(orphanResult).includes('已取消'),
      `${clickOrphan} / ${orphanResult}`);

    const clickTask = await evalRetry(null, clickStop(taskId));
    const taskResult = await pagePoll(client, resultContains(taskId, '已请求停止'), { label: 'task → 已请求停止', timeoutMs: 12000 })
      .catch(async (error) => `poll_fail:${String(error.message).slice(0, 80)}::now=${await evalRetry(null, resultText(taskId)).catch(() => 'err')}`);
    assert('A2c_stop_running_task', clickTask === 'clicked' && String(taskResult).includes('已请求停止'), `${clickTask} / ${taskResult}`);

    // 走真实用户动作关弹窗（渲染侧清态 + 主进程清 flow），再用新一轮摘要验结果不跟跑。
    const closeFirst = await evalRetry(null, clickDecision('cancel'));
    assert('A3a_dialog_closed_by_cancel', closeFirst === 'clicked', `cancel=${closeFirst}`);
    await sleep(500);
    assert('A3b_reopen_preview', await openPreview(), '取消后再次预览退出摘要');
    const reopened = await pagePoll(client, `(function(){
      var box=document.querySelector('[data-testid="quit-summary-items"]');
      var t = box ? String(box.innerText || '') : '';
      return t.indexOf('无主的运行中作业') >= 0 ? t : '';
    })()`, { label: 'reopened items', timeoutMs: 15000 })
      .catch((error) => `poll_fail:${String(error.message).slice(0, 80)}`);
    const reopenedOrphanResult = String(await evalRetry(null, resultText(jobIdOrphan)).catch(() => 'eval_err'));
    assert('A3c_new_summary_drops_old_results',
      !String(reopened).includes('排队中的差异分析')
        && reopenedOrphanResult.includes('running')
        && !reopenedOrphanResult.includes('拒绝强制终止'),
      `items=${String(reopened).replace(/\s+/g, ' ').slice(0, 160)} orphanResult=${reopenedOrphanResult}`);

    await evalRetry(null, clickDecision('cancel'));
    const dialogGone = await pagePoll(client, `(function(){
      var d = document.querySelector('[data-testid="quit-summary-dialog"]');
      return String(d ? 0 : 1);
    })()`, { label: 'dialog closed', timeoutMs: 12000 }).catch(() => '0');
    assert('A4_dialog_closed_clean', dialogGone === '1', '取消退出后弹窗收起');

    await navigate(`${APP_ORIGIN}/?test=1`);
    const spa = await pagePoll(client, `String(!!document.getElementById('root') && !document.querySelector('[data-testid="error-boundary-app"]'))`, { label: 'spa reset', timeoutMs: 30000 });
    assert('A5_spa_clean', spa === 'true', '收尾回 ?test=1，应用级边界未被触发');
  },
};
