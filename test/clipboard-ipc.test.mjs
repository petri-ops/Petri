/**
 * 试用反馈⑫续（owner msg_67a61cb96b68）：复制 ✓ 假成功——execCommand 在 Electron 渲染进程不可靠。
 * 根治=主进程 clipboard IPC：通道登记 + preload 暴露 + copyText 优先 IPC。HK-01 静态契约。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const channels = read('src/ipc/channels.js');
const preload = read('src/preload.js');
const ipcApp = fs.existsSync(path.join(ROOT, 'src/ipc/app.js')) ? read('src/ipc/app.js') : '';
const helper = read('frontend/src/lib/conversationActions.ts');

test('HK-01-1：剪贴板写通道在唯一注册表登记', () => {
  assert.match(channels, /writeClipboard:\s*['"]app:write-clipboard['"]/);
});

test('HK-01-2：preload 暴露 writeClipboard 包装（invoke 同名通道）', () => {
  assert.match(preload, /writeClipboard:[\s\S]{0,120}ipcRenderer\.invoke\(['"]app:write-clipboard['"]/);
});

test('HK-01-3：copyText 优先走 IPC bridge，execCommand 退为 web 兜底', () => {
  const at = helper.indexOf('export async function copyText');
  assert.ok(at > -1);
  const fn = helper.slice(at, helper.indexOf('\n}', at));
  assert.match(fn, /getBridge\(['"]app['"]\)/);
  assert.ok(fn.indexOf('.writeClipboard(') < fn.indexOf('execCommand('), 'IPC 调用必须先于 execCommand 兜底调用');
});

test('HK-01-4：Electron 侧 IPC handler 用主进程 clipboard.writeText', () => {
  const inMain = read('src/ipc/desktop-shell.js') + read('src/main.js') + ipcApp;
  assert.match(inMain, /clipboard\.writeText/);
  assert.match(inMain, /app:write-clipboard|CHANNELS\.app\.writeClipboard/);
});
