/**
 * src/ipc/gen-ui.js
 *
 * BLOCK-166 IPC（P0 prepare + P1 guest 桥中继）：
 * - gen-ui:prepare——渲染层提交 {projectId, conversationId, path}，主进程做
 *   workspace 归属解析（经后端 REST /api/data/projects/:id，desktop-local 鉴权
 *   ——dev 主进程不进程内开 better-sqlite3：Electron ABI 与系统 Node 不一致，
 *   既有先例=迁移链已拆子进程）+ scope 包含校验（realpath 纵深防御）+ 1MB 硬校验，
 *   登记沙箱会话（P1 起并记录宿主窗 origin 与 sender 绑定）后返回页 URL。
 * - gen-ui:set-state——guest 桥 petri/gen-ui/state 的宿主端：widgetState 内存版
 *   落主进程（P2 换 SQLite/D4），≤16KiB 硬校验，ack 后 guest promise 才 resolve。
 * - gen-ui:open-external——petri/gen-ui/open-external 的宿主端：仅绝对 http(s)
 *   （规格 §6.5），会话存在 + sender 为 prepare 时的同一窗口（可见实例绑定的
 *   主进程侧裁据；可见性/手势的 guest 侧预检在桥内 userActivation）。
 * 通道登记见 channels.js genUi.*；三步同批（channels → preload → electron.d.ts）。
 */

const CHANNELS = require('./channels');

const WIDGET_STATE_MAX_BYTES = 16 * 1024;

async function resolveWorkspacePath(projectId) {
  const port = process.env.R_SERVER_PORT || '3001';
  const url = `http://127.0.0.1:${port}/api/data/projects/${encodeURIComponent(projectId)}`;
  const resp = await fetch(url, { headers: { Authorization: 'Bearer desktop-local' } });
  if (resp.status === 404) return null;
  if (!resp.ok) throw Object.assign(new Error(`backend status ${resp.status}`), { code: 'read-failed' });
  const data = await resp.json();
  const project = data && data.project;
  return project && project.workspace_path ? project.workspace_path : null;
}

/** 宿主聊天窗 origin（sender 帧地址推导；不可得时留空，guest 桥退化 source-only 校验）。 */
function senderOrigin(event) {
  try {
    const frame = event && event.senderFrame;
    if (frame && frame.url) return new URL(frame.url).origin;
  } catch { /* file:// 等特殊 origin 走 null/退化路径 */ }
  return '';
}

/** 后端 REST 基址（desktop-local 鉴权，P0 prepare 先例同款）。 */
function backendBase() {
  return `http://127.0.0.1:${process.env.R_SERVER_PORT || '3001'}`;
}

/** D4 持久化回读：prepare 时把已持久化的 widgetState 预置进内存（壳拼装注入用）。 */
async function loadPersistedWidgetState(scopeKey, filePath) {
  try {
    const url = `${backendBase()}/api/gen-ui/widget-state?scopeKey=${encodeURIComponent(scopeKey)}&filePath=${encodeURIComponent(filePath)}`;
    const resp = await fetch(url, { headers: { Authorization: 'Bearer desktop-local' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data && data.ok ? data.state : null;
  } catch {
    return null; // 后端缺席降级内存版（诚实降级，不阻塞 prepare）
  }
}

/** D4 持久化写入：宿主 ack 前置条件（规格 §8——持久化成功才 resolve）。 */
async function persistWidgetState(scopeKey, filePath, state) {
  const resp = await fetch(`${backendBase()}/api/gen-ui/widget-state`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' },
    body: JSON.stringify({ scopeKey, filePath, state }),
  });
  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({}));
    throw Object.assign(new Error(detail.message || `backend status ${resp.status}`), { code: 'persist-failed' });
  }
  const data = await resp.json();
  if (!data || data.ok !== true) {
    throw Object.assign(new Error((data && data.message) || 'persist rejected'), { code: 'persist-failed' });
  }
}

async function prepareGenUi(event, payload) {
  const { computeScopeRoot, computeScopeKey, realpathScopeRoot, assertInsideScope } = require('../main/gen-ui/paths');
  const { HTML_MAX_BYTES, createGenUiSession, setGenUiWidgetState, SCHEME } = require('../main/gen-ui/scheme');
  const fs = require('fs');

  const projectId = String((payload && payload.projectId) || '').trim();
  const conversationId = String((payload && payload.conversationId) || '').trim();
  const filePath = String((payload && payload.path) || '');
  const title = typeof (payload && payload.title) === 'string' ? payload.title : undefined;

  try {
    if (!projectId) return { ok: false, code: 'no-workspace', message: 'projectId missing' };
    if (!conversationId) return { ok: false, code: 'no-workspace', message: 'conversationId missing' };
    if (!filePath) return { ok: false, code: 'failed', message: 'path missing' };

    const workspacePath = await resolveWorkspacePath(projectId);
    if (!workspacePath) return { ok: false, code: 'project-not-found', message: 'project workspace not found' };

    const scopeRoot = computeScopeRoot(workspacePath, conversationId);
    const scopeRootReal = realpathScopeRoot(scopeRoot);
    const realFilePath = assertInsideScope(scopeRootReal, filePath);

    const stat = fs.statSync(realFilePath);
    if (!stat.isFile()) return { ok: false, code: 'file-not-found', message: 'not a regular file' };
    if (stat.size > HTML_MAX_BYTES) {
      return { ok: false, code: 'too-large', message: `fragment is ${stat.size} bytes (limit ${HTML_MAX_BYTES})` };
    }

    const scopeKey = computeScopeKey(workspacePath, conversationId);
    const persisted = await loadPersistedWidgetState(scopeKey, realFilePath);
    if (persisted !== null) setGenUiWidgetState(realFilePath, persisted);

    const session = createGenUiSession({
      filePath: realFilePath,
      title,
      hostOrigin: senderOrigin(event),
      ownerWebContentsId: event && event.sender ? event.sender.id : null,
      scopeKey,
    });
    return { ok: true, url: `${SCHEME}://${session.id}/index.html` };
  } catch (error) {
    const known = [
      'no-workspace', 'project-not-found', 'outside-scope', 'file-not-found',
      'too-large', 'read-failed', 'failed',
    ];
    const code = known.includes(error.code) ? error.code : 'failed';
    return { ok: false, code, message: error.message || String(error) };
  }
}

