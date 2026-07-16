// Platform admin operations: PostgreSQL backup list/actions and OSS stats/cleanup.
const cacheManager = require('../cache-manager');
const backupManager = require('../backup-manager');

const API_TOKEN = process.env.BIOF3_API_TOKEN || 'biof3-figcode-2026';

function isAdmin(req) {
  if (req.isInternal) return true;
  if (req.headers['x-api-token'] === API_TOKEN) return true;
  return req.user?.role === 'admin';
}

module.exports = function registerAdminOpsRoutes(app) {
  app.get('/api/admin/backup/list', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({status: 'error', error: '需要管理员权限'});
    }
    try {
      const backups = await backupManager.listBackups();
      res.json({status: 'ok', backups});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.post('/api/admin/backup/db', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({status: 'error', error: '需要管理员权限'});
    }
    try {
      const result = await backupManager.backupNow();
      res.json({status: result.success ? 'ok' : 'error', result, error: result.error});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.get('/api/admin/backup/download/:name', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({status: 'error', error: '需要管理员权限'});
    }
    try {
      const url = await backupManager.getDownloadUrl(req.params.name);
      res.json({status: 'ok', url});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.get('/api/admin/oss/stats', async (req, res) => {
    try {
      const stats = await cacheManager.getOssStats();
      res.json({status: 'ok', stats});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });

  app.post('/api/admin/oss/cleanup', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({status: 'error', error: '需要管理员权限'});
    }
    try {
      const opts = {
        dryRun: req.body?.dryRun !== false,
        maxAgeDays: req.body?.maxAgeDays,
      };
      const report = await cacheManager.cleanupOss(opts);
      res.json({status: 'ok', report});
    } catch (e) {
      res.status(500).json({status: 'error', error: e.message});
    }
  });
};
