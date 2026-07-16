// Platform admin users and guest-permission routes.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../db');
const permissions = require('../helpers/permissions');
const guestPermissions = require('../helpers/guest-permissions');
const {JWT_SECRET} = require('../auth');

function requireAdmin(req, res) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({status: 'error', error: '无权访问'});
    return false;
  }
  return true;
}

module.exports = function registerAdminUsersRoutes(app) {
  app.get('/api/admin/users', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // OPT_ADMIN_USERS_v1: single-pass aggregation instead of O(users×projects×datasets×analyses) nested loops.
    // Also fixes the original bug: listProjects() was global (no user filter) then filtered in JS.
    const adb = db.getAsyncDbForLegacyModules();
    const rows = await adb.prepare(`
      SELECT
        u.id,
        u.username,
        u.role,
        u.quota_mb,
        u.max_analyses_month,
        u.enabled,
        u.permissions,
        u.created_at,
        COALESCE(pj.cnt, 0)   AS project_count,
        COALESCE(ds.cnt, 0)   AS dataset_count,
        COALESCE(ds.total_size, 0) AS dataset_bytes,
        COALESCE(an.cnt, 0)   AS analysis_count
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS cnt FROM projects GROUP BY user_id
      ) pj ON pj.user_id = u.id
      LEFT JOIN (
        SELECT p.user_id, COUNT(d.id) AS cnt, COALESCE(SUM(d.size),0) AS total_size
        FROM projects p
        LEFT JOIN datasets d ON d.project_id = p.id
        GROUP BY p.user_id
      ) ds ON ds.user_id = u.id
      LEFT JOIN (
        SELECT p.user_id, COUNT(a.id) AS cnt
        FROM projects p
        LEFT JOIN datasets d ON d.project_id = p.id
        LEFT JOIN analyses a ON a.dataset_id = d.id
        GROUP BY p.user_id
      ) an ON an.user_id = u.id
      ORDER BY u.created_at DESC
    `).all();

    const enriched = rows.map((u) => ({
      ...u,
      quota_mb: u.quota_mb || 500,
      enabled: u.enabled !== 0,
      permissions: (() => {
        try { return permissions.effectivePermissions(u); }
        catch { return null; }
      })(),
      permissions_raw: u.permissions || null,
      stats: {
        projects: u.project_count,
        datasets: u.dataset_count,
        analyses: u.analysis_count,
        storageBytes: u.dataset_bytes,
        storageHuman: u.dataset_bytes > 0 ? (u.dataset_bytes / 1024 / 1024).toFixed(1) + ' MB' : '0 MB',
      },
    }));
    res.json({status: 'ok', users: enriched});
  });

  app.put('/api/admin/users/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const {role, quotaMb, maxAnalysesMonth, enabled, permissions: permsInput} = req.body;
    let permsArg;
    if (permsInput !== undefined) {
      try {
        permsArg = permissions.normalizePermissionsForStore(permsInput);
      } catch {
        permsArg = undefined;
      }
    }
    const user = await db.updateUserAsync(req.params.id, {role, quotaMb, maxAnalysesMonth, enabled, permissions: permsArg});
    if (!user) return res.status(404).json({status: 'error', error: '用户不存在'});
    res.json({status: 'ok', user});
  });

  app.get('/api/admin/guest-permissions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const [raw, guestPerms] = await Promise.all([
        guestPermissions.getGuestPermissionsRawAsync(),
        guestPermissions.effectiveGuestPermissionsAsync(),
      ]);
      res.json({
        status: 'ok',
        permissions: guestPerms,
        defaults: guestPermissions.GUEST_DEFAULT_PERMS,
        raw,
      });
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.put('/api/admin/guest-permissions', express.json(), async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const guestPerms = await guestPermissions.setGuestPermissionsAsync(req.body?.permissions ?? req.body);
      res.json({status: 'ok', permissions: guestPerms});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.get('/api/public/guest-permissions', async (req, res) => {
    try {
      // Hottest read on the platform (every visitor, anonymous included). Use the
      // async variant (getSiteSettingAsync) so it never goes through the deasync
      // sync path that froze the event loop (2026-06-08).
      res.json({status: 'ok', permissions: await guestPermissions.effectiveGuestPermissionsAsync()});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.delete('/api/admin/users/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (req.params.id === req.user.id) return res.status(400).json({status: 'error', error: '不能删除自己'});
    await db.deleteUserAsync(req.params.id);
    res.json({status: 'ok'});
  });

  app.get('/api/admin/invite-code', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const code = process.env.INVITE_CODE || 'not-configured';
    res.json({status: 'ok', inviteCode: code});
  });

  app.post('/api/admin/users', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const {username, password, role, quotaMb} = req.body;
    if (!username || !password) return res.status(400).json({status: 'error', error: '缺少用户名或密码'});
    const existing = await db.getUserByUsernameAsync(username);
    if (existing) return res.status(409).json({status: 'error', error: '用户名已存在'});
    const id = 'u_' + Math.random().toString(36).slice(2, 10);
    const hash = bcrypt.hashSync(password, 10);
    await db.createUserAsync({id, username, passwordHash: hash, role: role || 'user'});
    if (quotaMb != null) await db.updateUserAsync(id, {quotaMb});
    res.json({status: 'ok', user: {id, username, role: role || 'user'}});
  });

  app.post('/api/admin/impersonate/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const user = await db.getUserByIdAsync(req.params.id);
    if (!user) return res.status(404).json({status: 'error', error: '用户不存在'});
    const token = jwt.sign({userId: user.id, username: user.username, role: user.role}, JWT_SECRET, {expiresIn: '1h'});
    res.json({status: 'ok', token, user: {id: user.id, username: user.username, role: user.role}});
  });
};
