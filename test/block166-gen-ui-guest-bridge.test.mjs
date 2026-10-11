/**
 * BLOCK-166 P1 guest 桥单测（plan §5-P1 门禁：方法分发/参数校验/16KiB 上限/
 * 禁 load 自动保存/主题事件/openExternal 白名单/data-tooltip）。
 *
 * 桥函数以真实函数体序列化进沙箱壳（壳侧只做字符串拼接）；本文件在 Node 里
 * 用最小 DOM 桩直接执行同一函数体，验证的是将要在浏览器里跑的那份代码。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { GUEST_BRIDGE_FN } from '../src/main/gen-ui/guest-bridge.js';

const HOST_ORIGIN = 'http://localhost:3000';
const SANDBOX_ORIGIN = 'petri-genui://gen-test';

/** 最小 DOM 桩：只实现桥函数触到的面。 */
function createEnv({ initialState = null, activation = true, floatingUI = false } = {}) {
  const listeners = { window: new Map(), document: new Map() };
  const postedToParent = [];
  const dispatchedEvents = [];
  const scrolledTo = [];

  function makeElement(tag) {
    const el = {
      tagName: String(tag || 'DIV').toUpperCase(),
      children: [],
      attributes: {},
      style: { setProperty() {} },
      dataset: {},
      textContent: '',
      id: '',
      setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
      hasAttribute(k) { return k in this.attributes; },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener(type, fn) {
        const key = `${this.tagName}:${type}`;
        if (!listeners.document.has(key)) listeners.document.set(key, []);
        listeners.document.get(key).push(fn);
      },
      removeEventListener() {},
      closest() { return null; },
      getBoundingClientRect() { return { top: 0, left: 0, right: 100, bottom: 24, width: 100, height: 24 }; },
      scrollIntoView() { scrolledTo.push(this.id || this.textContent || null); },
    };
    return el;
  }

  const htmlEl = makeElement('HTML');
  const bodyEl = makeElement('BODY');
  const stateEl = makeElement('SCRIPT');
  stateEl.id = 'petri-gen-ui-initial-state';
  stateEl.textContent = JSON.stringify(initialState);
  const elementsById = new Map([['petri-gen-ui-initial-state', stateEl]]);

  const documentStub = {
    readyState: 'complete',
    documentElement: htmlEl,
    body: bodyEl,
    currentScript: null,
    // DOM 语义：不存在的 id 返回 null；需要目标元素时用 env.registerElement 预登记。
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    createElement(tag) { return makeElement(tag); },
    addEventListener(type, fn) {
      if (!listeners.document.has(type)) listeners.document.set(type, []);
      listeners.document.get(type).push(fn);
    },
    removeEventListener() {},
  };

  const windowStub = {
    parent: { postMessage: (msg, targetOrigin) => postedToParent.push({ msg, targetOrigin }) },
    addEventListener(type, fn) {
      if (!listeners.window.has(type)) listeners.window.set(type, []);
      listeners.window.get(type).push(fn);
    },
    removeEventListener() {},
    dispatchEvent(event) { dispatchedEvents.push(event); return true; },
    FloatingUI: floatingUI ? { computePosition: async () => ({ x: 10, y: 10 }) } : undefined,
  };

  const savedDescriptors = {};
  for (const key of ['document', 'window', 'navigator', 'CustomEvent', 'ResizeObserver']) {
    savedDescriptors[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  }
  const setGlobal = (key, value) => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  setGlobal('document', documentStub);
  setGlobal('window', windowStub);
  setGlobal('navigator', { userActivation: { isActive: activation } });
  setGlobal('CustomEvent', class CustomEvent {
    constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; }
  });
  setGlobal('ResizeObserver', class ResizeObserver { observe() {} disconnect() {} unobserve() {} });

  const restore = () => {
    for (const key of Object.keys(savedDescriptors)) {
      const descriptor = savedDescriptors[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };

  return {
    listeners, postedToParent, dispatchedEvents, scrolledTo,
    htmlEl, bodyEl, window: windowStub, document: documentStub,
    registerElement(id) {
      const el = makeElement('DIV');
      el.id = id;
      elementsById.set(id, el);
      return el;
    },
    /** 执行桥函数（真实函数体）。 */
    run() { GUEST_BRIDGE_FN({ hostOrigin: HOST_ORIGIN, sandboxOrigin: SANDBOX_ORIGIN }); },
    /** 等待桥的 saves 微任务链落地（postRpc 是两级 then，宏任务级 flush 最稳）。 */
    flushAsync() { return new Promise((resolve) => setImmediate(resolve)); },
    /** 模拟 parent → guest 消息。 */
    emitFromParent(data, origin = HOST_ORIGIN) {
      const fns = listeners.window.get('message') || [];
      for (const fn of fns) fn({ source: windowStub.parent, origin, data });
    },
    /** 模拟 guest 文档级事件。 */
    emitDocument(type, event) {
      const fns = listeners.document.get(type) || [];
      for (const fn of fns) fn(event);
    },
    /** 模拟 window 级事件（如 capture error）。 */
    emitWindow(type, event) {
      const fns = listeners.window.get(type) || [];
      for (const fn of fns) fn(event);
    },
    restore,
  };
}

function rpcMessages(env) {
  return env.postedToParent.filter((p) => p.msg && p.msg.type === 'petri-gen-ui-rpc');
}

test('桥安装：window.petri 冻结在场 + 初始状态投影 + 禁 load 自动保存', () => {
  const env = createEnv({ initialState: { modelContent: { n: 7 }, privateContent: { ui: 1 } } });
  try {
    env.run();
    const api = env.window.petri;
    assert.ok(api, 'window.petri installed');
    assert.equal(Object.isFrozen(api), true, 'api frozen');
    assert.deepEqual(api.widgetState, { modelContent: { n: 7 }, privateContent: { ui: 1 } });
    assert.deepEqual(
      env.dispatchedEvents.filter((e) => e.type === 'petri:set_globals').length >= 1, true,
      'initial petri:set_globals dispatched',
    );
    // 禁 load 自动保存（坑 6）：安装路径只允许高度回报，不允许 state RPC。
    assert.equal(rpcMessages(env).length, 0, 'no state RPC during install');
    const heightMsgs = env.postedToParent.filter((p) => p.msg && p.msg.type === 'petri-gen-ui-height');
    assert.equal(heightMsgs.length, 1, 'height report still works');
  } finally { env.restore(); }
});

test('setWidgetState：合法对象走 RPC → ack 后 resolve；本地快照同步投影', async () => {
  const env = createEnv({ initialState: null });
  try {
    env.run();
    const api = env.window.petri;
    const promise = api.setWidgetState({ modelContent: { n: 1 } });
    await env.flushAsync(); // saves 链在微任务里发 RPC，宏任务级 flush 最稳
    const msgs = rpcMessages(env);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].msg.method, 'petri/gen-ui/state');
    assert.deepEqual(msgs[0].msg.params.state, { modelContent: { n: 1 }, privateContent: null });
    assert.deepEqual(api.widgetState, { modelContent: { n: 1 }, privateContent: null });
    // parent ack（宿主持久化成功后才 resolve——坑 6）
    env.emitFromParent({ type: 'petri-gen-ui-rpc-result', id: msgs[0].msg.id, ok: true, payload: {} });
    await promise;
  } finally { env.restore(); }
});

