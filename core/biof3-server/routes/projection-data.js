'use strict';

/**
 * BLOCK-87 L4 — 投影页面数据 HTTP 化（Skills / 插件商店 / 运行时 / 领域包）。
 *
 * 桌面端这些页走 Electron IPC（skills:discover / plugins.* / runtime:status /
 * pack:*），手机投影（垫片降级）拿不到数据。本路由把 core 侧同源能力暴露为
 * 会话门内 REST，供投影环境的前端替代消费：
 *   GET /api/skills/registry        → SkillsSDK.listSkills()（只读清单）
 *   GET /api/plugins/installed      → plugin-loader 已装插件安全投影
 *   GET /api/plugins/catalog        → resources/runtime/manifest.json（可装目录，
 *                                     与桌面 getBuiltInManifest 同一文件）
 *   GET /api/runtime/status         → executors R/Python 可执行性（federation
 *                                     health 同款探测，与工具执行同一真相）
 *   GET /api/packs/installed        → pack-registry 安装记录（dataDir/packs/installed.json）
 *   GET /api/packs/available        → pack-registry 兄弟仓发现 + 已装标记
 * 执行/安装等写操作投影下暂不开放（诚实边界，桌面端操作）。
 *
 * L4-2 实测修正：第一批把已装列表包成 `{ok,packs}` 信封，而桌面 IPC
 * `plugin:list-installed` 返回裸数组——投影桥形状错位叠加缺 listRemote，
 * 手机插件商店整段空白（用户实测「手机端和桌面不一致」）。本批对齐 IPC 契约。
 */

const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// dev：core/biof3-server/routes → 仓根；打包：resources/core/... → resources/
//（extraResources 布局下 runtime/manifest.json 与 src/plugin/paths.js 的
// RESOURCES_PATH 同层，两端解析一致）。
function resolveRepoRoot() {
  return process.env.BIOF3_PROJECT_ROOT
    || path.resolve(__dirname, '..', '..', '..');
}

// 与 src/ipc/pack.js getDataDir 同一事实（同机同记录，读面只读）。
function resolveDataDir() {
  return process.env.BIOF3_LOCAL_DATA_DIR
    || path.join(os.homedir(), 'Documents', 'Gewu-Local');
}

module.exports = function registerProjectionDataRoutes(app) {
  // Skills 只读清单（与 main 进程 skills:discover 同一 SDK 数据源）
  app.get('/api/skills/registry', (_req, res) => {
    try {
      const { createDefaultSDK } = require('../../shared-backend/skills-sdk.js');
      const sdk = createDefaultSDK();
      const skills = sdk.listSkills();
      res.json({ ok: true, skills });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'skills_discover_failed', message: error.message });
    }
  });

  // 已装插件清单（plugin-loader 单一真相的安全投影）——与桌面 IPC
  // `plugin:list-installed` 同为裸数组语义；桥层负责包前端要的形状。
  app.get('/api/plugins/installed', (_req, res) => {
    try {
      const loader = require('../plugin-loader');
      const all = loader.getAllPlugins();
      const plugins = all.map((p) => ({
        id: p.id,
        version: p.version ?? null,
        label: p.label ?? p.displayName ?? p.id,
        description: typeof p.description === 'string' ? p.description.slice(0, 300) : '',
        sourceType: p._sourceType ?? null,
        type: p.type ?? null,
        language: p.language ?? null,
      }));
      res.json({ ok: true, plugins });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'plugins_list_failed', message: error.message });
    }
  });

  // 可装插件目录（与桌面 getBuiltInManifest 同一 manifest 文件——BLOCK-83 后
  // 核心清单只含 R/Python 运行时；远程清单合并与安装仍走桌面端）。
  app.get('/api/plugins/catalog', (_req, res) => {
    try {
      const manifestPath = path.join(resolveRepoRoot(), 'resources', 'runtime', 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      res.json({ ok: true, manifest: { plugins: manifest.plugins || {} } });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'plugins_catalog_failed', message: error.message });
    }
  });

  // 运行时状态（federation /federation/api/health 同款探测——与工具执行同一真相）
  app.get('/api/runtime/status', (_req, res) => {
    const status = { r: { installed: false, path: null }, python: { installed: false, path: null } };
    try {
      const { getExecutor } = require('../../shared-backend/executors');
      for (const lang of ['r', 'python']) {
        try {
          const executor = getExecutor(lang);
          status[lang] = {
            installed: Boolean(executor?.binPath && fs.existsSync(executor.binPath)),
            path: executor?.binPath ?? null,
          };
        } catch { /* 未注册执行器 → installed:false */ }
      }
    } catch { /* executors 模块不可用 → 全 false */ }
    res.json({ ok: true, runtime: status });
  });

  // 领域包安装记录（与桌面 pack:list-installed 同一 dataDir/packs/installed.json）
  app.get('/api/packs/installed', (_req, res) => {
    try {
      const packRegistry = require('../../shared-backend/pack-registry');
      res.json({ ok: true, packs: packRegistry.readInstalledPacks(resolveDataDir()) });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'packs_list_failed', message: error.message });
    }
  });

  // 领域包可装发现（与桌面 pack:list-available 同一 pack-registry 逻辑 + 已装标记）
  app.get('/api/packs/available', (_req, res) => {
    try {
      const packRegistry = require('../../shared-backend/pack-registry');
      const available = packRegistry.discoverAvailablePacks({ projectRoot: resolveRepoRoot() });
      const installedIds = new Set(packRegistry.readInstalledPacks(resolveDataDir()).map((p) => p.packId));
      res.json({ ok: true, packs: available.map((p) => ({ ...p, installed: installedIds.has(p.packId) })) });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'packs_available_failed', message: error.message });
    }
  });
};
