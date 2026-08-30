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
//   as shims for backward compatibility with IPC handlers and biof3-server
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
  const path = require('path');
  const dataDir = process.env.BIOF3_LOCAL_DATA_DIR;
  if (!dataDir) {
    throw new Error('BIOF3_LOCAL_DATA_DIR environment variable is not set');
  }
  return path.join(dataDir, 'biof3.db');
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

/**
 * 创建项目
 * @param {string} id - 项目 ID (uuid v4)
 * @param {string} name - 项目名称
 * @returns {object} 创建的项目对象
 */
function createProject(id, name) {
  const db = getDatabase();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO projects (id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, name, now, now);
  return { id, name, created_at: now, updated_at: now };
}

/**
 * 获取项目
 * @param {string} id - 项目 ID
 * @returns {object|null} 项目对象或 null
 */
function getProject(id) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  return stmt.get(id) || null;
}

/**
 * 更新项目名称
 * @param {string} id - 项目 ID
 * @param {string} name - 新名称
 * @returns {boolean} 是否成功
 */
function updateProjectName(id, name) {
  const db = getDatabase();
  const now = Date.now();
  const stmt = db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?');
  const result = stmt.run(name, now, id);
  return result.changes > 0;
}

/**
 * 列出所有项目
 * @returns {Array} 项目列表
 */
function listProjects() {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC');
  return stmt.all();
}

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

/**
 * 获取分支的直接子分支
 * @param {string} parentBranchId - 父分支 ID
 * @returns {Array} 子分支列表
 */
function listChildBranches(parentBranchId) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM branches WHERE parent_branch_id = ? ORDER BY created_at ASC');
  return stmt.all(parentBranchId);
}

// ============================================================
// Message Operations
// ============================================================

/**
 * 添加消息到分支
 * @param {string} id - 消息 ID (uuid v4)
 * @param {string} branchId - 所属分支 ID
 * @param {string} role - 角色 ('user' | 'assistant')
 * @param {string} content - 消息内容
 * @param {object|null} [metadata=null] - 元数据对象
 * @returns {object} 创建的消息对象
 */
function appendMessage(id, branchId, role, content, metadata = null) {
  const db = getDatabase();
  const now = Date.now();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  const stmt = db.prepare(`
    INSERT INTO messages (id, branch_id, role, content, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, branchId, role, content, metadataJson, now);
  return { id, branch_id: branchId, role, content, metadata, created_at: now };
}

/**
 * 获取分支的对话历史
 * @param {string} branchId - 分支 ID
 * @param {number} [limit=100] - 返回消息数量限制
 * @param {number} [offset=0] - 偏移量
 * @returns {Array} 消息列表
 */
function listMessages(branchId, limit = 100, offset = 0) {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT id, branch_id, role, content, metadata, created_at
    FROM messages
    WHERE branch_id = ?
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `);
  const rows = stmt.all(branchId, limit, offset);
  return rows.map((row) => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));
}

/**
 * 获取消息
 * @param {string} id - 消息 ID
 * @returns {object|null} 消息对象或 null
 */
function getMessage(id) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM messages WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

/**
 * 获取消息数量
 * @param {string} branchId - 分支 ID
 * @returns {number} 消息数量
 */
function countMessages(branchId) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM messages WHERE branch_id = ?');
  return stmt.get(branchId).count;
}

/**
 * 删除消息
 * @param {string} id - 消息 ID
 * @returns {boolean} 是否成功
 */
function deleteMessage(id) {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * 清空分支的所有消息
 * @param {string} branchId - 分支 ID
 * @returns {number} 删除的消息数量
 */
function clearMessages(branchId) {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM messages WHERE branch_id = ?');
  const result = stmt.run(branchId);
  return result.changes;
}

module.exports = {
  // Database
  getDatabase,
  getDatabasePath,
  closeDatabase,
  // Project
  createProject,
  getProject,
  updateProjectName,
  listProjects,
  // Branch
  createBranch,
  getBranch,
  listBranches,
  switchBranch,
  getActiveBranch,
  deleteBranch,
  renameBranch,
  listChildBranches,
  // Message
  appendMessage,
  listMessages,
  getMessage,
  countMessages,
  deleteMessage,
  clearMessages,
};
