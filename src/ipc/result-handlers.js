const CHANNELS = require('./channels');
// ============================================================
// IPC handlers: Result (Shared Results)
// 
// Phase 2: Project-scoped results shared across branches
// Core principle: Results belong to projects, not branches.
// Branch switching affects Copilot conversation but NOT Result Studio.
//
// Phase 3: result:createWithBranch - auto-bind sourceBranchId from active branch
// ============================================================

const { ipcMain } = require('electron');
const { randomUUID } = require('crypto');
const {
  createResult,
  getResult,
  listResults,
  updateResult,
  deleteResult,
  getResultsByProject,
  createResultVersion,
  getLatestVersionNumber,
  getResultVersion,
  listResultVersions,
} = require('../database/result-db');
// Branch DB for Phase 3 active branch detection
const {
  getActiveBranch,
} = require('../database/branch-db');

// Branch Message DB for Phase 4 conversation export
const {
  listMessages: listBranchMessages,
} = require('../database/branch-db');

// Summary generator for Phase 4 conversation export
const {
  generateConversationSummary,
} = require('../utils/summary-generator');

/**
 * Set up result-related IPC handlers
 */
function setupResultIpc(options = {}) {
  // BLOCK-10 S-004: assertTrustedSender helper, additive alongside BLOCK-3.
  const { createSenderGuard } = require('./_sender-guard');
  const assertSender = createSenderGuard(options.mainWindow);
  // ── Result CRUD ────────────────────────────────────────────

  ipcMain.handle(CHANNELS.result.create, async (event, {
    projectId,
    type,
    name,
    data,
    config,
    sourceBranchId,
  }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!projectId || !type || !name || data === undefined) {
        return { ok: false, error: 'projectId, type, name, and data are required' };
      }
      const validTypes = ['chart', 'table', 'code', 'text', 'file', 'conversation_export'];
      if (!validTypes.includes(type)) {
        return { ok: false, error: `type must be one of: ${validTypes.join(', ')}` };
      }
      const id = randomUUID();
      const result = createResult(
        id,
        projectId,
        type,
        name,
        data,
        config || null,
        sourceBranchId || null
      );
      return { ok: true, data: result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Phase 3: Create result with automatic branch binding
  // Automatically uses the active branch as sourceBranchId
  ipcMain.handle(CHANNELS.result.createWithBranch, async (event, {
    projectId,
    type,
    name,
    data,
    config,
    sourceBranchId,
  }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!projectId || !type || !name || data === undefined) {
        return { ok: false, error: 'projectId, type, name, and data are required' };
      }
      const validTypes = ['chart', 'table', 'code', 'text', 'file'];
      if (!validTypes.includes(type)) {
        return { ok: false, error: `type must be one be one of: ${validTypes.join(', ')}` };
      }

      // Phase 3: Auto-bind sourceBranchId from active branch if not provided
      let boundSourceBranchId = sourceBranchId || null;
      if (!boundSourceBranchId && projectId) {
        const activeBranch = getActiveBranch(projectId);
        if (activeBranch) {
          boundSourceBranchId = activeBranch.id;
        }
      }

      const id = randomUUID();
      const result = createResult(
        id,
        projectId,
        type,
        name,
        data,
        config || null,
        boundSourceBranchId
      );
      return { ok: true, data: result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.result.get, async (event, { id }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!id) {
        return { ok: false, error: 'id is required' };
      }
      const result = getResult(id);
      if (!result) {
        return { ok: false, error: 'Result not found' };
      }
      return { ok: true, data: result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.result.list, async (event, { projectId, options }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!projectId) {
        return { ok: false, error: 'projectId is required' };
      }
      const results = listResults(projectId, options || {});
      return { ok: true, data: results };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.result.update, async (event, { id, updates }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!id) {
        return { ok: false, error: 'id is required' };
      }
      if (!updates || typeof updates !== 'object') {
        return { ok: false, error: 'updates must be an object' };
      }
      const result = updateResult(id, updates);
      if (!result) {
        return { ok: false, error: 'Result not found' };
      }
      return { ok: true, data: result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.result.delete, async (event, { id }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!id) {
        return { ok: false, error: 'id is required' };
      }
      const success = deleteResult(id);
      if (!success) {
        return { ok: false, error: 'Result not found' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Project Results (full objects) ──────────────────────────

  ipcMain.handle(CHANNELS.result.byProject, async (event, { projectId, options }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!projectId) {
        return { ok: false, error: 'projectId is required' };
      }
      const results = getResultsByProject(projectId, options || {});
      return { ok: true, data: results };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Result Versions ─────────────────────────────────────────

  ipcMain.handle(CHANNELS.result.versionCreate, async (event, {
    resultId,
    data,
    config,
    createdByBranchId,
  }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!resultId || data === undefined) {
        return { ok: false, error: 'resultId and data are required' };
      }
      // Get or create version number
      const latestVersion = getLatestVersionNumber(resultId);
      const version = latestVersion + 1;
      const id = randomUUID();
      const versionObj = createResultVersion(
        id,
        resultId,
        version,
        data,
        config || null,
        createdByBranchId || null
      );
      return { ok: true, data: versionObj };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.result.versionGet, async (event, { id }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!id) {
        return { ok: false, error: 'id is required' };
      }
      const version = getResultVersion(id);
      if (!version) {
        return { ok: false, error: 'Version not found' };
      }
      return { ok: true, data: version };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Phase 4: Get version by resultId and version number
  ipcMain.handle(CHANNELS.result.versionGetByNumber, async (event, { resultId, version }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!resultId || version === undefined) {
        return { ok: false, error: 'resultId and version are required' };
      }
      const versions = listResultVersions(resultId, 1000, 0);
      const found = versions.find((v) => v.version === version);
      if (!found) {
        return { ok: false, error: 'Version not found' };
      }
      return { ok: true, data: found };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.result.versionList, async (event, { resultId, limit, offset }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!resultId) {
        return { ok: false, error: 'resultId is required' };
      }
      const versions = listResultVersions(resultId, limit || 50, offset || 0);
      return { ok: true, data: versions };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Phase 4: Conversation Export ─────────────────────────────────

  /**
   * Export conversation history as a Result.
   *
   * @param {string} projectId - Project to contain the result
   * @param {string} branchId - Branch whose conversation to export
   * @param {object} options
   * @param {string} [options.name] - Custom result name
   * @param {boolean} [options.includeMessages=true] - Include full message history
   * @param {boolean} [options.generateSummary=true] - Generate AI-free summary
   */
  ipcMain.handle(CHANNELS.result.createFromConversation, async (event, {
    projectId,
    branchId,
    options = {},
  }) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      if (!projectId) {
        return { ok: false, error: 'projectId is required' };
      }
      if (!branchId) {
        return { ok: false, error: 'branchId is required' };
      }

      const {
        name,
        includeMessages = true,
        generateSummary = true,
      } = options;

      // 1. Fetch branch messages (max 1000)
      const messages = listBranchMessages(branchId, 1000, 0);

      if (messages.length === 0) {
        return { ok: false, error: 'No messages found in branch' };
      }

      // 2. Generate summary
      let summary = '';
      let keyFindings = [];
      let topics = [];

      if (generateSummary) {
        const summaryData = generateConversationSummary(messages);
        summary = summaryData.summary;
        keyFindings = summaryData.keyFindings;
        topics = summaryData.topics;
      }

      // 3. Build result data
      const resultData = includeMessages
        ? {
            messages: messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              createdAt: m.created_at,
            })),
            summary,
            keyFindings,
            topics,
          }
        : { summary, keyFindings, topics };

      // 4. Build result config
      const resultConfig = {
        originalBranchId: branchId,
        messageCount: messages.length,
        exportedAt: new Date().toISOString(),
        includeMessages,
        generateSummary,
      };

      // 5. Create result
      const id = randomUUID();
      const resultName = name || `对话导出 ${new Date().toLocaleString('zh-CN')}`;

      const result = createResult(
        id,
        projectId,
        'conversation_export', // 对齐 electron.d.ts L356-357 union + result.types.ts L12
        resultName,
        resultData,
        resultConfig,
        branchId
      );

      return { ok: true, data: result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { setupResultIpc };
