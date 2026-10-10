'use strict';

/**
 * BLOCK-63 P2 — Windows sidecar 工具面真行为测试（隔离 fixture 靶 app）。
 *
 * 靶 app：sidecars/computer-use-windows/axfixture（WinForms：文本框 + 计数按钮），
 * 由本测试 spawn/kill，绝不指向用户真实应用。
 *
 * 断言（真行为，非形状）：
 *   type 注入「hello 格物 123」→ snapshot 实证 value（CJK 通过）
 *   press backspace → 末字符删除（…123 → …12）
 *   click 按钮（Invoke）→ 计数标签 clicked=1
 *   wait textContains → 命中
 *   screenshot → PNG 魔数 + 尺寸
 *   close → WM_CLOSE 窗口粒度关闭（fixture 进程退出）
 *   非法键 / 空 text / 未知方向 fail-closed
 *
 * 前置：sidecar 与 fixture 已发布（build.ps1 + axfixture dotnet build）。
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
const SIDECAR = path.join(__dirname, '..', 'sidecars', 'computer-use-windows', 'bin', 'publish', 'petri-computer-use-windows.exe');
const FIXTURE = path.join(__dirname, '..', 'sidecars', 'computer-use-windows', 'axfixture', 'bin', 'publish', 'axfixture-windows.exe');

let sidecar = null;
let readline = null;
let nextId = 1;
const pending = new Map();
let fixture = null;

function startSidecar() {
  sidecar = spawn(SIDECAR, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  readline = createInterface({ input: sidecar.stdout });
  readline.on('line', (line) => {
    let msg = null;
    try { msg = JSON.parse(line); } catch { return; }
    const resolver = pending.get(msg.id);
    if (resolver) { pending.delete(msg.id); resolver(msg); }
  });
  return new Promise((resolve, reject) => {
    sidecar.once('error', reject);
    sidecar.stderr.once('data', (d) => reject(new Error(`sidecar stderr: ${d}`)));
    setTimeout(() => (sidecar && !sidecar.killed ? resolve() : reject(new Error('sidecar died'))), 500);
  });
}

function request(verb, params = {}, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting ${verb}#${id}`)); }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    sidecar.stdin.write(`${JSON.stringify({ id, verb, params })}\n`);
  });
}

/** 把 fixture 窗口带到前台并 snapshot（元素数组）。 */
async function snapshotFixture() {
  const probeTarget = { target: { bundleId: 'axfixture-windows' } };
  const res = await request('snapshot', probeTarget);
  assert.equal(res.ok, true, 'fixture snapshot 失败：' + JSON.stringify(res).slice(0, 200));
  return res.data;
}

function findEl(data, role, nameContains = '') {
  return (data.elements || []).find(
    (e) => e.role === role && e.name.toLowerCase().includes(nameContains.toLowerCase())
      && e.w > 0 && e.h > 0
  );
}

