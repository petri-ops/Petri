'use strict';

/**
 * src/main/external-url-policy.js — L1-5（蓝图 L-60）：shell.openExternal 准入策略。
 *
 * 仅 http(s)、无 userinfo（`http://user@evil` 形态）、主机非空；file:/自定义协议一律拒。
 * 消费方：src/main/_window-create.js（主窗 will-navigate 外开 + setWindowOpenHandler）、
 * src/ipc/window-manager.js（pop-out 次级窗口同款）。
 */

function isSanitaryExternalUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (!url.hostname) return false;
    return true;
  } catch {
    return false;
  }
}

function openSanitizedExternal(url, shell) {
  if (!isSanitaryExternalUrl(url)) return false;
  try {
    const p = shell.openExternal(url);
    if (p && typeof p.catch === 'function') p.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

module.exports = { isSanitaryExternalUrl, openSanitizedExternal };
