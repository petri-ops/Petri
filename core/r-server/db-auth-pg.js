/**
 * P0 PostgreSQL: users + site_settings (async).
 * Called from db.js via deasync when DATABASE_URL is set.
 */
const {query} = require('./db-pg');

function normalizeUser(row) {
  if (!row) return row;
  if (typeof row.enabled === 'boolean') {
    row.enabled = row.enabled ? 1 : 0;
  }
  return row;
}

async function getUserByUsername(username) {
  const r = await query('SELECT * FROM users WHERE username = $1', [username]);
  return normalizeUser(r.rows[0] || null);
}

async function getUserById(id) {
  const r = await query('SELECT * FROM users WHERE id = $1', [id]);
  return normalizeUser(r.rows[0] || null);
}

async function createUser({id, username, passwordHash, role}) {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO users (id, username, password_hash, role, created_at, quota_mb, enabled)
     VALUES ($1, $2, $3, $4, $5, 500, TRUE)`,
    [id, username, passwordHash, role || 'user', now],
  );
  return getUserById(id);
}

async function listUsers() {
  const r = await query(
    `SELECT id, username, role, quota_mb, max_analyses_month, enabled, permissions, created_at
     FROM users ORDER BY created_at DESC`,
  );
  return r.rows.map(normalizeUser);
}

async function updateUser(id, {role, quotaMb, maxAnalysesMonth, enabled, permissions}) {
  if (role !== undefined) await query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
  if (quotaMb !== undefined) await query('UPDATE users SET quota_mb = $1 WHERE id = $2', [quotaMb, id]);
  if (maxAnalysesMonth !== undefined) {
    await query('UPDATE users SET max_analyses_month = $1 WHERE id = $2', [maxAnalysesMonth, id]);
  }
  if (enabled !== undefined) {
    await query('UPDATE users SET enabled = $1 WHERE id = $2', [enabled ? true : false, id]);
  }
  if (permissions !== undefined) {
    await query('UPDATE users SET permissions = $1 WHERE id = $2', [permissions, id]);
  }
  return getUserById(id);
}

async function deleteUser(id) {
  await query('DELETE FROM users WHERE id = $1', [id]);
}

async function getSiteSetting(key) {
  const r = await query('SELECT key, value, updated_at FROM site_settings WHERE key = $1', [key]);
  return r.rows[0] || null;
}

async function setSiteSetting(key, value) {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, value, now],
  );
  return getSiteSetting(key);
}

module.exports = {
  getUserByUsername,
  getUserById,
  createUser,
  listUsers,
  updateUser,
  deleteUser,
  getSiteSetting,
  setSiteSetting,
};