before(async () => {
  assert.ok(fs.existsSync(SIDECAR), 'sidecar 未发布（build.ps1）');
  assert.ok(fs.existsSync(FIXTURE), 'fixture 未发布（build.ps1 一并发布 axfixture）');
  await startSidecar();
  fixture = spawn(FIXTURE, [], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
});

after(() => {
  if (fixture && !fixture.killed) { try { fixture.kill(); } catch { } }
  if (sidecar && !sidecar.killed) sidecar.kill();
});

describe('BLOCK-63 Windows sidecar 工具面真行为（P2，fixture 靶）', () => {
  test('snapshot：fixture 树含 Edit/Button/计数标签', async () => {
    const data = await snapshotFixture();
    assert.ok(data.elementCount > 3, '元素过少：' + data.elementCount);
    assert.ok(findEl(data, 'Edit'), '未找到文本框（Edit）');
    assert.ok(findEl(data, 'Button', 'count'), '未找到计数按钮');
  });

  test('type：中文+ASCII 混合注入 → snapshot 实证 value', async () => {
    const data = await snapshotFixture();
    const input = findEl(data, 'Edit');
    assert.ok(input, '无文本框');
    const res = await request('type', { target: { bundleId: 'axfixture-windows' }, ref: input.ref, text: 'hello 格物 123' });
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
    assert.equal(res.data.typed, 'hello 格物 123'.length);
    const after = await snapshotFixture();
    const input2 = findEl(after, 'Edit');
    assert.ok((input2?.value || '').includes('hello 格物 123'), 'value 未实证：' + input2?.value);
  });

  test('press backspace：末字符删除（…123 → …12；先 click 落焦点，人类顺序）', async () => {
    const data = await snapshotFixture();
    const input = findEl(data, 'Edit');
    assert.ok(input, '无文本框');
    // 先 click 文本框（前台+caret），再按键——按键必须落在真实焦点上。
    const click = await request('click', { target: { bundleId: 'axfixture-windows' }, ref: input.ref });
    assert.equal(click.ok, true, JSON.stringify(click).slice(0, 160));
    // WinForms TextBox 的 OnGotFocus 会 SelectAll（程序化改文本后首次聚焦触发），
    // 先按 end 收拢选区到尾部再删，才是「删除末字符」的真实语义。
    await request('press', { target: { bundleId: 'axfixture-windows' }, ref: input.ref, key: 'end' });
    const res = await request('press', { target: { bundleId: 'axfixture-windows' }, ref: input.ref, key: 'backspace' });
    assert.equal(res.ok, true);
    const after = await snapshotFixture();
    const input2 = findEl(after, 'Edit');
    assert.ok((input2?.value || '').endsWith('hello 格物 12'), '删除未生效：' + input2?.value);
  });

  test('click 计数按钮（Invoke）→ 标签 clicked=1；wait textContains 命中', async () => {
    const data = await snapshotFixture();
    const button = findEl(data, 'Button', 'count');
    assert.ok(button, '无计数按钮');
    const res = await request('click', { target: { bundleId: 'axfixture-windows' }, ref: button.ref });
    assert.equal(res.ok, true);
    assert.equal(res.data.mode, 'invoke', '期望 Invoke 语义动作：' + JSON.stringify(res.data));
    const wait = await request('wait', { target: { bundleId: 'axfixture-windows' }, textContains: 'clicked=1', timeoutMs: 5000 });
    assert.equal(wait.ok, true, JSON.stringify(wait).slice(0, 200));
    const after = await snapshotFixture();
    const counter = findEl(after, 'Text', 'clicked=1') || findEl(after, 'Edit', 'clicked=1');
    assert.ok(counter || JSON.stringify(after.elements).includes('clicked=1'), '计数标签未回写');
  });

  test('screenshot：PNG 魔数 + 尺寸 > 0', async () => {
    const out = path.join(os.tmpdir(), 'axfix-shot-' + Date.now() + '.png');
    const res = await request('screenshot', { target: { bundleId: 'axfixture-windows' }, out });
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
    assert.ok(res.data.bytes > 0);
    const buf = fs.readFileSync(out);
    // PNG 魔数 89504E47
    assert.ok(buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, '非 PNG');
    fs.unlinkSync(out);
  });

  test('scroll：非法方向 fail-closed（unknown_direction）', async () => {
    const res = await request('scroll', { target: { bundleId: 'axfixture-windows' }, direction: 'diagonal', amount: 2 });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'unknown_direction');
  });

  test('press 非法键 fail-closed（unknown_key）', async () => {
    const res = await request('press', { target: { bundleId: 'axfixture-windows' }, key: 'capswow' });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'unknown_key');
  });

  test('type 空 text fail-closed（target_required）', async () => {
    const res = await request('type', { target: { bundleId: 'axfixture-windows' } });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'target_required');
  });

  test('close：WM_CLOSE 窗口粒度关闭 → fixture 进程退出（不伤宿主其他窗口）', async () => {
    const data = await snapshotFixture();
    const win = data.elements.find((e) => e.role === 'Window') || data.elements[0];
    const res = await request('close', { ref: win.ref });
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
    assert.equal(res.data.closed, true);
    // fixture 进程应在 5s 内退出（无未保存内容，WM_CLOSE 直接走退出流程）
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      fixture.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
    assert.ok(exited, 'fixture 未在 5s 内退出');
    fixture = null;
  });
});
