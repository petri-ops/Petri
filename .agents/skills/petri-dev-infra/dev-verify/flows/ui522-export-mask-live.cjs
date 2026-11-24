#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui522-export-mask-live — UI-522 模型渠道导出默认脱敏实机（BLOCK-513 L2）。
 *
 * 台账缺口（RW-02 d 档对账）：「无实机腿（导出只走浏览器下载/原生另存，未在 9223 上
 * 点导出）→ 补实机产物后再翻」。本 flow 在 9223 离屏实例走**真实用户路径**：
 * 加渠道 → 本地 mock provider 发现模型 → 填假 Key → 保存 → 点导出（真实 UI 按钮），
 * URL.createObjectURL 打点捕获导出内容（等价于落盘文件内容），window.confirm 经 CDP
 * dialog 事件按预设答案应答。
 *
 * 断言链：
 *   P0_settings_open             /settings 渲染
 *   A1_profile_added             「添加 API 渠道」→ 新渠道卡出现
 *   A2_model_discovered          mock provider 测试连通性 → 默认模型自动预填
 *   A3_saved                     footer 保存 → 已保存 toast
 *   A4_export_json_masked        导出 JSON（二次确认=取消）→ 明文 Key 零出现、`***<后四位>` 在场、信封 note=masked
 *   A5_export_csv_shape          导出 CSV → BOM+表头列序 id,supplier,baseUrl,defaultModel,provider,hasApiKey,apiKey 不变、值脱敏
 *   A6_export_plaintext_contrast 二次确认=确定 → 明文 Key 在场（证明默认脱敏是显式选择而非 Key 缺席假象）
 *   P9_cleanup_profile_removed   删除渠道（确认）+ 再保存还原
 *
 * 红线：假 Key（sk-ui522-…，非真实凭据）；mock provider 只听本机回环。
 * 已知边界（2026-11-24 实测）：本环境（9223 离屏测试实例）Electron 原生 window.confirm
 * 不经 CDP Page.javascriptDialogOpening 且自动按「确定」应答（首轮实证：两道确认全真
 * → 明文导出）——故二次确认的取向以 **in-page confirm 桩 + 预设答案队列**等价应答
 * （导出按钮点击为真实用户路径）；如原生对话框行为修复，桩可整体摘除。
 * 证据：acceptance/ui-522/ui522-export-mask-live-darwin.json（run.cjs 落盘）。
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'ui-522');
const MOCK_PORT = 18923;
const FAKE_KEY = 'sk-ui522-fake-9a7b3c1d';
const FAKE_KEY_LAST4 = FAKE_KEY.slice(-4);
const MOCK_MODEL = 'block513-mock-model';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** 点击按钮（按可见文本精确匹配），返回是否命中。 */
async function clickByText(client, text, scopeExpr) {
  return evalRetry(client, `(function(){
    var scope = ${scopeExpr || 'document'};
    var els = [...scope.querySelectorAll('button')].filter(function(b){
      return b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled && b.offsetParent !== null;
    });
    if (!els.length) return 'no_match';
    els[els.length - 1].click();
    return 'clicked';
  })()`);
}

