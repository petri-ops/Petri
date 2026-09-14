'use strict';

/**
 * BLOCK-87 L4 — 投影页面数据 HTTP 化（Skills / 已装插件列表）。
 *
 * 桌面端这两页走 Electron IPC（skills:discover / plugins.listInstalled），
 * 手机投影（垫片降级）拿不到数据。本路由把 core 侧同源能力暴露为
 * 会话门内 REST，供投影环境的前端替代消费：
 *   GET /api/skills/registry        → SkillsSDK.listSkills()（只读清单）
 *   GET /api/plugins/installed      → plugin-loader 已装插件安全投影
 * 执行/安装等写操作投影下暂不开放（诚实边界，桌面端操作）。
 */

const express = require('express');
const path = require('node:path');

function resolveProjectRoot() {
  return process.env.BIOF3_PROJECT_ROOT
    || path.resolve(__dirname, '..', '..');
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

  // 已装插件清单（plugin-loader 单一真相的安全投影）
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
      }));
      res.json({ ok: true, plugins });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'plugins_list_failed', message: error.message });
    }
  });
};
