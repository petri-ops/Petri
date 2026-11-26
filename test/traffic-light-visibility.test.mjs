/**
 * 红绿灯行为对齐 Orca（owner msg_92db4f7b765a）：全屏/最大化隐藏灯、退出恢复。
 * HK-01：四个窗口事件回调均调 setWindowButtonVisibility，且状态机发布不受影响。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(ROOT, 'src/main/_window-create.js'), 'utf8');

function callbackFor(event) {
  const needle = `mainWindow.on("${event}",`;
  const at = src.indexOf(needle);
  assert.ok(at > -1, `缺事件监听 ${event}`);
  return src.slice(at, src.indexOf('\n', at));
}

test('HK-01-1：原生全屏进入/退出隐藏与恢复红绿灯', () => {
  assert.match(callbackFor('enter-full-screen'), /setTrafficLightsVisible\(false\)/);
  assert.match(callbackFor('leave-full-screen'), /setTrafficLightsVisible\(true\)/);
});

test('HK-01-2：simple 全屏子态同步（存量窗口不漏判）', () => {
  assert.match(callbackFor('enter-simple-full-screen'), /setTrafficLightsVisible\(false\)/);
  assert.match(callbackFor('leave-simple-full-screen'), /setTrafficLightsVisible\(true\)/);
});

test('HK-01-3：maximize/unmaximize 同步隐藏与恢复', () => {
  assert.match(callbackFor('maximize'), /setTrafficLightsVisible\(false\)/);
  assert.match(callbackFor('unmaximize'), /setTrafficLightsVisible\(true\)/);
});

test('HK-01-4：macOS 专属 API 有存在性保护、状态机发布不回退', () => {
  assert.match(src, /typeof\s+\w+\.setWindowButtonVisibility\s*===\s*['"]function['"]/);
  assert.match(callbackFor('enter-full-screen'), /publishFullScreen\(true\)/);
  assert.match(callbackFor('maximize'), /publishMaximizedState\(true\)/);
});
