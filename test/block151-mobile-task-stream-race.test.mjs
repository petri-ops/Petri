'use strict';

/**
 * BLOCK-151 A 轨（BLOCK-150 P2-1 携带项）— /m 移动页任务流切换竞态契约。
 *
 * openTaskStream 曾缺 taskId 闭包守卫与 AbortController：close() 只翻 stopped
 * 标志，在途 pump 继续读流——用户从任务 A 切到任务 B 后，A 的迟到帧仍经
 * handleStreamLine 落入 B 详情的 lines（串台渲染）、抬高 B 的 lastSeq（B 断线
 * 重连会按被污染的 lastSeq 续传，真实事件被跳过），A 的 needApproval 帧也能
 * 顶掉 B 的批准卡。
 *
 * 契约：①SSE 帧分发前必须校验 state.detail.taskId === taskId（闭包守卫）；
 * ②close() 必须 abort 在途 fetch（AbortController），不能只翻标志位。
 *
 * 测试形式留痕：本页无页脚本行为测先例（block132-no-token-in-url 只做源文本
 * grep），取 node --test + node:vm 最小 DOM 桩——从 index.html 抽出内联
 * <script> 在沙箱求值，经 renderTasks 绑定的卡片 click 事件驱动 openTask，
 * 以可控 reader 交付/扣留 SSE 帧；不引 jsdom 等新依赖（B7 面「不新增依赖」）。
 * setTimeout 桩只记录不触发，重连退避定时器由测试手动点火（确定性）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_REL = 'core/petri-server/mobile-gateway/public/index.html';

const encoder = new TextEncoder();

function makeElementStub(id) {
  return {
    id,
    textContent: '',
    innerHTML: '',
    style: {},
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 0,
    handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    removeEventListener() {},
    classList: { add() {}, remove() {}, contains: () => false },
    querySelectorAll: () => [],
    getAttribute: () => null,
  };
}

/** 可控 SSE reader：deliver 依次交付帧；failRead 注入读错误（断线）；队列空即挂起 */
function makeControllableReader() {
  let pending = null;
  const queue = [];
  return {
    reader: {
      read: () => {
        if (queue.length) {
          const item = queue.shift();
          return item.__reject ? Promise.reject(item.__reject) : Promise.resolve(item);
        }
        return new Promise((resolve, reject) => { pending = { resolve, reject }; });
      },
    },
    deliver(text) {
      const frame = { done: false, value: encoder.encode(text) };
      if (pending) { const p = pending; pending = null; p.resolve(frame); }
      else queue.push(frame);
    },
    failRead(err) {
      if (pending) { const p = pending; pending = null; p.reject(err); }
      else queue.push({ __reject: err });
    },
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 加载 /m 页内联脚本到沙箱；返回驱动面（点击卡片 / 读流视图 / 审计 fetch） */
function loadMobilePage() {
  const html = fs.readFileSync(path.join(ROOT, PAGE_REL), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'index.html 内联脚本必须可抽取');

  const streams = new Map(); // taskId -> controllable reader
  const fetchCalls = []; // { url, options }
  const timers = []; // setTimeout 桩只记录，测试手动点火

  const appEl = makeElementStub('app');
  const toastEl = makeElementStub('toast');
  const taskCards = ['A', 'B'].map((id) => {
    const el = makeElementStub('card-' + id);
    el.getAttribute = (name) => (name === 'data-task' ? id : null);
    return el;
  });
  appEl.querySelectorAll = (selector) => (selector === '[data-task]' ? taskCards : []);

  const elements = new Map([['app', appEl], ['toast', toastEl]]);
  // 真实 DOM 语义：app.innerHTML 重建后旧子元素（back/cancel/stream/approve/reject）
  // 随之销毁，getElementById 必须拿到新的空元素——不能跨渲染复用带残留 textContent 的桩。
  Object.defineProperty(appEl, 'innerHTML', {
    get() { return this._html || ''; },
    set(v) {
      this._html = v;
      for (const key of Array.from(elements.keys())) {
        if (key !== 'app' && key !== 'toast') elements.delete(key);
      }
    },
  });
  const store = new Map([['petri-mobile-session', 'tok']]);

  const sandbox = {
    console: { error() {}, warn() {}, log() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    TextDecoder,
    AbortController,
    location: { hash: '', pathname: '/m/', replaceState() {} },
    history: { replaceState() {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, makeElementStub(id));
        return elements.get(id);
      },
      createElement: () => makeElementStub('created'),
      visibilityState: 'visible',
    },
    fetch: (url, options) => {
      const call = { url: String(url), options: options || {} };
      fetchCalls.push(call);
      const taskMatch = call.url.match(/\/api\/ai\/agent\/task\/([^/?]+)/);
      if (taskMatch) {
        if (/\/meta$/.test(call.url)) {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        const taskId = decodeURIComponent(taskMatch[1]);
        const stream = streams.get(taskId);
        if (!stream) return Promise.resolve({ ok: false, status: 404, text: async () => '' });
        return Promise.resolve({ ok: true, body: { getReader: () => stream.reader } });
      }
      if (call.url === '/m/api/health') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      if (call.url === '/m/api/overview') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ conversations: [], toolJobs: [], agentTasks: [{ taskId: 'A', status: 'running' }, { taskId: 'B', status: 'running' }] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'mobile-page-inline-script.js' });

  return {
    taskCards,
    streams,
    fetchCalls,
    timers,
    element: (id) => elements.get(id),
    clickTask: (id) => {
      const card = taskCards.find((c) => c.getAttribute('data-task') === id);
      assert.ok(card, '卡片 ' + id + ' 必须已由 renderTasks 绑定 click');
      card.handlers.click();
    },
  };
}

async function bootToTasksWall() {
  const page = loadMobilePage();
  // boot：pair(无 hash)→health→renderTasks→loadTasks→overview→renderTasks（绑卡）
  for (let i = 0; i < 10; i++) await flushMicrotasks();
  return page;
}

test('BLOCK-150 P2-1：切详情后旧任务迟到帧不得污染新详情（taskId 闭包守卫）', async () => {
  const page = await bootToTasksWall();
  page.streams.set('A', makeControllableReader());
  page.streams.set('B', makeControllableReader());

  // 1) 打开任务 A：建流、收一帧正常渲染（基线）
  page.clickTask('A');
  await flushMicrotasks();
  const aCalls = page.fetchCalls.filter((c) => /\/task\/A\?afterSeq/.test(c.url));
  assert.equal(aCalls.length, 1, '任务 A 应建立一条 SSE 流');
  page.streams.get('A').deliver('data: {"seq":5,"type":"delta","content":"A-1"}\n\n');
  await flushMicrotasks();
  assert.equal(page.element('stream').textContent, 'delta: A-1', 'A 帧应渲染进 A 详情');

  // 2) 切到任务 B：close() 旧流、B 详情为空（桩按需物化：无帧时 stream 元素可缺位）
  page.clickTask('B');
  await flushMicrotasks();
  const bInitialView = (page.element('stream') && page.element('stream').textContent) || '';
  assert.equal(bInitialView, '', 'B 详情初始为空');

  // 3) A 流的在途帧迟到（abort 生效前后都可能有一帧已被 resolve）
  page.streams.get('A').deliver('data: {"seq":6,"type":"delta","content":"A-stale"}\n\n');
  await flushMicrotasks();

  // 守卫契约：帧必须按 taskId 归属分发——A 的帧不得落入 B 的视图
  // （守卫生效时该帧根本不分发，stream 元素可能尚未创建——用 || '' 容忍缺位）
  const bStreamView = (page.element('stream') && page.element('stream').textContent) || '';
  assert.ok(
    !bStreamView.includes('A-stale'),
    '旧任务 A 的迟到帧不得渲染进任务 B 的详情视图（实际：' + JSON.stringify(bStreamView) + '）'
  );
});

test('BLOCK-150 P2-1：旧任务迟到帧不得抬高新详情 lastSeq（重连续传不跳事件）', async () => {
  const page = await bootToTasksWall();
  page.streams.set('A', makeControllableReader());
  page.streams.set('B', makeControllableReader());

  page.clickTask('A');
  await flushMicrotasks();
  page.streams.get('A').deliver('data: {"seq":5,"type":"delta","content":"A-1"}\n\n');
  await flushMicrotasks();

  page.clickTask('B');
  await flushMicrotasks();
  // A 的迟到帧带大 seq：无守卫时会写进 B 的 lastSeq
  page.streams.get('A').deliver('data: {"seq":99,"type":"delta","content":"A-stale"}\n\n');
  await flushMicrotasks();

  // B 流断线 → 页面应在 2s 后按「B 自己的 lastSeq」续传重连
  page.streams.get('B').failRead(new Error('connection reset'));
  await flushMicrotasks();
  const reconnectTimer = page.timers.find((t) => t.ms === 2000);
  assert.ok(reconnectTimer, 'B 断线后应安排 2s 退避重连');
  reconnectTimer.fn();
  await flushMicrotasks();

  const bCalls = page.fetchCalls.filter((c) => /\/task\/B\?afterSeq/.test(c.url));
  assert.ok(bCalls.length >= 2, 'B 应重连（实际 ' + bCalls.length + ' 次）');
  const afterSeq = Number(new URL(bCalls[1].url, 'http://x').searchParams.get('afterSeq'));
  assert.equal(
    afterSeq, 0,
    'B 的重连 afterSeq 必须是 B 自己的 lastSeq（0），不得被 A 的迟到帧抬高（实际 ' + afterSeq + '）'
  );
});

test('BLOCK-150 P2-1：close() 必须 abort 在途 fetch（AbortController，而非只翻标志位）', async () => {
  const page = await bootToTasksWall();
  page.streams.set('A', makeControllableReader());
  page.streams.set('B', makeControllableReader());

  page.clickTask('A');
  await flushMicrotasks();
  page.clickTask('B');
  await flushMicrotasks();

  const aCalls = page.fetchCalls.filter((c) => /\/task\/A\?afterSeq/.test(c.url));
  assert.equal(aCalls.length, 1);
  const signal = aCalls[0].options.signal;
  assert.ok(signal, '任务流 fetch 必须携带 AbortSignal（close() 的取消通道）');
  assert.equal(signal.aborted, true, 'close() 后旧流 fetch 必须已 abort');
});

test('绿锚：切换详情后旧流读错误不重连（既有 stopped 守卫保持）', async () => {
  const page = await bootToTasksWall();
  page.streams.set('A', makeControllableReader());
  page.streams.set('B', makeControllableReader());

  page.clickTask('A');
  await flushMicrotasks();
  page.clickTask('B');
  await flushMicrotasks();

  page.streams.get('A').failRead(new Error('connection reset'));
  await flushMicrotasks();
  const reconnectTimers = page.timers.filter((t) => t.ms === 2000);
  assert.equal(reconnectTimers.length, 0, '已关闭的旧流（A）不得安排重连');
});
