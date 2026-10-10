'use strict';

/**
 * BLOCK-63 P1 — Windows Computer Use sidecar stdio JSON 协议契约测试。
 *
 * 协议：行式 JSON 请求 {id, verb, params} → {id, ok, data|error}
 * （与 macOS sidecars/computer-use/ 逐字同构；宿主 computer-use-host.js 平台无关复用）。
 *
 * 本机 Windows 实机直跑：UIA 无 TCC 式授权门 → probe 恒 trusted（诚实返回
 * hostElevated）；snapshot/click 依赖前台窗口（测试进程从 shell spawn，桌面
 * 会话内必有一个前台窗口；无前台 = fail-closed 断言路径）。
 *
 * 前置：sidecar 已发布（dotnet publish，见 sidecars/computer-use-windows/build.ps1）。
 */

import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINARY = path.join(
  __dirname, '..', 'sidecars', 'computer-use-windows', 'bin', 'publish', 'petri-computer-use-windows.exe'
);

let child = null;
let readline = null;
let nextId = 1;
const pending = new Map();

function startSidecar() {
  child = spawn(BINARY, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  readline = createInterface({ input: child.stdout });
  readline.on('line', (line) => {
    let msg = null;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // 非 JSON 行不符合协议
    }
    const resolver = pending.get(msg.id);
    if (resolver) {
      pending.delete(msg.id);
      resolver(msg);
    }
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stderr.once('data', (d) => reject(new Error(`sidecar stderr: ${d}`)));
    setTimeout(() => (child && !child.killed ? resolve() : reject(new Error('sidecar died'))), 500);
  });
}

function request(verb, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting response for ${verb}#${id}`));
    }, 20000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(`${JSON.stringify({ id, verb, params })}\n`);
  });
}

function rawLine(text) {
  return new Promise((resolve) => {
    const onLine = (line) => {
      readline.off('line', onLine);
      resolve(line);
    };
    readline.on('line', onLine);
    child.stdin.write(text.endsWith('\n') ? text : text + '\n');
  });
}

before(async () => {
  assert.ok(fs.existsSync(BINARY),
    'sidecar 未发布：dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o bin/publish');
  await startSidecar();
});

after(() => {
  if (child && !child.killed) child.kill();
});

describe('BLOCK-63 Windows sidecar stdio 协议契约（P1）', () => {
  test('probe：ok + trusted（UIA 无 TCC 门）+ 平台标识 + hostElevated + verbs 清单', async () => {
    const res = await request('probe');
    assert.equal(res.ok, true);
    assert.equal(res.data.platform, 'windows');
    assert.equal(res.data.trusted, true);
    assert.equal(typeof res.data.hostElevated, 'boolean');
    assert.ok(Array.isArray(res.data.verbs) && res.data.verbs.includes('snapshot'));
    assert.ok(res.data.verbs.includes('click'));
  });

  test('bad_request：非 JSON 行 → id=-1 fail-closed 且不中断协议循环', async () => {
    const line = await rawLine('not-a-json-line');
    const msg = JSON.parse(line);
    assert.equal(msg.id, -1);
    assert.equal(msg.ok, false);
    assert.equal(msg.error.code, 'bad_request');
    // 协议循环存活：后续正常请求仍可达
    const res = await request('probe');
    assert.equal(res.ok, true);
  });

  test('unknown_verb：fail-closed 错误码', async () => {
    const res = await request('bogus_verb');
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'unknown_verb');
  });

  test('click 无 ref：target_required fail-closed', async () => {
    const res = await request('click', {});
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'target_required');
  });

  test('click 未知 ref：unknown_ref fail-closed（未 snapshot 即点击）', async () => {
    const res = await request('click', { ref: '[e999]' });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'unknown_ref');
  });

  test('snapshot：前台窗口 UIA 树 → refs 数组 + 形状契约（元素含 ref/role/name/rect）', async () => {
    const res = await request('snapshot', { target: 'frontmost' });
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
    assert.equal(typeof res.data.elementCount, 'number');
    assert.ok(Array.isArray(res.data.elements));
    assert.equal(typeof res.data.truncated, 'boolean');
    assert.ok(res.data.target, 'target 元数据缺失');
    assert.equal(typeof res.data.target.pid, 'number');
    if (res.data.elementCount > 0) {
      const first = res.data.elements[0];
      assert.match(first.ref, /^\[e\d+\]$/);
      assert.equal(typeof first.role, 'string');
      assert.equal(typeof first.name, 'string');
      assert.equal(typeof first.x, 'number');
      assert.equal(typeof first.w, 'number');
    }
  });

  test('snapshot→click 链：对最近快照中真实存在的 ref 点击（invoke 或 coordinate 双路）', async () => {
    const snap = await request('snapshot', { target: 'frontmost' });
    assert.equal(snap.ok, true);
    const clickable = snap.data.elements.find(
      (el) => el.w > 8 && el.h > 8 && el.enabled !== false
    );
    if (!clickable) {
      // 前台窗口无可点元素（极端）：诚实跳过，不算失败
      console.log('  (skip) 前台窗口无可点元素');
      return;
    }
    const res = await request('click', { ref: clickable.ref });
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
    assert.ok(['invoke', 'coordinate'].includes(res.data.mode), 'mode 必须是 invoke|coordinate');
    assert.equal(res.data.ref, clickable.ref);
  });

  test('stale 语义：对非最近快照 ref（计数器外）报 unknown_ref', async () => {
    const res = await request('click', { ref: '[e9998]' });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'unknown_ref');
  });
});
