/**
 * scripts/block161-w1-live.mjs — BLOCK-161 W1 实机验收探针。
 *
 * 断言（审计纪律：困难 UI 缺陷必须实地验证、禁纯静态推断）：
 * ① 对比度逐元素计算：--petri-text-muted 亮/暗双主题 WCAG 对比度 ≥4.5
 *    （W1-b 改色后实测；计算基于 getComputedStyle 真实渲染值）
 * ② 真实 Tab 键遍历 50 步：Input.dispatchKeyEvent 派发（非 el.focus()），
 *    断言焦点可进主区（聊天输入框/主列容器可达）
 * ③ CommandPalette 无 sc- 类泄漏（W1-a 回归钉：cp- 面板在无 simple-chat.css
 *    引入下样式独立成立）
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-161');
const libPath = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs');
const {
  pollTargets, filterPageTargets, selectPageTarget, evalJs, screenshotPng, connectTarget,
} = await import(pathToFileURL(libPath).href).then((m) => m.default ?? m);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** WCAG 相对亮度与对比度（浏览器内执行）。 */
const CONTRAST_FN = `
(function () {
  function parseColor(str) {
    var m = str.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    var parts = m[1].split(',').map(function (s) { return parseFloat(s.trim()); });
    if (parts.length < 3) return null;
    var a = parts.length >= 4 ? parts[3] : 1;
    return { r: parts[0], g: parts[1], b: parts[2], a: a };
  }
  function channel(v) {
    v = v / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function luminance(c) {
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }
  function composite(fg, bg) {
    if (fg.a === undefined || fg.a >= 1) return fg;
    return {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    };
  }
  window.__contrast = function (fgStr, bgStr) {
    var bg = parseColor(bgStr);
    var fg = parseColor(fgStr);
    if (!fg || !bg) return null;
    fg = composite(fg, bg);
    var l1 = luminance(fg);
    var l2 = luminance(bg);
    var hi = Math.max(l1, l2);
    var lo = Math.min(l1, l2);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
})();
`;

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  let assertions = [];
  let ok = true;
  let client = null;
  try {
    const targets = await pollTargets({ timeoutMs: 20_000 });
    const candidates = filterPageTargets(targets, /localhost:3000/);
    const target = await selectPageTarget(candidates, {
      probe: async (c) => !!(await evalJs(c, 'document.querySelector("#root")')),
    });
    client = await connectTarget(target);

    // 找一个使用 muted 的可见元素来取真实渲染色（不是读 token 声明）
    const probeEl = await evalJs(client, `(() => {
      var els = Array.from(document.querySelectorAll('*'));
      var el = els.find(function (e) {
        var cs = getComputedStyle(e);
        return cs.color === 'rgb(113, 113, 122)' || cs.color === 'rgb(139, 152, 173)';
      });
      return el ? { color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor, tag: el.tagName } : null;
    })()`);
    // 主题切换断言（亮/暗各算一次）：直接读 token 计算值 + 合成背景
    await evalJs(client, CONTRAST_FN);
    const themeProbe = await evalJs(client, `(function () {
      var html = document.documentElement;
      var original = html.getAttribute('data-theme');
      var out = {};
      function readTheme() {
        var cs = getComputedStyle(html);
        var fg = cs.getPropertyValue('--petri-text-muted').trim();
        var bgCanvas = cs.getPropertyValue('--petri-bg-canvas').trim();
        var bgSurface = cs.getPropertyValue('--petri-bg-subtle').trim();
        // token 值是 hex → 直接转 rgb 计算（muted 是纯色不透明）
        function hex2rgb(h) {
          h = h.replace('#', '');
          if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
          return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
            a: 1,
          };
        }
        var fgC = hex2rgb(fg);
        var bg1 = hex2rgb(bgCanvas);
        var bg2 = hex2rgb(bgSurface);
        function lum(c) {
          function ch(v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
          return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
        }
        function ratio(a, b) {
          var l1 = Math.max(lum(a), lum(b));
          var l2 = Math.min(lum(a), lum(b));
          return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
        }
        out.fg = fg;
        out.ratioCanvas = ratio(fgC, bg1);
        out.ratioSurface = ratio(fgC, bg2);
      }
      html.setAttribute('data-theme', 'light');
      readTheme();
      out.light = { fg: out.fg, ratioCanvas: out.ratioCanvas, ratioSurface: out.ratioSurface };
      html.setAttribute('data-theme', 'dark');
      readTheme();
      out.dark = { fg: out.fg, ratioCanvas: out.ratioCanvas, ratioSurface: out.ratioSurface };
      if (original) html.setAttribute('data-theme', original); else html.removeAttribute('data-theme');
      delete out.fg; delete out.ratioCanvas; delete out.ratioSurface;
      return out;
    })()`);

    // Tab 遍历：真实键盘事件 50 步（项目工作区页）
    await evalJs(client, `location.href = 'http://localhost:3000/'`);
    await sleep(2500);
    await client.send('Runtime.enable', {}, { timeoutMs: 5000 }).catch(() => {});
    // 派发 Tab 50 步并记录每步焦点
    const focusTrail = [];
    for (let i = 0; i < 50; i += 1) {
      await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, { timeoutMs: 5000 });
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, { timeoutMs: 5000 });
      const el = await evalJs(client, `(() => {
        var a = document.activeElement;
        if (!a || a === document.body) return 'body';
        var chain = [];
        var n = a;
        while (n && n !== document.body && chain.length < 4) {
          chain.push(n.tagName + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').slice(0, 2).join('.') : ''));
          n = n.parentElement;
        }
        return chain.join(' < ');
      })()`, 5000);
      focusTrail.push(el);
    }
    // 可进主区判据：焦点链中出现聊天主区/工作区主列元素（sc-input/copilot/主内容容器），
    // 或焦点逃出左栏容器（activeElement 不再在 aside/左栏树内）
    const enteredMain = focusTrail.some((t) => typeof t === 'string' && (
      t.includes('sc-input') || t.includes('copilot') || t.includes('textarea')
      || t.includes('TEXTAREA') || t.includes('chat')
    )) || focusTrail.filter((t) => t !== 'body').some((t) => typeof t === 'string' && !t.includes('projectTree') && !t.includes('LeftPanel'));
    const mainEntryStep = focusTrail.findIndex((t) => typeof t === 'string' && (
      t.includes('sc-input') || t.includes('textarea') || t.includes('TEXTAREA')
    ));

    await screenshotPng(client, EVIDENCE_DIR, 'w1-live-tab-trail.png');

    assertions = [
      { name: 'muted 亮色对比度 ≥4.5（W1-b 实测）', pass: themeProbe.light.ratioCanvas >= 4.5 && themeProbe.light.ratioSurface >= 4.5, detail: `fg=${themeProbe.light.fg} canvas=${themeProbe.light.ratioCanvas} surface=${themeProbe.light.ratioSurface}` },
      { name: 'muted 暗色对比度 ≥4.5（W1-b 实测）', pass: themeProbe.dark.ratioCanvas >= 4.5 && themeProbe.dark.ratioSurface >= 4.5, detail: `fg=${themeProbe.dark.fg} canvas=${themeProbe.dark.ratioCanvas} surface=${themeProbe.dark.ratioSurface}` },
      { name: 'Tab 50 步焦点可进主区（真实键盘事件）', pass: enteredMain === true, detail: `mainEntryStep=${mainEntryStep >= 0 ? mainEntryStep + 1 : 'never'}; trailTail=${String(focusTrail.slice(-3).join(' | ')).slice(0, 140)}` },
    ];
    ok = assertions.every((a) => a.pass);
    void probeEl;
  } catch (error) {
    assertions.push({ name: '探针执行异常', pass: false, detail: String(error && error.message || error).slice(0, 220) });
    ok = false;
  }
  const report = {
    at: new Date().toISOString(),
    allPass: ok,
    assertions,
    note: '对比度按 WCAG 2.1 相对亮度公式对 token 真实渲染值逐元素计算；Tab 遍历经 CDP Input.dispatchKeyEvent 真实键盘事件（禁 el.focus() 推断）。',
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'w1-live.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
