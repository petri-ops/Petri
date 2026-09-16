const CHANNELS = require('./channels');
// ============================================================
// IPC handlers: Branch Conversation
//
// Phase 1 后端核心：分支对话 IPC 通道
// ============================================================

const { ipcMain } = require('electron');
const { randomUUID } = require('crypto');
const {
  createProject,
  getProject,
  updateProjectName,
  listProjects,
  createBranch,
  getBranch,
  listBranches,
  switchBranch,
  getActiveBranch,
  deleteBranch,
  renameBranch,
  listChildBranches,
  appendMessage,
  listMessages,
  getMessage,
  countMessages,
  deleteMessage,
  clearMessages,
} = require('../database/branch-db');
// BLOCK-10 S-004: assertTrustedSender helper, additive alongside BLOCK-3.
const { createSenderGuard } = require('./_sender-guard');

/**
 * 设置分支对话相关的所有 IPC handlers
 *
 * @param {{mainWindow?: Electron.BrowserWindow|null}} [options]
 */
function setupBranchIpc(options = {}) {
  const assertSender = createSenderGuard(options.mainWindow);
  // ── Project Handlers ────────────────────────────────────────

  ipcMain.handle(CHANNELS.branch.projectCreate, async (event, { id, name }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!id || !name) {
        return { ok: false, error: 'id and name are required' };
      }
      const project = createProject(id, name);
      return { ok: true, data: project };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.branch.projectGet, async (event, { id }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const project = getProject(id);
      if (!project) {
        return { ok: false, error: 'Project not found' };
      }
      return { ok: true, data: project };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.branch.projectUpdate, async (event, { id, name }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!id || !name) {
        return { ok: false, error: 'id and name are required' };
      }
      const success = updateProjectName(id, name);
      if (!success) {
        return { ok: false, error: 'Project not found or update failed' };
      }
      return { ok: true, data: getProject(id) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.branch.projectList, async (event) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const projects = listProjects();
      return { ok: true, data: projects };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Branch Handlers ─────────────────────────────────────────

  ipcMain.handle(CHANNELS.branch.create, async (event, { projectId, name, parentBranchId }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!projectId || !name) {
        return { ok: false, error: 'projectId and name are required' };
      }
      const id = randomUUID();
      const branch = createBranch(id, projectId, name, parentBranchId || null);
      return { ok: true, data: branch };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.branch.get, async (event, { id }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const branch = getBranch(id);
      if (!branch) {
        return { ok: false, error: 'Branch not found' };
      }
      return { ok: true, data: branch };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.branch.list, async (event, { projectId }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!projectId) {
        return { ok: false, error: 'projectId is required' };
      }
      const branches = listBranches(projectId);
      return { ok: true, data: branches };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.branch.switch, async (event, { branchId, projectId }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!branchId || !projectId) {
        return { ok: false, error: 'branchId and projectId are required' };
      }
      const success = switchBranch(branchId, projectId);
      if (!success) {
        return { ok: false, error: 'Branch not found or does not belong to project' };
      }
      return { ok: true, data: getBranch(branchId) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.branch.active, async (event, { projectId }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!projectId) {
        return { ok: false, error: 'projectId is required' };
      }
      const branch = getActiveBranch(projectId);
      return { ok: true, data: branch };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.branch.delete, async (event, { id }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!id) {
        return { ok: false, error: 'id is required' };
      }
      const success = deleteBranch(id);
      if (!success) {
        return { ok: false, error: 'Branch not found' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.branch.rename, async (event, { id, newName }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!id || !newName) {
        return { ok: false, error: 'id and newName are required' };
      }
      const success = renameBranch(id, newName);
      if (!success) {
        return { ok: false, error: 'Branch not found' };
      }
      return { ok: true, data: getBranch(id) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.branch.children, async (event, { parentBranchId }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!parentBranchId) {
        return { ok: false, error: 'parentBranchId is required' };
      }
      const children = listChildBranches(parentBranchId);
      return { ok: true, data: children };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Message Handlers ────────────────────────────────────────

  ipcMain.handle(CHANNELS.message.append, async (event, { branchId, role, content, metadata }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!branchId || !role || !content) {
        return { ok: false, error: 'branchId, role, and content are required' };
      }
      if (!['user', 'assistant'].includes(role)) {
        return { ok: false, error: 'role must be "user" or "assistant"' };
      }
      const id = randomUUID();
      const message = appendMessage(id, branchId, role, content, metadata || null);
      return { ok: true, data: message };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.message.list, async (event, { branchId, limit, offset }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!branchId) {
        return { ok: false, error: 'branchId is required' };
      }
      const messages = listMessages(branchId, limit || 100, offset || 0);
      return { ok: true, data: messages };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.message.get, async (event, { id }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const message = getMessage(id);
      if (!message) {
        return { ok: false, error: 'Message not found' };
      }
      return { ok: true, data: message };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.message.count, async (event, { branchId }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!branchId) {
        return { ok: false, error: 'branchId is required' };
      }
      const count = countMessages(branchId);
      return { ok: true, data: count };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.message.delete, async (event, { id }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!id) {
        return { ok: false, error: 'id is required' };
      }
      const success = deleteMessage(id);
      if (!success) {
        return { ok: false, error: 'Message not found' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.message.clear, async (event, { branchId }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!branchId) {
        return { ok: false, error: 'branchId is required' };
      }
      const count = clearMessages(branchId);
      return { ok: true, data: count };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { setupBranchIpc };