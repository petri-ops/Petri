/**
 * src/ipc/gen-ui.js
 *
 * BLOCK-166 IPC：gen-ui:prepare——渲染层提交 {projectId, conversationId, path}，
 * 主进程做 workspace 归属解析（经后端 REST /api/data/projects/:id，desktop-local
 * 鉴权——dev 主进程不进程内开 better-sqlite3：Electron ABI 与系统 Node 不一致，
 * 既有先例=迁移链已拆子进程）+ scope 包含校验（realpath 纵深防御）+ 1MB 硬校验，
 * 登记沙箱会话后返回页 URL。通道登记见 channels.js genUi.prepare；三步同批。
 */

const CHANNELS = require('./channels');

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

async function prepareGenUi(payload) {
  const { computeScopeRoot, realpathScopeRoot, assertInsideScope } = require('../main/gen-ui/paths');
  const { HTML_MAX_BYTES, createGenUiSession, SCHEME } = require('../main/gen-ui/scheme');
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

    const session = createGenUiSession({ filePath: realFilePath, title });
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

function setupGenUiIpc() {
  const { ipcMain } = require('electron');
  ipcMain.handle(CHANNELS.genUi.prepare, async (_event, payload) => prepareGenUi(payload));
}

module.exports = { setupGenUiIpc };
