// ============================================================
// Result Database Module
//
// Phase 2: Shared results across branches (project-scoped, not branch-scoped)
//
// Design:
//   - Results are scoped to projects, NOT branches
//   - Branch switching does not affect results
//   - Each result tracks which branch created it (sourceBranchId)
//   - Result versions track historical snapshots for reproducibility
// ============================================================

const path = require('path');
const { loadDatabaseConstructor } = require('../migration-runner');

const Database = loadDatabaseConstructor();

/**
 * Get database path
 * @param {string} [dbName='biof3.db']
 * @returns {string}
 */
function getDatabasePath(dbName = 'biof3.db') {
  const dataDir = process.env.BIOF3_LOCAL_DATA_DIR;
  if (!dataDir) {
    throw new Error('BIOF3_LOCAL_DATA_DIR environment variable is not set');
  }
  return path.join(dataDir, dbName);
}

/**
 * Get database connection (singleton)
 * @param {string} [dbName='biof3.db']
 * @returns {Database}
 */
let _dbCache = {};
function getDatabase(dbName = 'biof3.db') {
  if (!_dbCache[dbName]) {
    const dbPath = getDatabasePath(dbName);
    _dbCache[dbName] = new Database(dbPath);
  }
  return _dbCache[dbName];
}

/**
 * Close database connection
 * @param {string} [dbName='biof3.db']
 */
function closeDatabase(dbName = 'biof3.db') {
  if (_dbCache[dbName]) {
    _dbCache[dbName].close();
    delete _dbCache[dbName];
  }
}

// ============================================================
// Result Operations
// ============================================================

/**
 * Create a new result
 * @param {string} id - Result ID (UUID v4)
 * @param {string} projectId - Project ID this result belongs to
 * @param {string} type - Result type: 'chart' | 'table' | 'code' | 'text' | 'file'
 * @param {string} name - Human-readable result name
 * @param {unknown} data - Result data payload
 * @param {Record<string, unknown>} [config] - Optional display config
 * @param {string|null} [sourceBranchId=null] - Branch that created this result
 * @returns {object} Created result object
 */
function createResult(id, projectId, type, name, data, config = null, sourceBranchId = null) {
  const db = getDatabase();
  const now = Date.now();
  const dataJson = JSON.stringify(data);
  const configJson = config ? JSON.stringify(config) : null;
  const stmt = db.prepare(`
    INSERT INTO results (id, project_id, type, name, data, config, source_branch_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, projectId, type, name, dataJson, configJson, sourceBranchId, now, now);
  return {
    id,
    projectId,
    type,
    name,
    data,
    config,
    sourceBranchId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get a result by ID
 * @param {string} id - Result ID
 * @returns {object|null} Result object or null
 */
function getResult(id) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM results WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;
  return deserializeResult(row);
}

/**
 * List results for a project
 * @param {string} projectId - Project ID
 * @param {object} [options] - Query options
 * @param {string} [options.type] - Filter by type
 * @param {number} [options.limit=100] - Result limit
 * @param {number} [options.offset=0] - Offset
 * @param {string} [options.sortBy='updatedAt'] - Sort field
 * @param {string} [options.sortDir='desc'] - Sort direction
 * @returns {Array} List of result summaries
 */
function listResults(projectId, options = {}) {
  const db = getDatabase();
  const {
    type,
    limit = 100,
    offset = 0,
    sortBy = 'updatedAt',
    sortDir = 'desc',
  } = options;

  const columnMap = {
    updatedAt: 'updated_at',
    createdAt: 'created_at',
    name: 'name',
  };
  const sortColumn = columnMap[sortBy] || 'updated_at';
  const sortDirection = sortDir === 'asc' ? 'ASC' : 'DESC';

  let sql = `SELECT id, project_id, type, name, source_branch_id, updated_at FROM results WHERE project_id = ?`;
  const params = [projectId];

  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }

  sql += ` ORDER BY ${sortColumn} ${sortDirection} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    name: row.name,
    sourceBranchId: row.source_branch_id,
    updatedAt: row.updated_at,
  }));
}

/**
 * Update a result
 * @param {string} id - Result ID
 * @param {object} updates - Fields to update
 * @param {string} [updates.name] - New name
 * @param {unknown} [updates.data] - New data payload
 * @param {Record<string, unknown>} [updates.config] - New config
 * @returns {object|null} Updated result or null if not found
 */
