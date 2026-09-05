'use strict';

/**
 * BLOCK-48 P1 — Computer Use sidecar stdio JSON 协议契约测试。
 *
 * 协议：行式 JSON 请求 {id, verb, params} → {id, ok, data|error}。
 * 本测试 trust-aware：TCC 授权态因环境而异（未授权 = fail-closed 路径
 * 可断言；已授权 = 目标解析路径可断言）。两种状态下协议形状契约一致。
 *
 * 前置：sidecar 已构建（bash scripts/build-computer-use-sidecar.sh）。
 */

import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINARY = path.join(__dirname, '..', 'sidecars', 'computer-use', 'bin', 'biof3-computer-use');

// ── sidecar 会话句柄 ────────────────────────────────────────────

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
    // stderr 无输出 + 进程存活 = 启动成功
    setTimeout(() => (child && !child.killed ? resolve() : reject(new Error('sidecar died'))), 300);
  });
}

function request(verb, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting response for ${verb}#${id}`));
    }, 15000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(`${JSON.stringify({ id, verb, params })}\n`);
  });
}

before(async () => {
  assert.ok(fs.existsSync(BINARY),
    'sidecar 未构建：先运行 bash scripts/build-computer-use-sidecar.sh');
  await startSidecar();
});

after(() => {
  child?.kill();
});

// ── 协议契约 ────────────────────────────────────────────────────

describe('BLOCK-48 sidecar 协议契约', () => {
  test('probe：ok 且 trusted 为布尔；未授权时必带引导文案', async () => {
    const res = await request('probe');
    assert.equal(res.ok, true);
    assert.equal(typeof res.data.trusted, 'boolean', `payload=${JSON.stringify(res.data)}`);
    if (res.data.trusted === false) {
      assert.ok(res.data.guidance && res.data.guidance.includes('辅助功能'),
        '未授权时必须带权限引导文案');
    }
  });

  test('bad_request：非 JSON 行返回结构化错误（id=-1）', async () => {
    child.stdin.write('not-a-json-line\n');
    const res = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no bad_request response')), 5000);
      readline.once('line', (line) => {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      });
    });
    assert.equal(res.ok, false);
    assert.equal(res.id, -1);
    assert.equal(res.error.code, 'bad_request');
  });

  test('unknown_verb：未知动词结构化拒绝', async () => {
    const res = await request('bogus_verb');
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'unknown_verb');
  });

  test('snapshot 无 target：target_required（fail-closed）', async () => {
    const res = await request('snapshot', {});
    assert.equal(res.ok, false);
    assert.ok(['target_required', 'not_trusted'].includes(res.error.code),
      `未授权环境返回 not_trusted，已授权环境返回 target_required；实际=${res.error.code}`);
  });

  test('snapshot 僵尸 pid：目标不存在错误', async () => {
    const res = await request('snapshot', { target: { pid: 999999 } });
    assert.equal(res.ok, false);
    assert.ok(['target_not_found', 'not_trusted'].includes(res.error.code),
      `实际=${res.error.code}`);
  });

  test('click 未知 ref：unknown_ref（已授权环境）或 not_trusted（未授权）', async () => {
    const res = await request('click', { ref: 'e999' });
    assert.equal(res.ok, false);
    assert.ok(['unknown_ref', 'not_trusted'].includes(res.error.code),
      `实际=${res.error.code}`);
  });

  test('axmanual 僵尸 pid：目标不存在错误', async () => {
    const res = await request('axmanual', { target: { pid: 999999 } });
    assert.equal(res.ok, false);
    assert.ok(['target_not_found', 'not_trusted'].includes(res.error.code),
      `实际=${res.error.code}`);
  });
});

// ── 已授权环境专属：真实 AX 目标解析（未授权环境诚实跳过）────────

describe('已授权环境：真实目标解析', () => {
  let trusted = false;

  before(async () => {
    const probe = await request('probe');
    trusted = probe?.data?.trusted === true;
  });

  test('snapshot frontmost：返回 app 信息与元素数组（ref 稳定命名）', { skip: !trusted && '环境未授权辅助功能' }, async () => {
    const res = await request('snapshot', { target: { frontmost: true }, maxElements: 50 });
    assert.equal(res.ok, true, JSON.stringify(res.error || {}).slice(0, 200));
    assert.ok(res.data.app && typeof res.data.app.pid === 'number');
    assert.ok(Array.isArray(res.data.elements));
    assert.equal(res.data.count, res.data.elements.length);
    for (const el of res.data.elements) {
      assert.match(el.ref, /^e\d+$/);
      assert.equal(typeof el.role, 'string');
    }
    // 注册表生效：上次快照的首元素可被 click 定位（unknown_ref 不应出现）
    if (res.data.elements.length > 0) {
      const clickRes = await request('click', {
        ref: 'e1', prefer: 'coordinate',
      }).catch(() => null);
      // click 真实发生了（不校验其效果）；仅断言不是 unknown_ref
      assert.notEqual(clickRes?.error?.code, 'unknown_ref');
    }
  });

  test('axmanual 真实目标：applied 布尔 + hint', { skip: !trusted && '环境未授权辅助功能' }, async () => {
    const res = await request('axmanual', { target: { frontmost: true } });
    assert.equal(res.ok, true);
    assert.equal(typeof res.data.applied, 'boolean');
    assert.ok(res.data.hint.includes('snapshot'));
  });
});
