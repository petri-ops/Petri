'use strict';

// BLOCK-92 Wave C-3 — 用户与站点设置 DAO 外迁（原 db.js，纯搬运零行为变化）。

const { db } = require('./connection');

function getUserByUsername(username) {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  return stmt.get(username);
}

function getUserById(id) {
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  return stmt.get(id);
}

async function getUserByUsernameAsync(username) {
  return getUserByUsername(username);
}

async function getUserByIdAsync(id) {
  return getUserById(id);
}

async function createUserAsync(payload) {
  return createUser(payload);
}

function createUser({ id, username, passwordHash, role }) {
  const stmt = db.prepare(
    'INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)'
  );
  stmt.run(id, username, passwordHash, role || 'user');
  return getUserById(id);
}

// ============================================================
// Subsets — saved cell selections
// ============================================================

function listUsers() {
  return db
    .prepare(
      'SELECT id, username, role, quota_mb, max_analyses_month, enabled, permissions, created_at FROM users ORDER BY created_at DESC'
    )
    .all();
}

/** Async user list for route handlers. */
async function listUsersAsync() {
  return db
    .prepare(
      'SELECT id, username, role, quota_mb, max_analyses_month, enabled, permissions, created_at FROM users ORDER BY created_at DESC'
    )
    .all();
}

function updateUser(id, { role, quotaMb, maxAnalysesMonth, enabled, permissions }) {
  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (quotaMb !== undefined)
    db.prepare('UPDATE users SET quota_mb = ? WHERE id = ?').run(quotaMb, id);
  if (maxAnalysesMonth !== undefined)
    db.prepare('UPDATE users SET max_analyses_month = ? WHERE id = ?').run(maxAnalysesMonth, id);
  if (enabled !== undefined)
    db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  if (permissions !== undefined)
    db.prepare('UPDATE users SET permissions = ? WHERE id = ?').run(permissions, id);
  return getUserById(id);
}

async function updateUserAsync(id, { role, quotaMb, maxAnalysesMonth, enabled, permissions }) {
  return updateUser(id, { role, quotaMb, maxAnalysesMonth, enabled, permissions });
}

function getSiteSetting(key) {
  return db.prepare('SELECT key, value, updated_at FROM site_settings WHERE key = ?').get(key);
}

async function getSiteSettingAsync(key) {
  return db.prepare('SELECT key, value, updated_at FROM site_settings WHERE key = ?').get(key);
}

function setSiteSetting(key, value) {
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, nowIso);
  return getSiteSetting(key);
}

async function setSiteSettingAsync(key, value) {
  return setSiteSetting(key, value);
}

function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

async function deleteUserAsync(id) {
  return deleteUser(id);
}

// ============================================================
// Shared SQLite accessors
// ============================================================


module.exports = {
  getUserByUsername,
  getUserById,
  createUser,
  getUserByUsernameAsync,
  getUserByIdAsync,
  createUserAsync,
  listUsers,
  updateUser,
  deleteUser,
  listUsersAsync,
  updateUserAsync,
  deleteUserAsync,
  getSiteSetting,
  setSiteSetting,
  getSiteSettingAsync,
  setSiteSettingAsync,
};