function findOwnedSession(event, sessionId) {
  const { getGenUiSession } = require('../main/gen-ui/scheme');
  const session = getGenUiSession(String(sessionId || ''));
  if (!session) return null;
  const senderId = event && event.sender ? event.sender.id : null;
  if (session.ownerWebContentsId !== null && senderId !== session.ownerWebContentsId) return null;
  return session;
}

async function setGenUiState(event, payload) {
  const { setGenUiWidgetState } = require('../main/gen-ui/scheme');
  const session = findOwnedSession(event, payload && payload.sessionId);
  if (!session) return { ok: false, code: 'no-session', message: 'gen-ui session not found' };
  const state = payload && payload.state;
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, code: 'invalid-state', message: 'widget state must be a JSON object' };
  }
  let serialized;
  try {
    serialized = JSON.stringify(state);
  } catch {
    return { ok: false, code: 'invalid-state', message: 'widget state must be JSON-serializable' };
  }
  if (Buffer.byteLength(serialized, 'utf8') > WIDGET_STATE_MAX_BYTES) {
    return { ok: false, code: 'too-large', message: `widget state exceeds ${WIDGET_STATE_MAX_BYTES} bytes` };
  }
  // D4：宿主持久化成功后才 ack（规格 §8）——后端缺席时明确失败，guest promise reject。
  if (session.scopeKey) {
    try {
      await persistWidgetState(session.scopeKey, session.filePath, JSON.parse(serialized));
    } catch (error) {
      return { ok: false, code: error.code || 'persist-failed', message: error.message || String(error) };
    }
  }
  setGenUiWidgetState(session.filePath, JSON.parse(serialized));
  return { ok: true };
}

async function openGenUiExternal(event, payload) {
  const { isAllowedExternalHref } = require('../main/gen-ui/external-link');
  const session = findOwnedSession(event, payload && payload.sessionId);
  if (!session) return { ok: false, code: 'no-session', message: 'gen-ui session not found' };
  const href = payload && typeof payload.href === 'string' ? payload.href : '';
  if (!isAllowedExternalHref(href)) {
    return { ok: false, code: 'denied', message: 'only absolute http(s) URLs can be opened externally' };
  }
  if (!event || !event.sender || event.sender.isDestroyed()) {
    return { ok: false, code: 'no-visible-instance', message: 'sender window unavailable' };
  }
  try {
    const { shell } = require('electron');
    await shell.openExternal(href);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: 'failed', message: error.message || String(error) };
  }
}

/** P2 复制图片：sender/会话/几何三重校验后 capturePage 区域 → 原生剪贴板
 * （规格 §6.5：不向页面暴露任意 guest ID 或图像字节）。 */
async function copyGenUiImage(event, payload) {
  const { validateCaptureRect } = require('../main/gen-ui/geometry');
  const session = findOwnedSession(event, payload && payload.sessionId);
  if (!session) return { ok: false, code: 'no-session', message: 'gen-ui session not found' };
  if (!event || !event.sender || event.sender.isDestroyed()) {
    return { ok: false, code: 'no-visible-instance', message: 'sender window unavailable' };
  }
  const rect = validateCaptureRect(payload && payload.rect);
  if (!rect) return { ok: false, code: 'invalid-rect', message: 'capture rect must be finite and within 1..10000 px' };
  try {
    const image = await event.sender.capturePage(rect);
    if (image.isEmpty()) {
      return { ok: false, code: 'capture-empty', message: 'captured image is empty (window occluded or minimized?)' };
    }
    const { clipboard } = require('electron');
    clipboard.writeImage(image);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: 'failed', message: error.message || String(error) };
  }
}

function setupGenUiIpc() {
  const { ipcMain } = require('electron');
  ipcMain.handle(CHANNELS.genUi.prepare, async (event, payload) => prepareGenUi(event, payload));
  ipcMain.handle(CHANNELS.genUi.setState, (event, payload) => setGenUiState(event, payload));
  ipcMain.handle(CHANNELS.genUi.openExternal, (event, payload) => openGenUiExternal(event, payload));
  ipcMain.handle(CHANNELS.genUi.copyImage, (event, payload) => copyGenUiImage(event, payload));
}

module.exports = { setupGenUiIpc };
