import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createPackagedWindowAdapter, setViewport, CdpClient } = require('../scripts/g0-rs-p7-cdp.cjs');

test('CdpClient.send bounds a non-responsive target only when the caller asks', async () => {
  const client = new CdpClient('ws://127.0.0.1:0/devtools/page/ghost');
  const sent = [];
  // 失活目标形态：WS 仍 OPEN（浏览器进程应答），但没有任何 renderer 会回包。
  client.socket = { readyState: globalThis.WebSocket?.OPEN ?? 1, send: (t) => sent.push(t), close() {} };

  await assert.rejects(
    client.send('Runtime.enable', {}, { timeoutMs: 5 }),
    /cdp_command_timeout:Runtime\.enable:5ms/,
  );
  assert.equal(sent.length, 1, '命令仍需真实发出，超时只约束等待');
  assert.equal(client.pending.size, 0, '超时必须撤单，否则迟到响应成孤儿');

  const unbounded = client.send('Page.enable');
  assert.equal(client.pending.size, 1, '默认无超时=保留既有长等语义（真模型调用等）');
  client.pending.get(2).resolve({ enabled: true });
  assert.deepEqual(await unbounded, { enabled: true });
});

test('P7 packaged window adapter evaluates, navigates, and captures through CDP', async () => {
  const calls = [];
  const client = {
    async send(method, params) {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') return { result: { value: true } };
      if (method === 'Page.captureScreenshot') return { data: Buffer.from('png').toString('base64') };
      return {};
    },
  };
  const window = createPackagedWindowAdapter(client);
  assert.equal(await window.webContents.executeJavaScript('true'), true);
  await window.loadURL('http://localhost:3002/project/example');
  assert.equal((await window.webContents.capturePage()).toPNG().toString(), 'png');
  await setViewport(client, 1024, 900);
  assert.ok(calls.some((call) => call.method === 'Page.navigate'));
  assert.ok(calls.some((call) => call.method === 'Emulation.setDeviceMetricsOverride'
    && call.params.width === 1024));
});

test('P7 packaged window adapter bounds a stalled CDP capture and uses real-window fallback bytes', async () => {
  const fallbackPng = Buffer.from('native-window-png');
  let fallbackReason = null;
  const window = createPackagedWindowAdapter({
    async send(method) {
      if (method === 'Page.captureScreenshot') return new Promise(() => {});
      return {};
    },
  }, {
    captureTimeoutMs: 5,
    captureFallback(error) {
      fallbackReason = error.message;
      return fallbackPng;
    },
  });
  assert.equal((await window.webContents.capturePage()).toPNG().toString(), fallbackPng.toString());
  assert.equal(fallbackReason, 'packaged_cdp_capture_timeout');
});

test('P7 packaged window adapter rejects renderer exceptions', async () => {
  const window = createPackagedWindowAdapter({
    async send() { return { exceptionDetails: { text: 'private renderer error' } }; },
  });
  await assert.rejects(
    window.webContents.executeJavaScript('throw new Error("secret")'),
    /packaged_cdp_evaluation_failed/,
  );
});
