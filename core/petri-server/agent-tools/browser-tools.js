'use strict';

/**
 * agent-tools/browser-tools.js — BLOCK-264（C-40）browser_connect/act/status/disconnect 执行面。
 *
 * 会话/白名单/审批门全在 helpers/browser-connector.js（纯编排，测试单测覆盖）；
 * 本模块只做工具签名适配 + transport 桥接（垂直切片：无 Electron webview 通道时
 * transport 如实报 unavailable——不假装操作成功）。
 */

const connector = require('../helpers/browser-connector');

/** 垂直切片 transport：渲染侧浏览器面板通道未接线前，mutating/navigate 如实失败。 */
function currentTransport() {
  // 后续片：经事件总线把动作投递到打开的 BrowserPanel（webview executeJavaScript），
  // 这里保持注入边界——接线时只改本函数。
  return null;
}

async function browser_connect(args = {}) {
  const allowed = Array.isArray(args.allowedOrigins) ? args.allowedOrigins : [];
  return connector.connect({ allowedOrigins: allowed });
}

async function browser_act(args = {}) {
  const transport = currentTransport();
  return connector.act(args, transport || {});
}

async function browser_status() {
  return connector.status();
}

async function browser_disconnect() {
  return connector.disconnect();
}

module.exports = {
  browser_connect,
  browser_act,
  browser_status,
  browser_disconnect,
};