test('setWidgetState：ack 失败（ok=false）reject', async () => {
  const env = createEnv({});
  try {
    env.run();
    const promise = env.window.petri.setWidgetState({ modelContent: {} });
    await env.flushAsync();
    const msgs = rpcMessages(env);
    env.emitFromParent({ type: 'petri-gen-ui-rpc-result', id: msgs[0].msg.id, ok: false, payload: { message: 'denied' } });
    await assert.rejects(promise, /denied/);
  } finally { env.restore(); }
});

test('setWidgetState：>16KiB 拒绝且不发 RPC', () => {
  const env = createEnv({});
  try {
    env.run();
    assert.throws(() => env.window.petri.setWidgetState({ blob: 'x'.repeat(17 * 1024) }), /16 KiB/);
    assert.equal(rpcMessages(env).length, 0);
  } finally { env.restore(); }
});

test('setWidgetState：非对象/数组/非 JSON 值拒绝', () => {
  const env = createEnv({});
  try {
    env.run();
    assert.throws(() => env.window.petri.setWidgetState(null), /JSON object/);
    assert.throws(() => env.window.petri.setWidgetState([1, 2]), /JSON object/);
    assert.throws(() => env.window.petri.setWidgetState('str'), /JSON object/);
    assert.throws(() => env.window.petri.setWidgetState({ fn: () => 1 }), /JSON/);
  } finally { env.restore(); }
});

