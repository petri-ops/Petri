'use strict';

/**
 * BLOCK-48 P2 — 工具面完整化单测：type / press / scroll / screenshot / wait。
 *
 * 靶标 = axfixture（隔离临时 app：窗口 + 文本框 + 按钮，plan §4 P2
 * 「隔离临时 app fixture」），由测试 spawn 与 kill，绝不指向用户真实应用。
 * 断言全部是真行为：输入后语义树 value 变化、按钮 AXPress 后状态回写、
 * 截图产物为真实 PNG、wait 正/负超时两路。
 *
 * 前置：bash scripts/build-computer-use-sidecar.sh（bin/petri-computer-use + bin/axfixture）
 */

import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINARY = path.join(__dirname, '..', 'sidecars', 'computer-use', 'bin', 'petri-computer-use');
// BLOCK-104 P3 — 环境门：sidecar 未构建时整组 skip（可见计数，带构建指引）。
const HAS_SIDECAR = fs.existsSync(BINARY);
const SIDECAR_SKIP = HAS_SIDECAR ? false : 'sidecar 未构建：先运行 bash scripts/build-computer-use-sidecar.sh（macOS Swift 产物）';
const FIXTURE = path.join(__dirname, '..', 'sidecars', 'computer-use', 'bin', 'axfixture');
const SCREENSHOT_OUT = path.join(os.tmpdir(), `axfixture-shot-${Date.now()}.png`);

let sidecar = null;
let fixture = null;
let nextId = 1;
const pending = new Map();

function startSidecar() {
  sidecar = spawn(BINARY, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  createInterface({ input: sidecar.stdout }).on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      const resolver = pending.get(msg.id);
      if (resolver) {
        pending.delete(msg.id);
        resolver(msg);
      }
    } catch { /* ignore */ }
  });
  sidecar.stderr.on('data', (d) => console.error(`[sidecar:stderr] ${d}`));
}

function request(verb, params = {}, timeoutMs = 20000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${verb}#${id}`));
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    sidecar.stdin.write(`${JSON.stringify({ id, verb, params })}\n`);
  });
}

before(async () => {
  // BLOCK-104 P3 — describe 级 skip 已门控整组；此处兜底短路（skip 可见优先于硬失败）。
  if (!HAS_SIDECAR) return;
  for (const bin of [BINARY, FIXTURE]) {
    assert.ok(fs.existsSync(bin), `缺少 ${bin}：先运行 bash scripts/build-computer-use-sidecar.sh`);
  }
  startSidecar();
  fixture = spawn(FIXTURE, [], { stdio: 'ignore' });
  // 等 fixture 窗口就绪
  await new Promise((r) => setTimeout(r, 1800));
});

after(() => {
  fixture?.kill();
  sidecar?.kill();
  try { fs.unlinkSync(SCREENSHOT_OUT); } catch { /* ignore */ }
});

let fieldRef = null;
let buttonRef = null;

