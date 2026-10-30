'use strict';

/**
 * routes/storage-capabilities.js — RW-05 存储能力协商只读面。
 *
 * GET /api/storage/capabilities → { ok, active, name, capabilities }
 * 消费方（UI/测试/未来适配器切换面）按能力位分支；只读零副作用。
 */

function registerStorageCapabilitiesRoute(app) {
  if (typeof app.get !== 'function') {
    throw new Error('storage-capabilities register requires an Express app');
  }
  app.get('/api/storage/capabilities', (req, res) => {
    try {
      // 惰性 require：保证存储注册（init.js）先于本路由执行
      const storage = require('../../shared-backend/storage');
      const active = storage.getActiveStorageCapabilities();
      return res.json({ ok: true, active: active.name, name: active.name, capabilities: active });
    } catch (error) {
      return res.status(503).json({ ok: false, error: 'storage_capabilities_unavailable', message: error.message });
    }
  });
}

module.exports = { registerStorageCapabilitiesRoute };