test('openExternal：绝对 http(s) + 用户手势 → RPC；ack 后 resolve', async () => {
  const env = createEnv({ activation: true });
  try {
    env.run();
    const promise = env.window.petri.openExternal({ href: 'https://example.com/x' });
    await env.flushAsync();
    const msgs = rpcMessages(env);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].msg.method, 'petri/gen-ui/open-external');
    assert.deepEqual(msgs[0].msg.params, { href: 'https://example.com/x' });
    env.emitFromParent({ type: 'petri-gen-ui-rpc-result', id: msgs[0].msg.id, ok: true, payload: {} });
    await promise;
  } finally { env.restore(); }
});

test('openExternal：非 http(s) / 相对路径 / 坏形状本地拒绝且不发 RPC', () => {
  const env = createEnv({});
  try {
    env.run();
    await0(env.window.petri.openExternal({ href: 'javascript:alert(1)' }));
    await0(env.window.petri.openExternal({ href: 'data:text/html,x' }));
    await0(env.window.petri.openExternal({ href: 'file:///C:/x' }));
    await0(env.window.petri.openExternal({ href: '/relative' }));
    await0(env.window.petri.openExternal({ href: 42 }));
    await0(env.window.petri.openExternal({ href: 'https://a.com', extra: 1 }));
    assert.equal(rpcMessages(env).length, 0);
  } finally { env.restore(); }
});

test('openExternal：无用户手势拒绝（原生手势校验）', () => {
  const env = createEnv({ activation: false });
  try {
    env.run();
    await0(env.window.petri.openExternal({ href: 'https://example.com' }));
    assert.equal(rpcMessages(env).length, 0);
  } finally { env.restore(); }
});

test('主题事件：petri-set-globals 应用 data-theme/colorScheme 并广播 set_globals', () => {
  const env = createEnv({});
  try {
    env.run();
    const before = env.dispatchedEvents.length;
    env.emitFromParent({ type: 'petri-set-globals', detail: { globals: { theme: 'dark' } } });
    assert.equal(env.htmlEl.dataset.theme, 'dark');
    assert.equal(env.htmlEl.style.colorScheme, 'dark');
    assert.equal(env.dispatchedEvents.length, before + 1);
    assert.equal(env.dispatchedEvents[env.dispatchedEvents.length - 1].detail.globals.theme, 'dark');
  } finally { env.restore(); }
});

test('主题事件：origin 不符 / source 非父窗的伪造消息被忽略', () => {
  const env = createEnv({});
  try {
    env.run();
    env.emitFromParent({ type: 'petri-set-globals', detail: { globals: { theme: 'dark' } } }, 'https://evil.example');
    assert.equal(env.htmlEl.dataset.theme || '', '', 'forged origin ignored');
    // source 校验：非 window.parent 来源
    const fns = env.listeners.window.get('message') || [];
    for (const fn of fns) fn({ source: {}, origin: HOST_ORIGIN, data: { type: 'petri-set-globals', detail: { globals: { theme: 'dark' } } } });
    assert.equal(env.htmlEl.dataset.theme || '', '', 'non-parent source ignored');
  } finally { env.restore(); }
});

test('状态投影：宿主经 petri-set-globals 下发 widgetState 为唯一投影', () => {
  const env = createEnv({});
  try {
    env.run();
    env.emitFromParent({ type: 'petri-set-globals', detail: { globals: { widgetState: { modelContent: { n: 2 } } } } });
    assert.deepEqual(env.window.petri.widgetState, { modelContent: { n: 2 }, privateContent: null });
  } finally { env.restore(); }
});

test('锚点拦截：http 锚点 preventDefault + openExternal RPC；#fragment 页内滚动', () => {
  const env = createEnv({});
  try {
    env.run();
    env.registerElement('sec1'); // #fragment 滚动目标
    const anchor = {
      getAttribute: (k) => (k === 'href' ? 'https://example.com/doc' : null),
      hasAttribute: () => false,
    };
    const fakeTarget = { closest: (sel) => (sel === 'a[href]' ? anchor : null) };
    env.emitDocument('click', { defaultPrevented: false, button: 0, isTrusted: true, target: fakeTarget, preventDefault() { this.defaultPrevented = true; } });
    const msgs = rpcMessages(env);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].msg.method, 'petri/gen-ui/open-external');
    // ack 掉，避免 15s 超时定时器泄漏到测试之外
    env.emitFromParent({ type: 'petri-gen-ui-rpc-result', id: msgs[0].msg.id, ok: false, payload: { message: 'denied' } });

    const fragAnchor = { getAttribute: (k) => (k === 'href' ? '#sec1' : null), hasAttribute: () => false };
    const fragTarget = { closest: () => fragAnchor };
    env.emitDocument('click', { defaultPrevented: false, button: 0, isTrusted: true, target: fragTarget, preventDefault() {} });
    assert.equal(env.scrolledTo.length >= 1, true, '#fragment scrolls in page');
    assert.equal(rpcMessages(env).length, 1, '#fragment does not open external');
  } finally { env.restore(); }
});