describe('BLOCK-48 P2 工具面（axfixture 隔离靶）', { skip: SIDECAR_SKIP }, () => {
  test('前置：fixture 语义树可读，文本框/按钮定位', async () => {
    const snap = await request('snapshot', {
      target: { pid: fixture.pid }, maxElements: 200,
    }, 30000);
    assert.equal(snap.ok, true, JSON.stringify(snap.error || {}).slice(0, 200));
    assert.ok(snap.data.count > 3, `元素数 ${snap.data.count}`);
    const field = snap.data.elements.find((e) => e.role === 'AXTextField');
    const button = snap.data.elements.find(
      (e) => e.role === 'AXButton' && /AXFixtureButton/.test(`${e.title || ''}${e.description || ''}`),
    );
    assert.ok(field, '文本框（AXTextField）存在');
    assert.ok(button, '按钮（AXButton AXFixtureButton）存在');
    fieldRef = field.ref;
    buttonRef = button.ref;
  });

  test('wait 正路：role=button 立即命中（found:true + waitedMs）', async () => {
    const res = await request('wait', {
      target: { pid: fixture.pid }, role: 'button', timeoutMs: 3000,
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.found, true);
    assert.equal(res.data.element.role, 'AXButton');
    assert.ok(typeof res.data.waitedMs === 'number');
  });

  test('wait 负路：不存在的 role 超时返回 found:false', async () => {
    const res = await request('wait', {
      target: { pid: fixture.pid }, role: 'datepicker', timeoutMs: 1200,
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.found, false);
    assert.ok(res.data.waitedMs >= 1100, `实际等待 ${res.data.waitedMs}ms`);
  });

  test('type：聚焦文本框注入 CJK+ASCII，语义树 value 实证', async () => {
    // 先坐标点击聚焦，activate:true 保证键盘事件可达（后台语义不可靠的应用兜底路径）
    await request('click', { ref: fieldRef, prefer: 'coordinate' });
    const res = await request('type', {
      text: 'hello 格物 123', ref: fieldRef, activate: true,
    });
    assert.equal(res.ok, true, JSON.stringify(res.error || {}));
    assert.equal(res.data.method, 'cgevent-keyboard');
    assert.equal(res.data.typed, 'hello 格物 123'.length);
    const snap = await request('snapshot', { target: { pid: fixture.pid }, maxElements: 200 });
    const field = snap.data.elements.find((e) => e.ref === fieldRef);
    assert.ok((field?.value || '').includes('格物'), `value="${field?.value}"`);
  });

  test('press：delete 删除末字符（值由 …123 → …12）', async () => {
    const before = await request('snapshot', { target: { pid: fixture.pid }, maxElements: 100 });
    const fieldValue = before.data.elements.find((e) => e.ref === fieldRef)?.value || '';
    assert.ok(fieldValue.length > 0, '前置：文本框有内容');
    const res = await request('press', { key: 'delete', activate: true });
    assert.equal(res.ok, true, JSON.stringify(res.error || {}));
    assert.equal(res.data.method, 'cgevent-key');
    await new Promise((r) => setTimeout(r, 400));
    const after = await request('snapshot', { target: { pid: fixture.pid }, maxElements: 100 });
    const afterValue = after.data.elements.find((e) => e.ref === fieldRef)?.value || '';
    assert.equal(afterValue, fieldValue.slice(0, -1), `"${fieldValue}" → "${afterValue}"`);
  });

  test('click 按钮 → AXPress 动作回写状态（clicked 计数）', async () => {
    const res = await request('click', { ref: buttonRef });
    assert.equal(res.ok, true, JSON.stringify(res.error || {}));
    assert.equal(res.data.method, 'axpress', '按钮应走 AXPress 语义层');
    await new Promise((r) => setTimeout(r, 400));
    const snap = await request('snapshot', { target: { pid: fixture.pid }, maxElements: 200 });
    const fieldValue = snap.data.elements.find((e) => e.ref === fieldRef)?.value || '';
    assert.match(fieldValue, /^clicked \d+$/, `按钮动作应回写计数，实际 "${fieldValue}"`);
  });

  test('wait textContains：按钮回写文本可等待命中', async () => {
    const res = await request('wait', {
      target: { pid: fixture.pid }, textContains: 'clicked', timeoutMs: 2000,
    });
    assert.equal(res.data.found, true);
  });

  test('scroll：滚轮事件投递（方向与行数回显）', async () => {
    const res = await request('scroll', {
      direction: 'down', amount: 3, ref: fieldRef,
    });
    assert.equal(res.ok, true, JSON.stringify(res.error || {}));
    assert.equal(res.data.method, 'cgevent-scroll');
    assert.equal(res.data.direction, 'down');
    assert.equal(res.data.amount, 3);
  });

  test('screenshot：窗口截图产物为真实 PNG（遮挡免疫通道）', async () => {
    const res = await request('screenshot', { out: SCREENSHOT_OUT }, 30000);
    if (res.ok === false && res.error.code === 'not_trusted_screen') {
      // 宿主未授权屏幕录制：诚实记录（引导文案已返回），不算产品失败
      assert.ok(res.error.message.includes('屏幕录制'), JSON.stringify(res.error));
      return;
    }
    assert.equal(res.ok, true, JSON.stringify(res.error || {}));
    assert.ok(fs.existsSync(SCREENSHOT_OUT), 'PNG 文件已写出');
    const head = fs.readFileSync(SCREENSHOT_OUT).subarray(0, 4);
    assert.deepEqual([...head], [0x89, 0x50, 0x4e, 0x47], 'PNG 魔数');
    assert.ok(res.data.width > 0 && res.data.height > 0);
  });

  test('press 非法键名：invalid_params（fail-closed）', async () => {
    const res = await request('press', { key: 'meta-super-hyper' });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'invalid_params');
  });

  test('type 空文本：invalid_params（fail-closed）', async () => {
    const res = await request('type', { text: '' });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'invalid_params');
  });
});
