'use strict';

/**
 * install-deep-link.js — BLOCK-242 深链安装 IPC 装配（主进程）。
 *
 * 架构纪律（R5）：主进程不直接 require 后端实现；MCP 清单/写入走 :3001 REST
 * （与 pack 安装的既有主进程桥不同——后者是已登记的 pack-registry 例外）。
 * 核心逻辑在 src/main/install-deep-link-core.js（electron-free）。
 */

const os = require('node:os');
const path = require('node:path');
const { ipcMain } = require('electron');
const CHANNELS = require('./channels');
const core = require('../main/install-deep-link-core');

function defaultDataDir() {
  return process.env.PETRI_LOCAL_DATA_DIR
    || path.join(os.homedir(), 'Documents', 'Petri-Local');
}

function backendBase() {
  const port = Number(process.env.R_SERVER_PORT) || 3001;
  return `http://127.0.0.1:${port}/api`;
}

async function backendJson(endpoint, init) {
  const resp = await fetch(`${backendBase()}${endpoint}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init && init.headers) },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data && data.error ? String(data.error) : `HTTP ${resp.status}`);
  return data;
}

function readInstalledPacks(dataDir) {
  try {
    const registry = require('../../core/shared-backend/pack-registry');
    return registry.readInstalledPacks(dataDir) || [];
  } catch {
    return [];
  }
}

async function readMcpServers() {
  try {
    const data = await backendJson('/mcp/servers');
    return Array.isArray(data.servers) ? data.servers.map((server) => ({ id: server.id })) : [];
  } catch {
    return [];
  }
}

async function upsertMcpServer(server) {
  try {
    await backendJson('/mcp/servers', {
      method: 'POST',
      body: JSON.stringify({
        id: server.id,
        command: server.transport === 'http' ? 'http' : server.command,
        args: server.args || [],
        env: {},
        autoConnect: false,
        ...(server.transport === 'http' ? { transport: 'http', url: server.url } : {}),
      }),
    });
    return {};
  } catch (error) {
    return { error: error && error.message ? error.message : 'mcp_install_failed' };
  }
}

function registerInstallDeepLinkIpc({ getDataDir, deepLinkRouter } = {}) {
  const dataDir = () => (typeof getDataDir === 'function' ? getDataDir() : defaultDataDir());
  const listMcpServers = () => readMcpServers();

  ipcMain.handle(CHANNELS.installDeepLink.preview, async (_event, url) => (
    core.previewFromLink(url, {
      fetchImpl: globalThis.fetch,
      listInstalledPacks: async () => readInstalledPacks(dataDir()),
      listMcpServers,
    })
  ));

  ipcMain.handle(CHANNELS.installDeepLink.confirm, async (_event, payload = {}) => {
    const { extractZipFile } = require('../plugin/zip');
    const { createPackLifecycle } = require('../pack-lifecycle');
    const lifecycle = createPackLifecycle();
    return core.confirmInstall(payload.url, {
      expected: payload.expected,
      allowReplaceMcp: Boolean(payload.allowReplaceMcp),
      fetchImpl: globalThis.fetch,
      listMcpServers,
      extractZip: extractZipFile,
      installPackDir: async (packRoot) => lifecycle.installPackWithRuntimes(dataDir(), packRoot, {}),
      upsertMcpServer,
      tempRoot: os.tmpdir(),
    });
  });

  ipcMain.handle(CHANNELS.installDeepLink.pending, async () => (
    deepLinkRouter && typeof deepLinkRouter.takePending === 'function'
      ? deepLinkRouter.takePending()
      : { url: null }
  ));
}

module.exports = { registerInstallDeepLinkIpc };