function updateResult(id, updates) {
  const db = getDatabase();
  const now = Date.now();
  const fields = ['updated_at = ?'];
  const params = [now];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    params.push(updates.name);
  }
  if (updates.data !== undefined) {
    fields.push('data = ?');
    params.push(JSON.stringify(updates.data));
  }
  if (updates.config !== undefined) {
    fields.push('config = ?');
    params.push(updates.config ? JSON.stringify(updates.config) : null);
  }

  params.push(id);
  const stmt = db.prepare(`UPDATE results SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...params);

  if (result.changes === 0) return null;
  return getResult(id);
}

/**
 * Delete a result and its versions
 * @param {string} id - Result ID
 * @returns {boolean} Whether deletion succeeded
 */
function deleteResult(id) {
  const db = getDatabase();
  // Delete versions first (cascade should handle this, but be explicit)
  const deleteVersions = db.prepare('DELETE FROM result_versions WHERE result_id = ?');
  const deleteResultStmt = db.prepare('DELETE FROM results WHERE id = ?');

  const tx = db.transaction(() => {
    deleteVersions.run(id);
    const result = deleteResultStmt.run(id);
    return result.changes > 0;
  });

  return tx();
}

/**
 * Get results by project (full objects)
 * @param {string} projectId - Project ID
 * @param {object} [options] - Query options
 * @returns {Array} Full result objects
 */
function getResultsByProject(projectId, options = {}) {
  const db = getDatabase();
  const { type, limit = 100, offset = 0 } = options;

  let sql = 'SELECT * FROM results WHERE project_id = ?';
  const params = [projectId];

  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }

  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);
  return rows.map(deserializeResult);
}

// ============================================================
// Result Version Operations
// ============================================================

/**
 * Create a result version (snapshot)
 * @param {string} id - Version ID (UUID v4)
 * @param {string} resultId - Parent result ID
 * @param {number} version - Version number
 * @param {unknown} data - Data snapshot
 * @param {Record<string, unknown>} [config] - Config snapshot
 * @param {string|null} [createdByBranchId=null] - Branch that created this version
 * @returns {object} Created version object
 */
function createResultVersion(id, resultId, version, data, config = null, createdByBranchId = null) {
  const db = getDatabase();
  const now = Date.now();
  const dataJson = JSON.stringify(data);
  const configJson = config ? JSON.stringify(config) : null;
  const stmt = db.prepare(`
    INSERT INTO result_versions (id, result_id, version, data, config, created_at, created_by_branch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, resultId, version, dataJson, configJson, now, createdByBranchId);
  return {
    id,
    resultId,
    version,
    data,
    config,
    createdAt: now,
    createdByBranchId,
  };
}

/**
 * Get the latest version number for a result
 * @param {string} resultId - Result ID
 * @returns {number} Latest version number, or 0 if no versions exist
 */
function getLatestVersionNumber(resultId) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT MAX(version) as max_version FROM result_versions WHERE result_id = ?');
  const row = stmt.get(resultId);
  return row?.max_version || 0;
}

/**
 * Get a specific version
 * @param {string} id - Version ID
 * @returns {object|null} Version object or null
 */
function getResultVersion(id) {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM result_versions WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;
  return deserializeVersion(row);
}

/**
 * List versions for a result
 * @param {string} resultId - Result ID
 * @param {number} [limit=50] - Max versions to return
 * @param {number} [offset=0] - Offset
 * @returns {Array} Version objects, newest first
 */
function listResultVersions(resultId, limit = 50, offset = 0) {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM result_versions
    WHERE result_id = ?
    ORDER BY version DESC
    LIMIT ? OFFSET ?
  `);
  const rows = stmt.all(resultId, limit, offset);
  return rows.map(deserializeVersion);
}

/**
 * Delete all versions for a result
 * @param {string} resultId - Result ID
 * @returns {number} Number of deleted versions
 */
function deleteResultVersions(resultId) {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM result_versions WHERE result_id = ?');
  const result = stmt.run(resultId);
  return result.changes;
}

// ============================================================
// Serialization Helpers
// ============================================================

function deserializeResult(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    name: row.name,
    data: row.data ? JSON.parse(row.data) : null,
    config: row.config ? JSON.parse(row.config) : null,
    sourceBranchId: row.source_branch_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deserializeVersion(row) {
  return {
    id: row.id,
    resultId: row.result_id,
    version: row.version,
    data: row.data ? JSON.parse(row.data) : null,
    config: row.config ? JSON.parse(row.config) : null,
    createdAt: row.created_at,
    createdByBranchId: row.created_by_branch_id,
  };
}

module.exports = {
  // Database
  getDatabase,
  getDatabasePath,
  closeDatabase,
  // Result CRUD
  createResult,
  getResult,
  listResults,
  updateResult,
  deleteResult,
  getResultsByProject,
  // Result Versions
  createResultVersion,
  getLatestVersionNumber,
  getResultVersion,
  listResultVersions,
  deleteResultVersions,
};
