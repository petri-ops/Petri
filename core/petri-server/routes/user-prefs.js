'use strict';

/**
 * BLOCK-86 L1 — 多端用户偏好（主题/字号/强调色）服务端化。
 *
 * 手机投影、桌面、协作成员界面共用同一后端：偏好存
 * <dataDir>/user-prefs.json（单用户本地实例，LOCAL_USER 语义），
 * 任何端修改全端生效（其余端轮询/回前台拉取应用）。
 * localStorage 保留为快速启动缓存（服务端值优先）。
 *
 * BLOCK-203 W4a P2（runlist W4a）：校验与落点读写收归
 * `helpers/user-prefs.js`（形状真相在 `core/packages/shared-config/config-schema.js`
 * 的 `user-prefs` 族），本文件只做 HTTP 翻译——此前这里自写 `sanitize` 是全仓第 N 份
 * 同构校验，也是"写了不存在的键不会被发现"的一条通道。
 */

const express = require('express');
const userPrefs = require('../helpers/user-prefs.js');

module.exports = function registerUserPrefs(app, { dataDir } = {}) {
  const dir = dataDir || userPrefs.resolveDataDir();

  app.get('/api/user/prefs', (_req, res) => {
    const { prefs, diagnostics } = userPrefs.readPrefsWithDiagnostics(dir);
    // 诊断是 additive：读侧只报告不拒（旧文件里的未知键不得炸前端）
    res.json({ ok: true, prefs, ...(diagnostics.length > 0 ? { diagnostics } : {}) });
  });

  app.put('/api/user/prefs', express.json({ limit: '4kb' }), (req, res) => {
    try {
      const result = userPrefs.writePrefs(dir, req.body || {});
      if (!result.ok) {
        // 未知键 = 写不进（此前静默丢掉）。已注册键的非法值仍是消毒语义，不会走到这里。
        return res.status(400).json({
          ok: false,
          error: 'prefs_value_rejected',
          prefs: result.prefs,
          diagnostics: result.diagnostics,
        });
      }
      return res.json({
        ok: true,
        prefs: result.prefs,
        ...(result.diagnostics.length > 0 ? { diagnostics: result.diagnostics } : {}),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'prefs_write_failed', message: error.message });
    }
  });
};
