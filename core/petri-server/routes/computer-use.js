'use strict';

/**
 * routes/computer-use.js — BLOCK-229 电脑控制 sidecar 状态面（只读 + 探针）。
 *
 * - GET  /api/computer-use/status：平台/是否支持/是否已构建/是否运行中 + 权限提示；
 * - POST /api/computer-use/probe：真实 spawn 一次 sidecar 并跑 probe（返回平台/权限/verbs），
 *   sidecar 未构建时诚实 503 sidecar_not_built（附构建指引，不假装就绪）。
 *
 * 输入注入仍走 computer_* 工具链（完全访问档 + ackToken 两段确认），本路由不提供任何控制动作。
 */

const { getComputerUseHost } = require('../helpers/computer-use-host');

function requireUser(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' });
    return null;
  }
  return userId;
}

function permissionNote(platform) {
  return platform === 'darwin'
    ? 'macOS 需要「屏幕录制」与「辅助功能」权限；首次调用由系统弹窗引导。'
    : 'Windows 无需额外系统权限；控制类工具仍需完全访问档并通过确认 token。';
}

module.exports = function registerComputerUse(app) {
  app.get('/api/computer-use/status', (req, res) => {
    if (!requireUser(req, res)) return;
    try {
      const host = getComputerUseHost();
      const status = host.status();
      return res.json({ ok: true, ...status, permissionNote: permissionNote(status.platform) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: (error && error.message) || 'status_failed' });
    }
  });

  // BLOCK-265（C-38 补）— PiP 截帧：主进程窗口经 HTTP 拉（主进程禁引 core 实现 R5；host 单例归后端）
  app.get('/api/computer-use/pip-frame', async (req, res) => {
    if (!requireUser(req, res)) return;
    try {
      const host = getComputerUseHost();
      const shot = await host.requestWithRecovery('screenshot', {}, 8000);
      const b64 = (shot && (shot.pngBase64 || shot.imageBase64 || shot.base64)) || null;
      return res.json({ ok: true, pngBase64: b64, error: b64 ? null : 'frame_shape_unexpected', at: Date.now() });
    } catch (error) {
      return res.status(503).json({ ok: false, pngBase64: null, error: (error && error.code) || 'screenshot_failed' });
    }
  });

    app.post('/api/computer-use/probe', async (req, res) => {
    if (!requireUser(req, res)) return;
    try {
      const host = getComputerUseHost();
      const probe = await host.requestWithRecovery('probe', {}, 15000);
      return res.json({ ok: true, probe, permissionNote: permissionNote(host.status().platform) });
    } catch (error) {
      const code = (error && error.code) || 'computer_use_error';
      const status = code === 'sidecar_not_built' ? 503 : 500;
      return res.status(status).json({
        ok: false,
        error: code,
        message: (error && error.message) || 'probe_failed',
      });
    }
  });
};