module.exports = {
  id: 'ui522-export-mask-live',
  description: 'UI-522 模型渠道导出默认脱敏实机：真实 UI 加渠道/mock 发现/保存/点导出，JSON+CSV 脱敏与明文对照（9223 离屏）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    // 本地 mock provider（只听回环）：OpenAI 兼容 /v1/models
    const mock = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: MOCK_MODEL }] }));
    });
    await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve));

    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target: 9223 测试实例无 localhost:3000 页面');
    const target = await lib.selectPageTarget(pages, {
      probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
    });
    const client = await lib.connectTarget(target);
    await client.send('Page.enable', {}, { timeoutMs: 15000 }).catch(() => {});

    // in-page confirm 桩 + 预设答案队列（见文件头「已知边界」——原生对话框自动应答实证）
    // 预设答案直接写入页面侧队列（confirm 桩在 window.__ui522answers 上 shift）
    const pushAnswers = (...a) => evalRetry(client, `window.__ui522answers.push(...${JSON.stringify(a)}); 'pushed'`);
    const armConfirmStub = () => evalRetry(client, `(function(){
      window.__ui522answers = window.__ui522answers || [];
      window.confirm = function(){ return window.__ui522answers.length ? window.__ui522answers.shift() : false; };
      return 'armed';
    })()`);

    try {
      await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/settings`)}; 'nav'`);
      await pagePoll(client, `!!document.querySelector('.petri-desktop-panel')`, { label: 'settings panel' });
      // BLOCK-423 设置重排：分区手风琴——先展开「模型接口」分区
      assert('P0_settings_open', (await evalRetry(client, `(function(){
        var b = [...document.querySelectorAll('button')].find(function(e){ return e.textContent.indexOf('模型接口') >= 0; });
        if (!b) return 'no_section';
        b.click();
        return 'expanded';
      })()`)) === 'expanded', 'settings panel + model endpoints section expanded');

      // A1 加渠道
      assert('A1_profile_added', (await clickByText(client, '添加 API 渠道')) === 'clicked'
        && (await pagePoll(client, `[...document.querySelectorAll('[aria-label^="删除"]')].length >= 1 ? 'yes' : ''`, { label: 'new profile card' })) === 'yes');

      // 填 Base URL + 假 Key（新卡 = 最后一张的祖先容器内查找）
      await evalRetry(client, `(function(){
        var dels = [...document.querySelectorAll('[aria-label^="删除"]')];
        if (!dels.length) return 'no_card';
        var container = dels[dels.length - 1];
        for (var up = container; up && up !== document.body; up = up.parentElement) {
          var b = up.querySelector('input[aria-label="Base URL"]');
          var k = up.querySelector('input[aria-label="API Key"]');
          if (b && k) {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(b, 'http://127.0.0.1:${MOCK_PORT}/v1');
            b.dispatchEvent(new Event('input', { bubbles: true }));
            setter.call(k, ${JSON.stringify(FAKE_KEY)});
            k.dispatchEvent(new Event('input', { bubbles: true }));
            return 'filled';
          }
        }
        return 'fields_not_found';
      })()`);
      const filled = await evalRetry(client, `(function(){
        var k = [...document.querySelectorAll('input[aria-label="API Key"]')].pop();
        var b = [...document.querySelectorAll('input[aria-label="Base URL"]')].pop();
        return (k && k.value.indexOf('9a7b') >= 0 && b && b.value.indexOf(String(${MOCK_PORT})) >= 0) ? 'ok' : 'not_filled';
      })()`);
      assert('A1b_fields_filled', filled === 'ok', filled);

      // A2 测试连通性 → 默认模型自动预填（按钮=卡内 .petri-endpoint-card__test）
      await evalRetry(client, `(function(){
        var b = document.querySelector('.petri-endpoint-card__test:last-of-type') || [...document.querySelectorAll('.petri-endpoint-card__test')].pop();
        if (!b || b.disabled) return 'test_btn_unavailable';
        b.click();
        return 'clicked';
      })()`);
      await pagePoll(client, `(function(){
        var s = [...document.querySelectorAll('select[aria-label="默认模型"]')].pop();
        return s && s.value ? s.value : '';
      })()`, { label: 'default model prefilled', timeoutMs: 25000 });
      assert('A2_model_discovered', true, `model=${MOCK_MODEL}`);

      // A3 保存（footer 保存钮）→ 已保存 toast
      assert('A3_save_clicked', (await clickByText(client, '保存')) === 'clicked');
      await pagePoll(client, `!!document.querySelector('.petri-saved-toast') ? 'saved' : ''`, { label: 'saved toast', timeoutMs: 25000 });
      assert('A3_saved', true, '已保存 toast');
      await sleep(600);

      // 捕获导出内容：createObjectURL 打点 + confirm 桩
      await evalRetry(client, `(function(){
        window.__ui522caps = [];
        if (!window.__ui522patched) {
          var orig = URL.createObjectURL.bind(URL);
          URL.createObjectURL = function(blob){
            try { blob.text().then(function(t){ window.__ui522caps.push(String(t)); }).catch(function(){}); } catch (e) {}
            return orig(blob);
          };
          window.__ui522patched = true;
        }
        return 'patched';
      })()`);
      await armConfirmStub();

      // A4 导出 JSON：第一确认=接受，第二确认=取消（默认脱敏推荐路径）
      const capsBefore = await evalRetry(client, 'window.__ui522caps.length');
      pushAnswers(true, false);
      assert('A4_export_json_clicked', (await clickByText(client, '导出 JSON')) === 'clicked');
      const captured = await pagePoll(client, `window.__ui522caps.length > ${capsBefore} ? 'captured' : ''`, { label: 'json export capture', timeoutMs: 20000 }).catch(async (e) => {
        const msg = await evalRetry(client, `(function(){
          var s = [...document.querySelectorAll('.petri-field__hint')].map(function(x){ return x.textContent; }).join(' | ');
          var a = window.__ui522answers || [];
          return 'hint=' + s.slice(0, 120) + ' answersLeft=' + a.length;
        })()`).catch(() => 'hint_unavailable');
        throw new Error(e.message + ' :: ' + msg);
      });
      const maskedJson = await evalRetry(client, 'window.__ui522caps[window.__ui522caps.length - 1]');
      const maskedOk = !maskedJson.includes(FAKE_KEY)
        && maskedJson.includes(`***${FAKE_KEY_LAST4}`)
        && maskedJson.includes('petri-api-endpoints')
        && maskedJson.includes('API keys are masked');
      assert('A4_export_json_masked', maskedOk === true,
        `plaintext_absent=${!maskedJson.includes(FAKE_KEY)} masked_present=${maskedJson.includes(`***${FAKE_KEY_LAST4}`)} note=${maskedJson.includes('API keys are masked')}`);

      // A5 导出 CSV：列序不变 + 值脱敏
      pushAnswers(true, false);
      assert('A5_export_csv_clicked', (await clickByText(client, '导出 CSV')) === 'clicked');
      await pagePoll(client, `window.__ui522caps.length > ${Number(capsBefore) + 1} ? 'captured' : ''`, { label: 'csv export capture', timeoutMs: 20000 });
      const csv = await evalRetry(client, 'window.__ui522caps[window.__ui522caps.length - 1]');
      // BOM 判定注：blob.text() 的 UTF-8 解码会剥掉前导 ﻿（文件本体带 BOM，捕获路径
      // 观察不到）——列形状以表头行为准（下游解析器依赖列顺序，台账原文口径）。
      const csvOk = csv.startsWith('id,supplier,baseUrl,defaultModel,provider,hasApiKey,apiKey')
        && !csv.includes(FAKE_KEY)
        && csv.includes(`***${FAKE_KEY_LAST4}`);
      assert('A5_export_csv_shape', csvOk === true,
        `header_ok=${csv.startsWith('id,supplier,baseUrl,defaultModel,provider,hasApiKey,apiKey')} masked_present=${csv.includes(`***${FAKE_KEY_LAST4}`)} plaintext_absent=${!csv.includes(FAKE_KEY)}`);

      // A6 明文对照：第二确认=确定（显式跨机迁移路径）
      pushAnswers(true, true);
      assert('A6_export_json2_clicked', (await clickByText(client, '导出 JSON')) === 'clicked');
      await pagePoll(client, `window.__ui522caps.length > ${Number(capsBefore) + 2} ? 'captured' : ''`, { label: 'plaintext export capture', timeoutMs: 20000 });
      const plainJson = await evalRetry(client, 'window.__ui522caps[window.__ui522caps.length - 1]');
      assert('A6_export_plaintext_contrast', plainJson.includes(FAKE_KEY)
        && plainJson.includes('explicitly requested'), `plaintext_present=${plainJson.includes(FAKE_KEY)}`);
    } finally {
      // P9 清理：只删本 flow 造的卡（Base URL 含 mock 端口），不动既有渠道；断言非本包卡计数不变
      try {
        const before = await evalRetry(client, `[...document.querySelectorAll('input[aria-label="Base URL"]')].filter(function(i){ return i.value.indexOf(':${MOCK_PORT}') < 0; }).length`).catch(() => -1);
        await armConfirmStub();
        let removed = 0;
        for (let i = 0; i < 3; i += 1) {
          pushAnswers(true); // 删除确认（必须先入队——click 同步触发 confirm）
          const hit = await evalRetry(client, `(function(){
            var inputs = [...document.querySelectorAll('input[aria-label="Base URL"]')].filter(function(x){ return x.value.indexOf(':${MOCK_PORT}') >= 0; });
            if (!inputs.length) return 'none';
            var card = inputs[0];
            for (var up = card; up && up !== document.body; up = up.parentElement) {
              var del = up.querySelector('[aria-label^="删除"]');
              if (del) { del.click(); return 'clicked'; }
            }
            return 'del_not_found';
          })()`);
          if (hit !== 'clicked') break;
          await sleep(600);
          removed += 1;
        }
        if (removed > 0) {
          pushAnswers(true); // 可能的保存确认兜底
          await clickByText(client, '保存');
          await sleep(800);
        }
        const after = await evalRetry(client, `[...document.querySelectorAll('input[aria-label="Base URL"]')].filter(function(i){ return i.value.indexOf(':${MOCK_PORT}') >= 0; }).length`).catch(() => -1);
        const othersAfter = await evalRetry(client, `[...document.querySelectorAll('input[aria-label="Base URL"]')].filter(function(i){ return i.value.indexOf(':${MOCK_PORT}') < 0; }).length`).catch(() => -1);
        assert('P9_cleanup_profile_removed', Number(after) === 0 && Number(othersAfter) === Number(before),
          `mockCardsLeft=${after} others ${before}->${othersAfter} removed=${removed}`);
      } catch (e) {
        assert('P9_cleanup_profile_removed', false, String(e && e.message || e).slice(0, 120));
      }
      try { mock.close(); } catch { /* 已退出 */ }
    }
    return true;
  },
};
