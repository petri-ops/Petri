'use strict';

/**
 * BLOCK-86 L1 — 多端用户偏好（主题/字号/强调色）服务端化。
 *
 * 手机投影、桌面、协作成员界面共用同一后端：偏好存
 * <dataDir>/user-prefs.json（单用户本地实例，LOCAL_USER 语义），
 * 任何端修改全端生效（其余端轮询/回前台拉取应用）。
 * localStorage 保留为快速启动缓存（服务端值优先）。
 */

const express = require('express');
const fs = require('fs');
const path = require('node:path');

const THEMES = new Set(['system', 'light', 'dark']);
// 与 frontend/src/themes/accents.ts 的 AccentId 集合一字不差（曾漏 blue）
const ACCENTS = new Set(['teal', 'blue', 'violet', 'rose', 'amber']);

function prefsFile(dataDir) {
  return path.join(dataDir, 'user-prefs.json');
}

function readPrefs(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsFile(dataDir), 'utf8'));
    return sanitize(raw);
  } catch {
    return {};
  }
}

function sanitize(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    if (THEMES.has(raw.theme)) out.theme = raw.theme;
    if (Number.isFinite(Number(raw.fontScale))) {
      const scale = Math.min(1.4, Math.max(0.8, Number(raw.fontScale)));
      if (scale !== 1) out.fontScale = scale;
    }
    if (ACCENTS.has(raw.accent)) out.accent = raw.accent;
  }
  return out;
}

function writePrefs(dataDir, patch) {
  const next = { ...readPrefs(dataDir), ...sanitize(patch) };
  fs.mkdirSync(path.dirname(prefsFile(dataDir)), { recursive: true });
  const tmp = `${prefsFile(dataDir)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, prefsFile(dataDir));
  return next;
}

function resolveDataDir() {
  return process.env.PETRI_LOCAL_DATA_DIR
    || process.env.LOCAL_DATA_DIR
    || path.join(process.cwd(), 'data');
}

module.exports = function registerUserPrefs(app, { dataDir } = {}) {
  const dir = dataDir || resolveDataDir();

  app.get('/api/user/prefs', (_req, res) => {
    res.json({ ok: true, prefs: readPrefs(dir) });
  });

  app.put('/api/user/prefs', express.json({ limit: '4kb' }), (req, res) => {
    try {
      res.json({ ok: true, prefs: writePrefs(dir, req.body || {}) });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'prefs_write_failed', message: error.message });
    }
  });
};
