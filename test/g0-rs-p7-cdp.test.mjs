import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createPackagedWindowAdapter, setViewport } = require('../scripts/g0-rs-p7-cdp.cjs');

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
