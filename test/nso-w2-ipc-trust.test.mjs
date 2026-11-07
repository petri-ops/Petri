/**
 * nso-w2-ipc-trust.test.mjs — BLOCK-360（NSO-W2-1）全局 IPC sender 信任门。
 *
 * 契约：
 *  - decideIpcSenderTrust 纯函数：受信 origin（PETRI_TRUSTED_DESKTOP_ORIGINS）或自家 file: 窗放行；
 *    webview guest 无论 URL 一律拒；远程 origin / 空集合 / 已销毁 sender 拒（fail-closed）；
 *    senderFrame URL 优先于 sender URL（受信页内的远程子帧不得借道）。
 *  - installGlobalIpcSenderGuard：补丁 ipcMain.handle / ipcMain.on，未受信事件不进入 handler；
 *    受信事件参数与返回值原样透传；重复安装幂等（不双层包装）。
 *  - 装配顺序：main.js 在任何 IPC 注册之前安装全局门（顺序即安全性，漏装=全部 handler 裸奔）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  decideIpcSenderTrust,
  installGlobalIpcSenderGuard,
  registerTrustedFileSenderHost,
  resetRegisteredFileSenderHosts,
} = require('../src/ipc/_ipc-trust.js');

const TRUSTED = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function fakeSender({ url = 'http://localhost:3000/', type = 'window', destroyed = false, id } = {}) {
  const sender = { getURL: () => url, getType: () => type, isDestroyed: () => destroyed };
  if (id !== undefined) sender.id = id; // S2/G-07：file: 注册制按 webContents id 判定
  return sender;
}
function fakeEvent(opts = {}, frameUrl) {
  const sender = fakeSender(opts);
  return frameUrl === undefined ? { sender } : { sender, senderFrame: { url: frameUrl } };
}

test('W2-1 受信 dev origin 两变体与自家 file: 窗放行（S2/G-07 注册制追新）', () => {
  assert.equal(decideIpcSenderTrust({ event: fakeEvent(), trustedOrigins: TRUSTED }).ok, true);
  assert.equal(decideIpcSenderTrust({ event: fakeEvent({ url: 'http://127.0.0.1:3000/w' }), trustedOrigins: TRUSTED }).ok, true);
  // BLOCK-377（S2 / G-07）——file: 不再默认放行：未登记拒绝；登记放行；env 豁免同效。
  const fileSender = fakeEvent({ url: 'file:///app/resources/computer-use-pip.html', id: 4242 });
  const denied = decideIpcSenderTrust({ event: fileSender, trustedOrigins: TRUSTED });
  assert.deepEqual([denied.ok, denied.reason], [false, 'ipc_sender_file_unregistered']);
  registerTrustedFileSenderHost(4242);
  assert.equal(decideIpcSenderTrust({ event: fileSender, trustedOrigins: TRUSTED }).ok, true);
  resetRegisteredFileSenderHosts();
  process.env.PETRI_IPC_FILE_SENDER_EXEMPT_IDS = '5151';
  const exempt = decideIpcSenderTrust({ event: fakeEvent({ url: 'file:///x.html', id: 5151 }), trustedOrigins: TRUSTED });
  assert.equal(exempt.ok, true, 'env 豁免 id 放行（登记制留痕）');
  delete process.env.PETRI_IPC_FILE_SENDER_EXEMPT_IDS;
});

test('W2-1 负测：webview guest 一律拒（即便 URL 看似受信）', () => {
  const d = decideIpcSenderTrust({ event: fakeEvent({ type: 'webview', url: 'http://localhost:3000/' }), trustedOrigins: TRUSTED });
  assert.equal(d.ok, false);
  assert.equal(d.reason, 'ipc_sender_webview');
});

test('W2-1 负测：远程 origin / 空受信集合 / 已销毁 sender 均拒', () => {
  const remote = decideIpcSenderTrust({ event: fakeEvent({ url: 'https://evil.example/x' }), trustedOrigins: TRUSTED });
  assert.deepEqual([remote.ok, remote.reason], [false, 'ipc_sender_origin_untrusted']);
  const empty = decideIpcSenderTrust({ event: fakeEvent(), trustedOrigins: [] });
  assert.deepEqual([empty.ok, empty.reason], [false, 'ipc_sender_origin_untrusted'], '空集合 fail-closed');
  const gone = decideIpcSenderTrust({ event: fakeEvent({ destroyed: true }), trustedOrigins: TRUSTED });
  assert.deepEqual([gone.ok, gone.reason], [false, 'ipc_sender_missing']);
  const none = decideIpcSenderTrust({ event: {}, trustedOrigins: TRUSTED });
  assert.deepEqual([none.ok, none.reason], [false, 'ipc_sender_missing']);
});

test('W2-1 负测：senderFrame URL 优先——受信页内的远程子帧不得借道', () => {
  const d = decideIpcSenderTrust({ event: fakeEvent({}, 'https://evil.example/frame'), trustedOrigins: TRUSTED });
  assert.deepEqual([d.ok, d.reason], [false, 'ipc_sender_origin_untrusted']);
});

function fakeIpcMain() {
  const handles = new Map();
  const listeners = new Map();
  return {
    handles, listeners,
    handle(channel, fn) { handles.set(channel, fn); },
    on(channel, fn) { listeners.set(channel, fn); return this; },
  };
}

test('W2-1 拦截器：未受信事件不进入 handler；受信事件参数与返回值原样透传', async () => {
  const ipc = fakeIpcMain();
  const rejected = [];
  installGlobalIpcSenderGuard(ipc, { getTrustedOrigins: () => TRUSTED, onReject: (r) => rejected.push(r) });
  let calls = 0;
  ipc.handle('x:write', async (_e, a, b) => { calls += 1; return { ok: true, sum: a + b }; });
  const wrapped = ipc.handles.get('x:write');
  assert.deepEqual(await wrapped(fakeEvent(), 2, 3), { ok: true, sum: 5 });
  assert.equal(calls, 1);
  const denied = await wrapped(fakeEvent({ type: 'webview', url: 'https://evil.example/' }), 2, 3);
  assert.deepEqual(denied, { ok: false, error: 'unauthorized', reason: 'ipc_sender_webview' });
  assert.equal(calls, 1, '未受信事件不得进入 handler');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].channel, 'x:write');
});

test('W2-1 拦截器：ipcMain.on 同受保护；重复安装幂等（不双层包装）', () => {
  const ipc = fakeIpcMain();
  installGlobalIpcSenderGuard(ipc, { getTrustedOrigins: () => TRUSTED });
  const patchedHandle = ipc.handle;
  installGlobalIpcSenderGuard(ipc, { getTrustedOrigins: () => TRUSTED });
  assert.equal(ipc.handle, patchedHandle, '二次安装不替换已打补丁的 handle');
  let hits = 0;
  ipc.on('x:notify', () => { hits += 1; });
  ipc.listeners.get('x:notify')(fakeEvent({ url: 'https://evil.example/' }));
  assert.equal(hits, 0);
  ipc.listeners.get('x:notify')(fakeEvent());
  assert.equal(hits, 1);
});

test('W2-1 装配顺序：main.js 在任何 IPC 注册之前安装全局门', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  const install = src.indexOf('installGlobalIpcSenderGuard(');
  assert.ok(install > 0, 'main.js 必须安装全局 IPC sender 门');
  for (const marker of ['ipcMain.handle(', 'setupWindowIpc(', 'setupFileDialogIpc(']) {
    const at = src.indexOf(marker);
    if (at >= 0) assert.ok(install < at, `全局门必须早于首个 ${marker}`);
  }
});
