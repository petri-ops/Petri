// ============================================================
// IPC handlers: Agent Doc Review Mode
//
// BLOCK-17 — Agent 文档审阅面板。
// 暴露 3 条 invoke/handle 通道：
//   agentDocReview:list         → 扫描 .md 文件列表
//   agentDocReview:loadPair    → 读 snapshot + current 内容
//   agentDocReview:commitSnapshot → 写 snapshot 文件
//
// 数据目录：app.getPath('userData')/agent-doc-snapshots/
// 快照目录：app.getPath('userData')/agent-doc-snapshots/.snapshots/
// ============================================================

const path = require('path');
const fs = require('fs');
const { ipcMain, app } = require('electron');
const { createSenderGuard } = require('./_sender-guard');

/**
 * 取得 agent-doc-snapshots 根目录（创建不存在）。
 */
function resolveSnapshotsDir() {
  const dir = path.join(app.getPath('userData'), 'agent-doc-snapshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 取得 .snapshots 子目录（创建不存在）。
 */
function resolveSnapshotsSubDir() {
  const dir = path.join(app.getPath('userData'), 'agent-doc-snapshots', '.snapshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 给一个 .md 文件路径，返回对应的 .snap 文件路径。
 */
function snapshotPathFor(mdFilePath) {
  const snapshotsDir = resolveSnapshotsSubDir();
  const basename = path.basename(mdFilePath, '.md') + '.snap';
  return path.join(snapshotsDir, basename);
}

/**
 * 格式化 ISO 字符串（安全传输）。
 */
function fmtMtime(stat) {
  return stat.mtime.toISOString();
}

/**
 * 装配所有 BLOCK-17 IPC handlers。
 * @param {{mainWindow?: Electron.BrowserWindow|null}} [options]
 */
function setupAgentDocReviewIpc(options = {}) {
  const assertSender = createSenderGuard(options.mainWindow);

  /**
   * agentDocReview:list
   * 扫描 userData/agent-doc-snapshots/ 下所有 .md 文件，返回元信息。
   */
  ipcMain.handle('agentDocReview:list', async (event) => {
    const deny = assertSender(event);
    if (deny) return deny;
    try {
      const baseDir = resolveSnapshotsDir();
      const files = [];
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const filePath = path.join(baseDir, entry.name);
        let lastSnapshotAt = null;
        let currentMtime = null;
        try {
          const snapPath = snapshotPathFor(filePath);
          if (fs.existsSync(snapPath)) {
            const snapStat = fs.statSync(snapPath);
            lastSnapshotAt = fmtMtime(snapStat);
          }
          const mdStat = fs.statSync(filePath);
          currentMtime = fmtMtime(mdStat);
        } catch {
          // 单文件出错不影响其他文件
        }
        const label = entry.name; // path.relative(baseDir, filePath) === entry.name
        files.push({
          path: filePath,
          label,
          lastSnapshotAt,
          currentMtime,
        });
      }
      // 按 label 字母排序，stable
      files.sort((a, b) => a.label.localeCompare(b.label));
      return { ok: true, data: { files } };
    } catch (e) {
      return {
        ok: false,
        error: 'unexpected_error',
        message: e && e.message ? e.message : String(e),
      };
    }
  });

  /**
   * agentDocReview:loadPair
   * 读 snapshot（不存在则 null）+ 当前 .md 内容。
   */
  ipcMain.handle('agentDocReview:loadPair', async (event, filePath) => {
    const deny = assertSender(event);
    if (deny) return deny;
    try {
      if (typeof filePath !== 'string' || !filePath) {
        return { ok: false, error: 'invalid_args', message: 'filePath is required.' };
      }
      // 安全检查：限制在 agent-doc-snapshots/ 下
      const baseDir = resolveSnapshotsDir();
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(baseDir))) {
        return { ok: false, error: 'forbidden', message: 'Path is outside the snapshots directory.' };
      }
      let snapshot = null;
      const snapPath = snapshotPathFor(filePath);
      if (fs.existsSync(snapPath)) {
        snapshot = fs.readFileSync(snapPath, 'utf-8');
      }
      let current = '';
      if (fs.existsSync(filePath)) {
        current = fs.readFileSync(filePath, 'utf-8');
      }
      return { ok: true, data: { snapshot, current } };
    } catch (e) {
      return {
        ok: false,
        error: 'unexpected_error',
        message: e && e.message ? e.message : String(e),
      };
    }
  });

  /**
   * agentDocReview:commitSnapshot
   * 把 current 内容写到 .snapshots/<basename>.snap。
   */
  ipcMain.handle('agentDocReview:commitSnapshot', async (event, filePath) => {
    const deny = assertSender(event);
    if (deny) return deny;
    try {
      if (typeof filePath !== 'string' || !filePath) {
        return { ok: false, error: 'invalid_args', message: 'filePath is required.' };
      }
      const baseDir = resolveSnapshotsDir();
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(baseDir))) {
        return { ok: false, error: 'forbidden', message: 'Path is outside the snapshots directory.' };
      }
      if (!fs.existsSync(filePath)) {
        return { ok: false, error: 'file_missing', message: 'Source .md file does not exist.' };
      }
      const current = fs.readFileSync(filePath, 'utf-8');
      const snapPath = snapshotPathFor(filePath);
      fs.writeFileSync(snapPath, current, 'utf-8');
      const savedAt = new Date().toISOString();
      return { ok: true, data: { savedAt } };
    } catch (e) {
      return {
        ok: false,
        error: 'unexpected_error',
        message: e && e.message ? e.message : String(e),
      };
    }
  });

  /**
   * BLOCK-19 — agentDocReview:saveCurrent
   * 把编辑后的内容写到 sandbox 内 .md 文件，覆盖原文件。
   * @param {string} filePath
   * @param {string} content
   */
  ipcMain.handle('agentDocReview:saveCurrent', async (event, filePath, content) => {
    const deny = assertSender(event);
    if (deny) return deny;
    try {
      if (typeof filePath !== 'string' || !filePath) {
        return { ok: false, error: 'invalid_args', message: 'filePath is required.' };
      }
      if (typeof content !== 'string') {
        return { ok: false, error: 'invalid_args', message: 'content must be string.' };
      }
      const baseDir = resolveSnapshotsDir();
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(baseDir))) {
        return { ok: false, error: 'forbidden', message: 'Path is outside the snapshots directory.' };
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      return { ok: true, data: { savedAt: new Date().toISOString() } };
    } catch (e) {
      return {
        ok: false,
        error: 'unexpected_error',
        message: e && e.message ? e.message : String(e),
      };
    }
  });
}

module.exports = { setupAgentDocReviewIpc };
