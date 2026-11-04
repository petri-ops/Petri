const CHANNELS = require('./channels');
// ============================================================
// IPC handlers: Branch Conversation
//
// Phase 1 后端核心：分支对话 IPC 通道
// ============================================================

const { ipcMain } = require('electron');
const { randomUUID } = require('crypto');
// BLOCK-346 T6 — 只保留 preload 实际暴露的 6 个通道所需函数。
// 删除的 12 条死通道（branch:children/get/project:*、message:*）此前登记了 handler
// 但 preload 无包装、全仓零消费；branch-db 中仅服务于它们的 11 个导出已一并删除
// （表结构与数据保留；若日后要接项目级分支，从 git 历史取回实现即可）。
const {
  createBranch,
  getBranch,
  listBranches,
  switchBranch,
  getActiveBranch,
  deleteBranch,
  renameBranch,
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


  // ── Message Handlers ────────────────────────────────────────






}

module.exports = { setupBranchIpc };