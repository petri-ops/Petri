// ============================================================
// Branch Conversation Database Module
//
// Phase 1 后端核心：SQLite 持久化封装
// 使用 better-sqlite3，与 migration-runner 共享 Database 加载逻辑
//
// BLOCK-10 PHASE 1.1 (A-007 + PR-012 + E-019 full):
//   The 30 lines of singleton infrastructure (path resolution, _dbCache,
//   new Database(), journal_mode/busy_timeout pragmas, close) are now
//   centralized in src/database/_db-singleton.js. This module is a thin
//   wrapper that delegates every connection to openDb('branch'), and
//   keeps its public exports (getDatabase, getDatabasePath, closeDatabase)
//   as shims for backward compatibility with IPC handlers and petri-server
//   MCP code paths that import them.
// ============================================================

const { openDb, closeDb } = require('./_db-singleton');

/**
 * Backward-compatible Database accessor. Returns the singleton connection
 * for the branch role. Same identity is returned across calls in the same
 * process (PR-012 dedup).
 * @returns {import('better-sqlite3').Database}
 */
function getDatabase() {
  return openDb('branch');
}

/**
 * Backward-compatible DB path accessor (read-only utility for tests +
 * consumers that previously called branch-db.getDatabasePath()).
 * @returns {string}
 */
function getDatabasePath() {
  // POST-S7 H4/B-19——路径解析单源（历史缺陷注记，L5-3/L-41 更正时态）：
  // 本函数【曾】自行拼 `PETRI_LOCAL_DATA_DIR/petri.db` 且不认 `PETRI_DB_PATH`、
  // 与 db-connection-policy.resolveDbPath 形成两套入口；【现已委托单源】
  // （require resolveDbPath，下方代码即单源消费），缺陷已闭合。
  // 两者都未设置时保持 fail-fast 语义（抛错，不静默落盘到别处）。
  const { resolveDbPath } = require('../../core/shared-backend/db-connection-policy');
  const resolved = resolveDbPath(process.env);
  if (!resolved) {
    throw new Error('PETRI_LOCAL_DATA_DIR environment variable is not set');
  }
  return resolved;
}

/**
 * Backward-compatible close. Closes the singleton connection for the
 * branch role.
 */
function closeDatabase() {
  closeDb('branch');
}

// ============================================================
// Project Operations
// ============================================================

// ============================================================
// Branch Operations
// ============================================================

/**
 * 创建分支
 * @param {string} id - 分支 ID (uuid v4)
 * @param {string} projectId - 所属项目 ID
 * @param {string} name - 分支名称
 * @param {string|null} [parentBranchId=null] - 父分支 ID（可选，用于 fork）
 * @returns {object} 创建的分支对象
 */
function createBranch(id, projectId, name, parentBranchId = null) {
  const db = getDatabase();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO branches (id, project_id, name, parent_branch_id, created_at, updated_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `);
  stmt.run(id, projectId, name, parentBranchId, now, now);
  return { id, project_id: projectId, name, parent_branch_id: parentBranchId, created_at: now, updated_at: now, is_active: 0 };
}

/**
 * 获取分支
 * @param {string} id - 分支 ID
 * @returns {object|null} 分支对象或 null
 */
function getBranch(id) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM branches WHERE id = ?');
  return stmt.get(id) || null;
}

/**
 * 列出项目的所有分支
 * @param {string} projectId - 项目 ID
 * @returns {Array} 分支列表
 */
function listBranches(projectId) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM branches WHERE project_id = ? ORDER BY created_at ASC');
  return stmt.all(projectId);
}

/**
 * 切换当前激活分支
 * @param {string} branchId - 要激活的分支 ID
 * @param {string} projectId - 项目 ID（用于限定范围）
 * @returns {boolean} 是否成功
 */
function switchBranch(branchId, projectId) {
  const db = getDatabase();
  const deactivate = db.prepare('UPDATE branches SET is_active = 0, updated_at = ? WHERE project_id = ?');
  const activate = db.prepare('UPDATE branches SET is_active = 1, updated_at = ? WHERE id = ? AND project_id = ?');
  const tx = db.transaction(() => {
    deactivate.run(Date.now(), projectId);
    const result = activate.run(Date.now(), branchId, projectId);
    return result.changes > 0;
  });
  return tx();
}

/**
 * 获取项目的当前激活分支
 * @param {string} projectId - 项目 ID
 * @returns {object|null} 当前激活分支或 null
 */
function getActiveBranch(projectId) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM branches WHERE project_id = ? AND is_active = 1');
  return stmt.get(projectId) || null;
}

/**
 * 删除分支
 * @param {string} id - 分支 ID
 * @returns {boolean} 是否成功
 */
function deleteBranch(id) {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM branches WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * 重命名分支
 * @param {string} id - 分支 ID
 * @param {string} newName - 新名称
 * @returns {boolean} 是否成功
 */
function renameBranch(id, newName) {
  const db = getDatabase();
  const now = Date.now();
  const stmt = db.prepare('UPDATE branches SET name = ?, updated_at = ? WHERE id = ?');
  const result = stmt.run(newName, now, id);
  return result.changes > 0;
}

// ============================================================
// Message Operations
// ============================================================

module.exports = {
  // Database
  getDatabase,
  getDatabasePath,
  closeDatabase,
  // Project
  // Branch
  createBranch,
  getBranch,
  listBranches,
  switchBranch,
  getActiveBranch,
  deleteBranch,
  renameBranch,
  // Message
};
