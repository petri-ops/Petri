/**
 * BLOCK-511 S1.3 HK-01 — Cmd+Q 退出守卫拦住后续拆除。
 *
 * 病灶：守卫 preventDefault 后，后注册的 before-quit 监听仍执行 → 后端 shutdown、
 * 终端会话被杀、窗口被销毁；用户点「取消」后应用存活但无后端。
 * 修复：除守卫外其余 3 个 before-quit 监听先判 event.defaultPrevented 即返回；
 * app.once → app.on 保证真正退出（二次触发）时清理仍执行。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function beforeQuitListener(src) {
  const m = src.match(/app\.(once|on)\(\s*["']before-quit["']\s*,\s*(\([^)]*\)\s*=>)/);
  return m ? { listener: m[2], kind: m[1], index: m.index } : null;
}

test('三处 before-quit 消费者先判 defaultPrevented 且用 app.on', () => {
  const targets = ['src/ipc/terminal.js', 'src/ipc/window-manager.js', 'src/main.js'];
  for (const rel of targets) {
    const src = read(rel);
    const hit = beforeQuitListener(src);
    assert.ok(hit, `${rel} 必须存在 before-quit 监听`);
    assert.equal(hit.kind, 'on', `${rel} 必须用 app.on（app.once 仅触发一次，取消后真退出不再清理）`);
    const body = src.slice(hit.index, hit.index + 260);
    assert.match(body, /defaultPrevented/, `${rel} 的 before-quit 监听必须先判 event.defaultPrevented`);
  }
});

test('模拟注册顺序：守卫拦截时后端 shutdown 与终端清理不触发，放行时触发', () => {
  // 按真实注册顺序模拟：①守卫（preventDefault）②后端 shutdown ③终端清理 ④窗口销毁
  function run({ cancel }) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    const calls = [];
    const listeners = [
      () => { if (cancel) { event.preventDefault(); } },                        // 守卫：cancel=用户点取消→拦截
      (e) => { if (e.defaultPrevented) return; calls.push('backendShutdown'); }, // 后端
      (e) => { if (e.defaultPrevented) return; calls.push('terminalKill'); },    // 终端
      (e) => { if (e.defaultPrevented) return; calls.push('windowsDestroy'); },  // 窗口
    ];
    for (const fn of listeners) fn(event);
    return { prevented: event.defaultPrevented, calls };
  }

  const cancelled = run({ cancel: true });
  assert.equal(cancelled.prevented, true, '守卫拦截后 defaultPrevented=true');
  assert.deepEqual(cancelled.calls, [], '取消退出时后端/终端/窗口清理一律不触发');

  const allowed = run({ cancel: false });
  assert.equal(allowed.prevented, false);
  assert.deepEqual(allowed.calls, ['backendShutdown', 'terminalKill', 'windowsDestroy'], '确认退出时全部清理触发');
});

test('守卫本体在 allowQuit=false 时 preventDefault，allowQuit=true 放行', () => {
  const src = read('src/main/desktop-shell.js');
  assert.match(src, /function onBeforeQuit\(event\)[\s\S]{0,160}if \(allowQuit\) return;[\s\S]{0,160}preventDefault/);
  assert.match(src, /installQuitGuard:\s*\(\)\s*=>\s*app\.on\(['"]before-quit['"]/);
});
