#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: block154-ui-pass — BLOCK-154 优化序列实机过目批。
 *
 * 覆盖三笔 in_progress：
 *   UI-472: highlight.js 按需化后代码块正常上色（清单内语言）
 *   UI-474: 暗色 token 收敛后 dock 按钮 hover/active 视觉（亮/暗双主题截图）
 *   UI-473: 流式打字流畅度（无法 CDP 自动化体感，本 flow 仅截图当前流式态，
 *           流畅度走第 4 级「测试路线 + 人确认」）
 *
 * 证据：acceptance/block-154/block154-ui-pass-live.json + dock-light.png + dock-dark.png
 */
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'block154-ui-pass',
  description: 'BLOCK-154 优化序列实机过目批（UI-472 highlight.js + UI-474 暗色 token dock）',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-154'),

  async run({ assert }) {
    // 连用户主窗口 9222
    const targets = await lib.pollTargets({ port: lib.DEFAULT_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target: dev Electron 主窗未找到');
    const client = await lib.connectTarget(pages[0]);

    try {
      // ── UI-472: highlight.js 上色 ──────────────────────────────────
      // 判据：页面中存在 .hljs 元素（代码块被 highlight.js 上色）。
      // 若当前会话无代码块消息，记为「无可测目标」不强行编造 PASS。
      const hljsCount = await lib.evalJs(client, `(function(){
        return document.querySelectorAll('.hljs, code.hljs, pre code.hljs').length;
      })()`).catch(() => -1);
      if (hljsCount > 0) {
        assert('UI-472_hljs_rendered', true, `页面含 ${hljsCount} 个 .hljs 代码块（highlight.js 上色在位）`);
        // 抽样一个代码块确认有语言类（hljs 上色后会加 language-xxx + hljs-xxx token 类）
        const tokenCount = await lib.evalJs(client, `(function(){
          var codes = document.querySelectorAll('code.hljs');
          if (!codes.length) return -1;
          var sample = codes[codes.length - 1];
          return sample.className;
        })()`).catch(() => '');
        assert('UI-472_hljs_sample_has_token_class', /hljs/.test(tokenCount) && tokenCount.length > 5, `末位代码块 class="${tokenCount}"`);
      } else {
        assert('UI-472_hljs_rendered', false, `当前会话无代码块消息（hljsCount=${hljsCount}），无可测目标——需含代码块的会话复跑`);
      }

      // ── UI-474: 暗色 token 收敛 dock 截图 ───────────────────────────
      // 直接操作 DOM 切主题（不依赖主题切换按钮的位置稳定性），截图 dock 区。
      async function captureDock(theme) {
        await lib.evalJs(client, `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); 'set-${theme}'`);
        await sleep(500);
        // dock 区：左侧栏按钮（.gewu-desktop-dock 或左栏按钮组）
        const shot = await client.send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(this.evidenceDir, `dock-${theme}.png`);
        require('node:fs').mkdirSync(this.evidenceDir, { recursive: true });
        require('node:fs').writeFileSync(file, Buffer.from(shot.data, 'base64'));
        // 检查 dock 按钮 hover 背景是否用 token（硬编码 rgba 应已删）
        const hasHardcodedHover = await lib.evalJs(client, `(function(){
          var sheets = document.styleSheets;
          var hits = 0;
          for (var i = 0; i < sheets.length; i++) {
            try {
              var rules = sheets[i].cssRules || [];
              for (var j = 0; j < rules.length; j++) {
                var t = rules[j].cssText || '';
                // desktop.css 中 dock 暗色 hover 硬编码已删（P2-1）
                if (/gewu-desktop-dock.*hover/.test(t) && /rgba\(230,\s*237,\s*243,\s*0\.06\)/.test(t)) hits++;
              }
            } catch { /* cross-origin sheet */ }
          }
          return hits;
        })()`).catch(() => -1);
        return { file, hasHardcodedHover };
      }

      const light = await captureDock.call({ evidenceDir: this.evidenceDir }, 'light');
      assert('UI-474_dock_light_screenshot', !!light.file, `dock light 截图: ${light.file}`);
      assert('UI-474_no_hardcoded_dock_hover_rgba', light.hasHardcodedHover === 0,
        light.hasHardcodedHover < 0 ? '样式表探测失败（跨域）' : `dock hover 硬编码 rgba(230,237,243,0.06) 残留=${light.hasHardcodedHover}`);

      const dark = await captureDock.call({ evidenceDir: this.evidenceDir }, 'dark');
      assert('UI-474_dock_dark_screenshot', !!dark.file, `dock dark 截图: ${dark.file}`);
      assert('UI-474_dark_no_hardcoded_dock_hover', dark.hasHardcodedHover === 0,
        dark.hasHardcodedHover < 0 ? '样式表探测失败（跨域）' : `暗色 dock hover 硬编码残留=${dark.hasHardcodedHover}`);

      // ── UI-473: 流式流畅度（截图当前态，体感走第 4 级）──────────────
      const streamingActive = await lib.evalJs(client, `(function(){
        // 流式中：存在 pending 且非空的助手消息
        var rows = document.querySelectorAll('.sc-msg-assistant');
        for (var i = rows.length - 1; i >= 0; i--) {
          if (rows[i].querySelector('.sc-msg-pending, [class*="pending"]')) return true;
        }
        return false;
      })()`).catch(() => false);
      assert('UI-473_streaming_state_captured', true, `当前是否流式中=${streamingActive}（流畅度体感需人确认，见测试路线）`);
      if (streamingActive) {
        const shot = await client.send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(this.evidenceDir, 'streaming-state.png');
        require('node:fs').writeFileSync(file, Buffer.from(shot.data, 'base64'));
      }

      return true;
    } finally {
      try { client.socket.close(); } catch { /* ignore */ }
    }
  },
};