test('锚点拦截：合成点击（isTrusted=false）不外发', () => {
  const env = createEnv({});
  try {
    env.run();
    const anchor = { getAttribute: (k) => (k === 'href' ? 'https://example.com' : null), hasAttribute: () => false };
    env.emitDocument('click', { defaultPrevented: false, button: 0, isTrusted: false, target: { closest: () => anchor }, preventDefault() {} });
    assert.equal(rpcMessages(env).length, 0);
  } finally { env.restore(); }
});

test('data-tooltip：hover 建立角色 tooltip 并写入文本；移开隐藏', () => {
  const env = createEnv({});
  try {
    env.run();
    const tipTarget = {
      getAttribute: (k) => (k === 'data-tooltip' ? '你好提示' : null),
      closest: (sel) => (sel === '[data-tooltip]' ? tipTarget : null),
      getBoundingClientRect() { return { top: 10, left: 10, bottom: 30, right: 60, width: 50, height: 20 }; },
    };
    env.emitDocument('pointerover', { target: tipTarget });
    const tip = env.bodyEl.children.find((c) => c.attributes.role === 'tooltip');
    assert.ok(tip, 'tooltip element created');
    assert.equal(tip.textContent, '你好提示');
    env.emitDocument('pointerover', { target: { closest: () => null } });
    assert.equal(tip.style.display, 'none', 'hidden after leaving');
  } finally { env.restore(); }
});

test('脚本加载失败：capture error 呈现明确失败横幅（不白屏）', () => {
  const env = createEnv({});
  try {
    env.run();
    env.emitWindow('error', { target: { tagName: 'SCRIPT', src: `${SANDBOX_ORIGIN}/vendor/d3-7.9.0.min.js` } });
    const banner = env.bodyEl.children.find((c) => c.id === 'petri-gen-ui-fatal');
    assert.ok(banner, 'fatal banner present');
    assert.equal(banner.attributes.role, 'alert');
    assert.ok(banner.textContent.includes('d3-7.9.0.min.js'), 'banner names the failed resource');
    // 普通 JS 运行时错误（无 target SCRIPT）不触发横幅
    env.emitWindow('error', { message: 'boom' });
    assert.equal(env.bodyEl.children.filter((c) => c.id === 'petri-gen-ui-fatal').length, 1);
  } finally { env.restore(); }
});

/** openExternal 返回 promise 的拒绝断言辅助（不 await，保持同步测试体）。 */
function await0(promise) {
  promise.then(() => { throw new Error('expected rejection'); }, () => {});
}

test('sendFollowUpMessage：合法 {prompt,title} → RPC；ack 后 resolve', async () => {
  const env = createEnv({ activation: true });
  try {
    env.run();
    const promise = env.window.petri.sendFollowUpMessage({ prompt: '把阈值改成 80', title: '图表确认' });
    await env.flushAsync();
    const msgs = rpcMessages(env);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].msg.method, 'petri/gen-ui/follow-up');
    assert.deepEqual(msgs[0].msg.params, { prompt: '把阈值改成 80', title: '图表确认' });
    env.emitFromParent({ type: 'petri-gen-ui-rpc-result', id: msgs[0].msg.id, ok: true, payload: {} });
    await promise;
  } finally { env.restore(); }
});

test('sendFollowUpMessage：坏形状/超长/无手势本地拒绝且不发 RPC', () => {
  const env = createEnv({});
  try {
    env.run();
    await0(env.window.petri.sendFollowUpMessage({}));
    await0(env.window.petri.sendFollowUpMessage({ prompt: '   ' }));
    await0(env.window.petri.sendFollowUpMessage({ prompt: 'x'.repeat(8001) }));
    await0(env.window.petri.sendFollowUpMessage({ prompt: 'p', title: 't'.repeat(251) }));
    await0(env.window.petri.sendFollowUpMessage({ prompt: 'p', extra: 1 }));
    await0(env.window.petri.sendFollowUpMessage({ prompt: 42 }));
    const noGesture = createEnv({ activation: false });
    noGesture.run();
    await0(noGesture.window.petri.sendFollowUpMessage({ prompt: 'p' }));
    assert.equal(rpcMessages(env).length, 0, 'shape rejections post nothing');
    assert.equal(rpcMessages(noGesture).length, 0, 'no-gesture rejection posts nothing');
    noGesture.restore();
  } finally { env.restore(); }
});
