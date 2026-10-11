/**
 * src/main/gen-ui/guest-bridge.js
 *
 * BLOCK-166 [D 层] guest 桥（D6 简化传输）：petri 化自 ZCode standalone-host-bridge.js
 * （对照原名 zcode → petri；原事件 zcode:set_globals → petri:set_globals）。
 *
 * GUEST_BRIDGE_FN 是真实函数体：壳拼装时序列化（Function.toString）内联进沙箱页，
 * Node 侧测试（test/block166-gen-ui-guest-bridge.test.mjs）以最小 DOM 桩直接执行
 * 同一函数体——测的就是浏览器里要跑的那份代码。桥运行在沙箱 iframe 内（无 Node、
 * 无 preload），所有宿主能力都经 postMessage RPC 由父页（GenUiCard）转 IPC：
 *   guest → parent: { type:'petri-gen-ui-rpc', id, method, params }（targetOrigin=hostOrigin）
 *   parent → guest: { type:'petri-gen-ui-rpc-result', id, ok, payload }
 *   parent → guest: { type:'petri-set-globals', detail:{ globals:{ theme?, widgetState? } } }
 * 方法面（P1）：petri/gen-ui/state（widgetState 内存版，≤16KiB，宿主 ack 后 resolve，
 * 禁 load 自动保存）、petri/gen-ui/open-external（绝对 http(s) 白名单 + 原生手势预检）。
 * follow-up（P2）与 Tweak（登记候选）不在本版。
 */

