/**
 * src/main/gen-ui/scheme.js
 *
 * BLOCK-166 [C 层] petri-genui:// 独立 origin 沙箱宿主（D2）：
 * - registerGenUiSchemePrivileges()：registerSchemesAsPrivileged（必须在 app ready 前调用）
 * - createGenUiSession()：内存会话注册表（id → scope/文件），prepare IPC 与协议 handler 的接合点
 * - setupGenUiProtocol()：protocol.handle——/index.html 拼壳（CSP 响应头）、/vendor/* 离线资源
 * 每页 origin = petri-genui://gen-<id>（standard+secure，非宿主 origin，天然隔离）。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildGenUiCsp } = require('./csp');
const { assembleGenUiShell, HTML_MAX_BYTES } = require('./shell');
const { readVendorFile, vendorMimeFor } = require('./vendor');

const SCHEME = 'petri-genui';
const MAX_SESSIONS = 64;
const MAX_WIDGET_STATES = 256;

const sessions = new Map(); // id → { id, filePath, title, hostOrigin, ownerWebContentsId }
// P1 widgetState 内存版（plan §5-P1）：按 fragment 真实路径键，同一文件重新
// prepare 可回读上次交互状态；P2 换 SQLite（D4 scope key）后本表退役。
const widgetStates = new Map(); // filePath → state object

function registerGenUiSchemePrivileges() {
  const { protocol } = require('electron');
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false },
    },
  ]);
}

function createGenUiSession({ filePath, title, hostOrigin = '', ownerWebContentsId = null }) {
  const id = `gen-${crypto.randomBytes(12).toString('hex')}`;
  sessions.set(id, {
    id,
    filePath,
    title: title || '',
    hostOrigin,
    ownerWebContentsId,
  });
  // 简单容量治理：超限逐出最旧（P2 页面池/租约接口的预留位，plan D5）。
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest);
  }
  return sessions.get(id);
}

function getGenUiSession(id) {
  return sessions.get(id) || null;
}

function getGenUiWidgetState(filePath) {
  return widgetStates.get(filePath) ?? null;
}

function setGenUiWidgetState(filePath, state) {
  widgetStates.set(filePath, state);
  while (widgetStates.size > MAX_WIDGET_STATES) {
    const oldest = widgetStates.keys().next().value;
    widgetStates.delete(oldest);
  }
}

function htmlResponse(body) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': buildGenUiCsp(),
      'Cache-Control': 'no-store',
    },
  });
}

function errorResponse(status, message) {
  return new Response(message || 'not found', {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function setupGenUiProtocol() {
  const { protocol } = require('electron');
  protocol.handle(SCHEME, (request) => {
    let parsed;
    try {
      parsed = new URL(request.url);
    } catch {
      return errorResponse(400, 'bad url');
    }
    const id = parsed.hostname || parsed.host;
    const session = getGenUiSession(id);
    if (!session) return errorResponse(404, 'unknown gen-ui session');

    const pathname = decodeURIComponent(parsed.pathname || '/');
    if (pathname === '/index.html' || pathname === '/' || pathname === '') {
      try {
        const stat = fs.statSync(session.filePath);
        if (stat.size > HTML_MAX_BYTES) return errorResponse(413, 'fragment exceeds 1MB limit');
        const html = assembleGenUiShell({
          fragmentHtml: fs.readFileSync(session.filePath, 'utf8'),
          sandboxOrigin: `${SCHEME}://${id}`,
          hostOrigin: session.hostOrigin || '',
          initialState: getGenUiWidgetState(session.filePath),
        });
        return htmlResponse(html);
      } catch (error) {
        return errorResponse(404, `fragment read failed: ${error.code || error.message}`);
      }
    }
    if (pathname.startsWith('/vendor/')) {
      const fileName = path.basename(pathname.slice('/vendor/'.length));
      try {
        const { bytes } = readVendorFile(fileName);
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: { 'Content-Type': vendorMimeFor(fileName), 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        return errorResponse(404, `vendor miss: ${error.code || error.message}`);
      }
    }
    return errorResponse(404, 'not found');
  });
}

module.exports = {
  SCHEME,
  registerGenUiSchemePrivileges,
  createGenUiSession,
  getGenUiSession,
  setGenUiWidgetState,
  setupGenUiProtocol,
  HTML_MAX_BYTES,
};
