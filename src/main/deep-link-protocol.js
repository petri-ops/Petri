'use strict';

/**
 * deep-link-protocol.js — BLOCK-242 `petri-install://` OS 协议接线（主进程）。
 *
 * 只做三件事：注册协议、从 argv/open-url 里提取安装链接、把链接送到渲染层。
 * 测试实例不注册系统协议（避免污染开发机默认应用）；提取与路由保持纯逻辑。
 */

const path = require('node:path');
const { SCHEME } = require('./install-deep-link-core');

/** 从参数数组提取 `petri-install://` 链接（Windows 可能带引号）。 */
function extractInstallDeepLink(argv) {
  const list = Array.isArray(argv) ? argv : [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().replace(/^"|"$/g, '');
    if (trimmed.startsWith(`${SCHEME}://`)) return trimmed;
  }
  return null;
}

/** 注册 OS 协议（packaged/开发态两种 argv 形态）；测试实例跳过。 */
function installProtocol(app, { isTestInstance = false } = {}) {
  if (isTestInstance) return { registered: false, reason: 'test_instance' };
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(SCHEME);
    }
    return { registered: true };
  } catch (error) {
    return { registered: false, reason: (error && error.message) || 'register_failed' };
  }
}

/**
 * 路由：pending 列表兜底「推送早于订阅」；takePending 供渲染层挂载时补领。
 * send 失败（窗口未就绪）不抛，链接留在 pending。
 */
function createDeepLinkRouter({ send } = {}) {
  const pending = [];
  return {
    handle(url) {
      if (typeof url !== 'string' || !url.startsWith(`${SCHEME}://`)) return false;
      pending.push(url);
      if (pending.length > 10) pending.splice(0, pending.length - 10);
      try {
        if (typeof send === 'function') send(url);
      } catch { /* 窗口未就绪：交由 pending 补领 */ }
      return true;
    },
    takePending() {
      const url = pending.shift() || null;
      return { url };
    },
  };
}

module.exports = {
  extractInstallDeepLink,
  installProtocol,
  createDeepLinkRouter,
};