const GUEST_BRIDGE_FN = function petriGenUiGuestBridge(config) {
  'use strict';
  var hostOrigin = config && typeof config.hostOrigin === 'string' ? config.hostOrigin : '';
  var MAX_STATE_BYTES = 16 * 1024;
  var encoder = new TextEncoder();

  function deepCopy(value) {
    return value === null ? null : JSON.parse(JSON.stringify(value));
  }

  function normalizeState(value) {
    var next = { modelContent: null, privateContent: null };
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) next[key] = value[key];
      }
    }
    return next;
  }

  var state = null;
  try {
    var initialEl = document.getElementById('petri-gen-ui-initial-state');
    var parsedInitial = JSON.parse(initialEl ? initialEl.textContent : 'null');
    if (parsedInitial !== null && typeof parsedInitial === 'object' && !Array.isArray(parsedInitial)) {
      state = normalizeState(parsedInitial);
    }
  } catch { state = null; }

  function currentTheme() {
    return document.documentElement.dataset.theme || '';
  }

  function dispatchGlobals() {
    try {
      window.dispatchEvent(new CustomEvent('petri:set_globals', {
        detail: { globals: { widgetState: deepCopy(state), theme: currentTheme() } },
      }));
    } catch { /* 投影失败不影响页面 */ }
  }

  function applyGlobals(globals) {
    if (!globals || typeof globals !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(globals, 'widgetState')) {
      var next = globals.widgetState;
      state = next !== null && typeof next === 'object' && !Array.isArray(next) ? normalizeState(next) : null;
    }
    if (globals.theme === 'dark' || globals.theme === 'light') {
      document.documentElement.dataset.theme = globals.theme;
      document.documentElement.style.colorScheme = globals.theme;
    }
    dispatchGlobals();
  }

  var rpcSeq = 0;
  var pendingRpc = new Map();
  function postToParent(message) {
    try { window.parent.postMessage(message, hostOrigin || '*'); } catch { /* noop */ }
  }
  function postRpc(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++rpcSeq;
      var timer = setTimeout(function () {
        pendingRpc.delete(id);
        reject(new Error('gen-ui host rpc timeout: ' + method));
      }, 15000);
      pendingRpc.set(id, { resolve: resolve, reject: reject, timer: timer });
      postToParent({ type: 'petri-gen-ui-rpc', id: id, method: method, params: params });
    });
  }

  window.addEventListener('message', function (event) {
    if (!event || event.source !== window.parent) return;
    if (hostOrigin && event.origin !== hostOrigin) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'petri-set-globals') {
      applyGlobals(data.detail && data.detail.globals);
      return;
    }
    if (data.type === 'petri-gen-ui-rpc-result' && typeof data.id === 'number') {
      var pending = pendingRpc.get(data.id);
      if (!pending) return;
      pendingRpc.delete(data.id);
      clearTimeout(pending.timer);
      if (data.ok === true) pending.resolve(data.payload);
      else pending.reject(new Error((data.payload && data.payload.message) || 'gen-ui host rpc failed'));
    }
  });

  function validateStateUpdate(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('widget state must be a JSON object');
    }
    var serialized;
    try {
      serialized = JSON.stringify(value, function (_key, v) {
        if (v === undefined || typeof v === 'function' || typeof v === 'symbol'
          || (typeof v === 'number' && !isFinite(v))) {
          throw new TypeError('widget state must be a JSON object');
        }
        return v;
      });
    } catch {
      throw new TypeError('widget state must be a JSON object');
    }
    if (serialized === undefined) throw new TypeError('widget state must be a JSON object');
    if (encoder.encode(serialized).length > MAX_STATE_BYTES) {
      throw new TypeError('widget state must be a JSON object of at most 16 KiB');
    }
    return JSON.parse(serialized);
  }

  function isAllowedHref(href) {
    try {
      var url = new URL(href);
      return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
    } catch { return false; }
  }

  var saves = Promise.resolve();
  var api = {};
  Object.defineProperties(api, {
    widgetState: {
      enumerable: true,
      get: function () { return deepCopy(state); },
    },
    setWidgetState: {
      enumerable: true,
      value: function (value) {
        var next = normalizeState(validateStateUpdate(value));
        var pending = saves
          .catch(function () {})
          .then(function () {
            state = next;
            dispatchGlobals();
            return postRpc('petri/gen-ui/state', { state: next });
          });
        saves = pending;
        return pending;
      },
    },
    openExternal: {
      enumerable: true,
      value: function (value) {
        var keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : null;
        if (!keys || keys.length !== 1 || keys[0] !== 'href' || typeof value.href !== 'string') {
          return Promise.reject(new TypeError('openExternal expects { href: string }'));
        }
        if (!isAllowedHref(value.href)) {
          return Promise.reject(new Error('external link rejected: absolute http(s) URL required'));
        }
        if (!(navigator.userActivation && navigator.userActivation.isActive === true)) {
          return Promise.reject(new Error('external link requires a user gesture'));
        }
        return postRpc('petri/gen-ui/open-external', { href: value.href });
      },
    },
    sendFollowUpMessage: {
      enumerable: true,
      value: function (value) {
        var keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : null;
        if (!keys || keys.length < 1 || keys.length > 2 || keys.indexOf('prompt') === -1
          || (keys.length === 2 && keys.indexOf('title') === -1)) {
          return Promise.reject(new TypeError('sendFollowUpMessage expects { prompt: string, title?: string }'));
        }
        var prompt = value.prompt;
        if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > 8000) {
          return Promise.reject(new TypeError('sendFollowUpMessage prompt must be a non-empty string of at most 8000 chars'));
        }
        var title = value.title;
        if (title !== undefined && (keys.length !== 2 || keys.indexOf('title') === -1 || typeof title !== 'string' || title.length > 250)) {
          return Promise.reject(new TypeError('sendFollowUpMessage title must be a string of at most 250 chars'));
        }
        if (!(navigator.userActivation && navigator.userActivation.isActive === true)) {
          return Promise.reject(new Error('follow-up requires a user gesture'));
        }
        return postRpc('petri/gen-ui/follow-up', { prompt: prompt, title: title });
      },
    },
  });
  Object.freeze(api);
  Object.defineProperty(window, 'petri', { value: api, writable: false, configurable: false });

  document.addEventListener('click', onAnchorClick);
  document.addEventListener('auxclick', onAnchorClick);
  function onAnchorClick(event) {
    if (event.defaultPrevented) return;
    if (event.button !== 0 && event.button !== 1) return;
    var node = event.target;
    if (!node || typeof node.closest !== 'function') return;
    var anchor = node.closest('a[href]');
    if (!anchor) return;
    var href = (anchor.getAttribute('href') || '').trim();
    if (!href) return;
    event.preventDefault();
    if (!event.isTrusted || anchor.hasAttribute('download')) return;
    if (href.charAt(0) === '#') {
      var id = href.slice(1);
      try { id = decodeURIComponent(id); } catch { return; }
      if (id.length === 0) { window.scrollTo(0, 0); return; }
      var target = document.getElementById(id);
      if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView();
      return;
    }
    api.openExternal({ href: href }).catch(function () { /* 主进程裁决拒绝即静默 */ });
  }

  var tooltipEl = null;
  var tooltipTarget = null;
  function hideTooltip() {
    tooltipTarget = null;
    if (tooltipEl) tooltipEl.style.display = 'none';
  }
  function showTooltip(target) {
    var text = target.getAttribute('data-tooltip');
    if (!text) return;
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.setAttribute('role', 'tooltip');
      tooltipEl.setAttribute('class', 'tooltip');
      document.body.appendChild(tooltipEl);
    }
    tooltipEl.textContent = text;
    tooltipEl.style.display = 'block';
    tooltipTarget = target;
    var floating = window.FloatingUI;
    if (floating && typeof floating.computePosition === 'function') {
      try {
        Promise.resolve(floating.computePosition(target, tooltipEl, {})).then(function (pos) {
          if (tooltipTarget !== target || !pos) return;
          tooltipEl.style.left = pos.x + 'px';
          tooltipEl.style.top = pos.y + 'px';
        }).catch(function () { /* 定位失败保持默认位 */ });
      } catch { /* 降级绝对定位 */ }
    } else {
      var rect = target.getBoundingClientRect();
      tooltipEl.style.left = Math.max(4, rect.left) + 'px';
      tooltipEl.style.top = Math.max(4, rect.top - 28) + 'px';
    }
  }
  document.addEventListener('pointerover', function (event) {
    var node = event.target;
    if (!node || typeof node.closest !== 'function') { hideTooltip(); return; }
    var hit = node.closest('[data-tooltip]');
    if (hit) showTooltip(hit); else hideTooltip();
  });
  document.addEventListener('focusin', function (event) {
    var node = event.target;
    if (!node || typeof node.closest !== 'function') return;
    var hit = node.closest('[data-tooltip]');
    if (hit) showTooltip(hit);
  });
  window.addEventListener('blur', hideTooltip);

  function showFatal(message) {
    var bar = document.getElementById('petri-gen-ui-fatal');
    if (!bar) {
      bar = document.createElement('div');
      bar.setAttribute('id', 'petri-gen-ui-fatal');
      bar.setAttribute('role', 'alert');
      bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:8px 12px;'
        + 'background:var(--destructive,#ef4444);color:#fff;font-size:12px;font-family:system-ui,sans-serif';
      document.body.appendChild(bar);
    }
    bar.textContent = message;
  }
  // 仅资源加载错误（target 为 SCRIPT）触发；运行时异常不劫持（坑 1：明确失败不白屏）
  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (!target || target.tagName !== 'SCRIPT') return;
    showFatal('可视化脚本加载失败（离线映射缺失或校验不符）: ' + (target.src || '(inline)'));
  }, true);

  var lastHeight = 0;
  var lastViewport = 0;
  var heightTimer = 0;
  function reportHeight() {
    heightTimer = 0;
    var rect = document.body.getBoundingClientRect();
    var height = Math.ceil(Math.max(rect.height, document.body.scrollHeight || 0));
    var viewport = window.innerHeight || 0;
    var heightDelta = Math.abs(height - lastHeight);
    var viewportDelta = Math.abs(viewport - lastViewport);
    lastHeight = height;
    lastViewport = viewport;
    if (heightDelta > 0 && Math.abs(heightDelta - viewportDelta) <= 2 && viewportDelta > 0) return;
    postToParent({ type: 'petri-gen-ui-height', height: height });
  }
  function scheduleHeight() {
    if (!heightTimer) heightTimer = setTimeout(reportHeight, 16);
  }
  if (typeof ResizeObserver === 'function') {
    var resizeObserver = new ResizeObserver(scheduleHeight);
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(document.body);
  }
  window.addEventListener('resize', scheduleHeight);
  window.addEventListener('load', scheduleHeight);
  reportHeight();

  dispatchGlobals();
  if (document.currentScript && document.currentScript.parentNode) {
    document.currentScript.parentNode.removeChild(document.currentScript);
  }
};

const SCRIPT_HEAD = '<script>';
const SCRIPT_TAIL = '</' + 'script>';

/** 序列化桥调用：配置以 JSON 内联（< > 转义防 script 上下文逃逸）。 */
function buildGuestBridgeScript(config) {
  const configJson = JSON.stringify(config || {})
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  return `${SCRIPT_HEAD}(${GUEST_BRIDGE_FN.toString()})(${configJson});${SCRIPT_TAIL}`;
}

module.exports = { GUEST_BRIDGE_FN, buildGuestBridgeScript };
