/**
 * routes/ssh-projects.js — BLOCK-67 P1 SSH 远程项目创建支持面。
 *
 * POST /api/ssh-projects/validate { alias, remotePath }
 *   → ensureAgent 部署 + fs_stat 验证远程路径存在且为目录（创建前校验，fail-closed）。
 * GET /api/ssh-projects/targets
 *   → 目标候选（注册表 + ~/.ssh/config 发现），复用 BLOCK-57 target-registry。
 *
 * 复用通道层，不建第二套目标真相；错误如实分类（transport.* / not_found / not_a_dir）。
 */
const { requireTrustedDesktopOrigin } = require('../helpers/local-request-boundary');
const { resolveWorkspaceBackend, safeRemoteJoin } = require('../helpers/workspace-gateway');
const { createTargetRegistry } = require('../helpers/remote-execution/target-registry');
const { createRemoteJobRunner } = require('../helpers/remote-execution/remote-job-runner');

function createSshProjectsRouter() {
  // 目标真相复用 execution_targets + ssh-config 发现（BLOCK-57），不建第二套。
  // 懒初始化：避免模块加载期触碰 DB（与 files.js 的 handler 内 require 模式一致）。
  let registry = null;
  function getRegistry() {
    if (!registry) {
      const remoteRunner = createRemoteJobRunner();
      registry = createTargetRegistry({
        db: require('../db').getAsyncDatabase(),
        ensureAgent: ({ alias }) => remoteRunner.ensureAgent({ alias }),
      });
    }
    return registry;
  }
  return function registerSshProjectRoutes(app) {
    app.get('/api/ssh-projects/targets', requireTrustedDesktopOrigin, async (req, res) => {
      try {
        const { registered, discovered } = await getRegistry().listWithDiscovery();
        res.json({
          ok: true,
          targets: [
            ...registered.map((t) => ({ alias: t.alias, label: t.label, status: t.status, registered: true })),
            ...discovered.map((t) => ({ alias: t.alias, label: t.hostName, registered: false })),
          ],
        });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    app.post('/api/ssh-projects/validate', requireTrustedDesktopOrigin, async (req, res) => {
      const alias = String(req.body?.alias || '');
      const remotePath = String(req.body?.remotePath || '');
      const invalid = require('../db').validateSshProjectFields({ sshHost: alias, remotePath });
      if (invalid) return res.status(400).json({ ok: false, error: invalid });

      try {
        // 复用 Gateway ssh 后端（含 ensureAgent 部署）；路径必须已存在且为目录。
        const { backend } = resolveWorkspaceBackend({ workspace_kind: 'ssh', ssh_host: alias, remote_path: remotePath });
        const abs = safeRemoteJoin(remotePath, '');
        if (!abs) return res.status(400).json({ ok: false, error: 'invalid_remote_path' });
        const stat = await backend.stat(abs);
        if (stat.type !== 'dir') {
          return res.status(400).json({ ok: false, error: 'not_a_dir', detail: { type: stat.type } });
        }
        const sample = (await backend.list(abs)).slice(0, 20);
        return res.json({ ok: true, stat, sample });
      } catch (e) {
        if (e.remoteError === 'not_found') return res.status(400).json({ ok: false, error: 'not_found' });
        if (e.classified) {
          return res.status(502).json({ ok: false, error: `远程连接失败: ${e.classified.kind}`, retryable: e.classified.retryable === true });
        }
        return res.status(500).json({ ok: false, error: e.message });
      }
    });
  };
}

module.exports = function registerSshProjectRoutes(app) { createSshProjectsRouter()(app); };
module.exports.createSshProjectsRouter = createSshProjectsRouter;
