#!/usr/bin/env node
'use strict';

const { Buffer } = require('node:buffer');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = null;
  }

  async connect(timeoutMs = 10_000) {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    await Promise.race([
      new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', () => reject(new Error('cdp_socket_open_failed')), { once: true });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('cdp_socket_open_timeout')), timeoutMs)),
    ]);
    socket.addEventListener('message', (event) => {
      let payload;
      try { payload = JSON.parse(String(event.data || '')); } catch { return; }
      if (payload.id) {
        const pending = this.pending.get(payload.id);
        if (!pending) return;
        this.pending.delete(payload.id);
        if (payload.error) pending.reject(new Error(`cdp_command_failed:${payload.error.code || 'unknown'}`));
        else pending.resolve(payload.result || {});
        return;
      }
      const listeners = this.listeners.get(payload.method) || [];
      for (const listener of listeners) listener(payload.params || {});
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('cdp_socket_closed'));
      this.pending.clear();
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    return this;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('cdp_socket_not_open'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket?.close(); } catch {}
  }
}

async function fetchJson(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function connectToPackagedPage(debugPort, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
    const page = Array.isArray(targets)
      ? targets.find((item) => item?.type === 'page' && item.webSocketDebuggerUrl)
      : null;
    if (page) {
      const client = await new CdpClient(page.webSocketDebuggerUrl).connect();
      return { client, target: page };
    }
    await delay(100);
  }
  throw new Error('packaged_cdp_page_timeout');
}

function createPackagedWindowAdapter(client) {
  const webContents = {
    on() {},
    async executeJavaScript(expression) {
      const result = await client.send('Runtime.evaluate', {
        expression: String(expression),
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails) throw new Error('packaged_cdp_evaluation_failed');
      return result.result?.value;
    },
    async capturePage() {
      const result = await client.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const png = Buffer.from(result.data || '', 'base64');
      return { toPNG: () => png };
    },
  };
  return {
    webContents,
    async loadURL(url) {
      await client.send('Page.navigate', { url: String(url) });
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        try {
          const ready = await webContents.executeJavaScript(
            `document.readyState === 'complete' || document.readyState === 'interactive'`,
          );
          if (ready) return;
        } catch {}
        await delay(100);
      }
      throw new Error('packaged_page_navigation_timeout');
    },
    destroy() {},
  };
}

async function setViewport(client, width, height = 900) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

module.exports = {
  CdpClient,
  connectToPackagedPage,
  createPackagedWindowAdapter,
  setViewport,
};
