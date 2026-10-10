#!/usr/bin/env node
/* 只读 UI 探针：实测对比度 / 焦点样式 / 触控目标尺寸 / 语义化缺失
 * 用法：node scripts/ui-audit-probe.cjs [route]
 * 前置：dev Electron 在跑，CDP 9222 已开，vite :3000 在跑
 * 本脚本只读取 DOM，不做任何修改。
 */
const WebSocket = require('ws');
const http = require('http');

const ROUTE = process.argv[2] || '/';
const PORT = 9222;

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const targets = await httpJson(`http://localhost:${PORT}/json`);
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const msgId = ++id;
    pending.set(msgId, { res, rej });
    ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
  });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  });
  await new Promise((r) => ws.on('open', r));

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
    return r.result.value;
  };

  // 软导航：history.pushState + 手工派发 popstate（react-router 监听它）
  // 不用 Page.navigate，也不用 location.href= —— 后者会触发欢迎页 auto-navigate 弹回 allProjects[0]
  await evalJs(`(() => { history.pushState({}, '', ${JSON.stringify(ROUTE)}); window.dispatchEvent(new PopStateEvent('popstate')); return location.pathname; })()`);
  await new Promise((r) => setTimeout(r, 2500));

  const probe = await evalJs(`(() => {
    const out = {};

    // ---- 1. 对比度实测：解析所有可见文本节点的实际前景/背景 ----
    function parseRGB(s) {
      const m = String(s).match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    function lum({ r, g, b }) {
      const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function bgOf(el) {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parseRGB(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.05) return c;
        n = n.parentElement;
      }
      return parseRGB(getComputedStyle(document.body).backgroundColor) || { r:255,g:255,b:255,a:1 };
    }
    function ratio(fg, bg) {
      const l1 = lum(fg), l2 = lum(bg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }
    const seen = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) {
      const txt = (t.textContent || '').trim();
      if (txt.length < 2) continue;
      const el = t.parentElement;
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.3) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const fg = parseRGB(cs.color);
      if (!fg) continue;
      const bg = bgOf(el);
      const cr = ratio(fg, bg);
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      const key = cs.color + '|' + cs.fontSize + '|' + weight;
      if (!seen.has(key)) {
        seen.set(key, { color: cs.color, fontSize: cs.fontSize, weight, cr: Math.round(cr * 100) / 100, need, large, sample: txt.slice(0, 22), cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '')).slice(0, 50), count: 1 });
      } else seen.get(key).count++;
    }
    out.contrast = [...seen.values()].sort((a, b) => a.cr - b.cr).slice(0, 18);

    // ---- 2. 焦点样式：真实 focus() 后再看 computed（静态读不到 :focus-visible）----
    const focusables = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')].filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return !(cs.display === 'none' || cs.visibility === 'hidden') && r.width >= 2 && r.height >= 2;
    });
    const prevFocus = document.activeElement;
    let realFocusRing = 0;
    const noRingSamples = [];
    for (const el of focusables.slice(0, 60)) {
      try { el.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
      if (document.activeElement !== el) continue;
      const cs = getComputedStyle(el);
      const hasOutline = cs.outlineStyle && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const hasShadow = cs.boxShadow && cs.boxShadow !== 'none' && !/^none/.test(cs.boxShadow);
      const hasBorderChange = false;
      if (hasOutline || hasShadow || hasBorderChange) realFocusRing++;
      else if (noRingSamples.length < 12) noRingSamples.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 55),
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 25),
        outline: cs.outlineStyle + ' ' + cs.outlineWidth,
        shadow: cs.boxShadow.slice(0, 40),
      });
      el.blur();
    }
    try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (e) {}
    out.focus = {
      totalFocusable: focusables.length,
      probed: Math.min(60, focusables.length),
      realFocusRing,
      noRingCount: Math.min(60, focusables.length) - realFocusRing,
      samples: noRingSamples,
    };

    // ---- 3. 触控/点击目标尺寸 ----
    const small = [];
    document.querySelectorAll('button, a[href], [role="button"], [role="tab"], input[type="checkbox"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (r.width < 2 || r.height < 2) return;
      if (r.width < 24 || r.height < 24) {
        small.push({ tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20), cls: String(el.className || '').slice(0, 45) });
      }
    });
    out.smallTargets = { count: small.length, samples: small.slice(0, 12) };

    // ---- 4. 语义化缺失 ----
    const divBtn = [...document.querySelectorAll('div,span')].filter((el) => {
      if (el.getAttribute('role')) return false;
      if (el.getAttribute('tabindex') !== null) return false;
      const onC = el.getAttribute('onclick');
      const r = el.getBoundingClientRect();
      return (onC || el.style.cursor === 'pointer') && r.width > 8 && r.height > 8;
    }).slice(0, 10).map((el) => ({ tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 25), cls: String(el.className || '').slice(0, 50) }));
    out.divAsButton = { count: divBtn.length, samples: divBtn };

    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.getBoundingClientRect().height > 0).map((h) => h.tagName + ':' + (h.textContent || '').trim().slice(0, 18));
    out.headings = headings.slice(0, 20);

    const inputsNoLabel = [...document.querySelectorAll('input:not([type=hidden]), textarea, select')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
      if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return false;
      if (el.closest('label')) return false;
      if (el.getAttribute('placeholder')) return false;
      if (el.getAttribute('title')) return false;
      return true;
    }).map((el) => ({ tag: el.tagName.toLowerCase(), type: el.type || '', cls: String(el.className || '').slice(0, 45) }));
    out.unlabeledInputs = { count: inputsNoLabel.length, samples: inputsNoLabel.slice(0, 10) };

    // ---- 5. 滚动容器可访问性 / 布局溢出 ----
    const de = document.documentElement;
    out.scroll = { scrollW: de.scrollWidth, clientW: de.clientWidth, overflowX: de.scrollWidth > de.clientWidth + 2 };

    // ---- 6. 动效：transition: all 与长动画 ----
    const transAll = [];
    const durations = {};
    document.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.transitionProperty === 'all' && cs.transitionDuration !== '0s') {
        const r = el.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) transAll.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 45), dur: cs.transitionDuration });
      }
      if (cs.animationName !== 'none' && cs.animationDuration !== '0s') {
        const r = el.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) durations[cs.animationName] = (durations[cs.animationName] || 0) + 1;
      }
    });
    out.transitionAll = { count: transAll.length, samples: transAll.slice(0, 8) };
    out.animations = durations;

    // ---- 7. reduced-motion 实际生效检查 ----
    out.forcedColors = getComputedStyle(document.body).forcedColorAdjust;

    return out;
  })()`);

  console.log(JSON.stringify({ route: ROUTE, ...probe }, null, 1));
  ws.close();
})().catch((e) => { console.error('PROBE_FAIL', e.message); process.exit(1); });