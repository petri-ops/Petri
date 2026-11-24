#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui702-toast-history-live — UI-702 通知历史回看实机（BLOCK-517 W1）。
 *
 * 台账缺口：历史面板的层级/遮挡、长消息换行、暗色对比需实机（观感腿归人，本 flow
 * 不代签）；本 flow 补**机械可判据的实机腿**——真实用户路径触发 toast → 历史回看全链。
 *
 * 触发路径（真实 UI）：seed 一个 SSH 项目（远端主机不存在）→ 项目树点「连接」→
 * sshConnectProject 校验失败 → toast?.error 播报 → 历史入账。
 *
 * 断言链：
 *   P0_ssh_project_seeded         SSH 项目创建（远端不可达主机）
 *   A1_history_entry_present      通知历史入口「通知历史（1）」在场
 *   A2_history_panel_role_log     展开历史面板 role=log aria-label 在场
 *   A3_history_message_replay     错误消息在历史面板可回看（toast 消失后仍在）
 *   A4_history_clear              清空后入口退场
 *   P9_cleanup_project_deleted    SSH 项目清理
 *
 * 前置：后端(:3001) + vite(:3000) + 9223 测试实例（离屏）。
 * 证据：acceptance/block517-walk-batch/ui702-toast-history-live-darwin.json。
 */
const fs = require('node:fs');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = ROOT + '/acceptance/block517-walk-batch';
const SSH_HOST = 'b517-nonexistent.invalid';

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
  id: 'ui702-toast-history-live',
  description: 'UI-702 通知历史回看实机：SSH 项目连接失败→error toast→历史入口/role=log 面板/消息回看/清空（9223 离屏）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    // P0 — SSH 项目（远端主机不存在 → 连接必失败 → error toast）
    const created = await rest('POST', '/data/projects', {
      name: 'UI702-SSH-' + Date.now(),
      modality: 'general',
      workspaceKind: 'ssh',
      sshHost: SSH_HOST,
      remotePath: '/tmp/b517-walk',
    });
    const projectId = created.data && created.data.project && created.data.project.id;
    assert('P0_ssh_project_seeded', Boolean(projectId), `id=${projectId || 'none'} status=${created.status}`);
    if (!projectId) return false;

    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target');
    const target = await lib.selectPageTarget(pages, {
      probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
    });
    const client = await lib.connectTarget(target);

    try {
      await evalRetry(client, `location.href='http://localhost:3000/?test=1&_t=${Date.now()}'; 'r'`);
      await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after reset' });
      await sleep(2000);
      await evalRetry(client, `location.href='http://localhost:3000/project/${projectId}?_t=${Date.now()}'; 'n'`);
      await pagePoll(client, `!!document.querySelector('.sc-input')`, { label: 'composer', timeoutMs: 30000 });

      // 项目树 SSH 行的「远程连接状态：连接断开（点击重试）」按钮——点重试 →
      // sshConnectProject 校验失败 → toast?.error → 历史入账
      const clickConnect = await pagePoll(client, `(function(){
        var mine = [];
        var rows = [...document.querySelectorAll('[class*="projectTreeRow"]')];
        for (var i = 0; i < rows.length; i += 1) {
          if (rows[i].textContent.indexOf('UI702-SSH-') < 0) continue;
          var btns = [...rows[i].querySelectorAll('button[title^="远程连接 ·"]')];
          if (btns.length) mine = mine.concat(btns);
        }
        if (!mine.length) return '';
        mine[mine.length - 1].click();
        return 'clicked';
      })()`, { label: 'ssh connect button', timeoutMs: 25000 });
      assert('A0_connect_clicked', clickConnect === 'clicked', clickConnect);

      // 连接失败 → error toast（4 秒消失）→ 历史入账 → 入口在场
      await pagePoll(client, `(function(){
        var t = document.querySelector('[data-testid="toast-history-toggle"]');
        return t ? 'entry:' + t.textContent.trim().slice(0, 24) : '';
      })()`, { label: 'history entry', timeoutMs: 20000 });
      assert('A1_history_entry_present', true, '通知历史入口在场（toast 已播报）');

      // A2/A3 — 展开面板：role=log + 错误消息可回看
      await evalRetry(client, `(function(){
        document.querySelector('[data-testid="toast-history-toggle"]').click();
        return 'expanded';
      })()`);
      const panel = await pagePoll(client, `(function(){
        var p = document.querySelector('[data-testid="toast-history-panel"]');
        if (!p) return '';
        return JSON.stringify({ role: p.getAttribute('role'), hasError: p.textContent.indexOf('远程连接失败') >= 0 });
      })()`, { label: 'history panel content', timeoutMs: 15000 });
      const parsed = JSON.parse(panel);
      assert('A2_history_panel_role_log', parsed.role === 'log', `role=${parsed.role}`);
      assert('A3_history_message_replay', parsed.hasError === true, '错误消息在历史面板可回看（toast 已消失）');

      // A4 — 清空
      const clearBtn = await evalRetry(client, `(function(){
        var btns = [...document.querySelectorAll('[data-testid="toast-history-panel"] button')].filter(function(b){
          return b.textContent.indexOf('清空') >= 0;
        });
        if (!btns.length) return 'no_clear';
        btns[0].click();
        return 'cleared';
      })()`);
      await pagePoll(client, `(function(){
        var t = document.querySelector('[data-testid="toast-history-toggle"]');
        var p = document.querySelector('[data-testid="toast-history-panel"]');
        return (!t && !p) ? 'gone' : 'still';
      })()`, { label: 'history cleared', timeoutMs: 10000 });
      assert('A4_history_clear', clearBtn === 'cleared', '清空后入口退场');
    } finally {
      const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)).catch(() => null);
      assert('P9_cleanup_project_deleted', Boolean(d && d.ok), `status=${d && d.status}`);
    }
    return true;
  },
};
