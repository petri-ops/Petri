#!/usr/bin/env node
'use strict';

const { Buffer } = require('node:buffer');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs, code) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function safeEvaluationDiagnostic(exceptionDetails) {
  const raw = String(exceptionDetails?.text || exceptionDetails?.exception?.description || 'renderer_exception');
  return raw.slice(0, 240)
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/(?:\/Users\/|\/home\/)[^\s)]+/g, '[path]')
    .replace(/\b(?:rev|cs|tj|sel|conv|p)_[A-Za-z0-9_-]{6,}\b/g, '[id]');
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = null;
  }

  async connect(timeoutMs = 10_000, handshakeTimeoutMs = 8_000) {
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
    // 握手两条命令恒为毫秒级：这里是「target 存在但已失活」时的唯一暴露点——
    // WS open 由浏览器进程应答即触发，renderer 缺席则永不回包，故必须限时。
    await this.send('Runtime.enable', {}, { timeoutMs: handshakeTimeoutMs });
    await this.send('Page.enable', {}, { timeoutMs: handshakeTimeoutMs });
    return this;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, { timeoutMs = 0 } = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('cdp_socket_not_open'));
    }
    const id = this.nextId++;
    const pending = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
    if (!timeoutMs) return pending;
    // 目标失活（窗口已关/renderer 不在但 WS 仍 OPEN）时 CDP 永不回包：无超时即
    // 无限挂起。timeoutMs 为调用方自选，默认 0 = 保持既有长等语义不变。
    let timer;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cdp_command_timeout:${method}:${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
    });
    return Promise.race([pending, guard]).finally(() => clearTimeout(timer));
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

function createPackagedWindowAdapter(client, {
  captureTimeoutMs = 10_000,
  captureFallback = null,
} = {}) {
  const webContents = {
    on() {},
    async executeJavaScript(expression) {
      const result = await client.send('Runtime.evaluate', {
        expression: String(expression),
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails) {
        const error = new Error('packaged_cdp_evaluation_failed');
        error.diagnostic = safeEvaluationDiagnostic(result.exceptionDetails);
        throw error;
      }
      return result.result?.value;
    },
    async capturePage() {
      let png;
      try {
        const result = await withTimeout(client.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
        }), captureTimeoutMs, 'packaged_cdp_capture_timeout');
        png = Buffer.from(result.data || '', 'base64');
      } catch (error) {
        if (typeof captureFallback !== 'function') throw error;
        png = Buffer.from(await captureFallback(error));
      }
      if (png.length === 0) throw new Error('packaged_capture_empty');
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
