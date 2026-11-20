const CHANNELS = require('./channels');
// EVO-4 — 只读证据通道：R5 合法层（core/shared-backend）+ 路径/构造器单源
const { resolveCore } = require('../main/core-utils');
const { resolveDbPath } = require(resolveCore('shared-backend', 'db-connection-policy.js'));
// ============================================================
// IPC handlers: data:info, data:open-dir
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 1.
// Original location: src/main.js ~line 1822 (setupDataManagementIpc).
//
// Self-contained: only depends on process.env, fs, path, shell.
// No mainWindow injection needed.
// ============================================================

const fs = require("fs");
const path = require("path");
const { ipcMain, shell } = require("electron");

// BLOCK-150 ⑨：空间占用明细的中文名（可操作文案）。
// breakdown 的键必须是磁盘上的真实目录/文件名（path.join 直接用），不能中文化；
// 用户可读名称经 labels 字段随 payload 下发，前端按 labels[key] ?? key 渲染。
const BREAKDOWN_LABELS = {
  runtimes: "运行时（R / Python）",
  plugins: "插件",
  results: "分析结果",
  uploads: "上传文件",
  logs: "日志",
  tmp: "临时文件",
  "petri.db": "本地数据库",
  "ai-settings.json": "AI 配置",
};

function setupDataManagementIpc() {
  // 递归计算目录大小（字节）
  function getDirSize(dir) {
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    const walk = (d) => {
      try {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isSymbolicLink()) continue; // 跳过符号链接避免循环
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) {
            try {
              total += fs.statSync(full).size;
            } catch {}
          }
        }
      } catch {}
    };
    walk(dir);
    return total;
  }

  // 返回数据目录路径 + 各子目录大小（runtimes / plugins / results / uploads / logs / db）
  ipcMain.handle(CHANNELS.data.info, async () => {
    try {
      const dataDir = process.env.PETRI_LOCAL_DATA_DIR;
      if (!dataDir) return { ok: false, error: "数据目录未配置" };
      const breakdown = {};
      const subdirs = [
        "runtimes",
        "plugins",
        "results",
        "uploads",
        "logs",
        "tmp",
      ];
      for (const sub of subdirs) {
        const subPath = path.join(dataDir, sub);
        if (fs.existsSync(subPath)) breakdown[sub] = getDirSize(subPath);
      }
      // petri.db 单独算
      const dbPath = path.join(dataDir, "petri.db");
      if (fs.existsSync(dbPath)) {
        try {
          breakdown["petri.db"] = fs.statSync(dbPath).size;
        } catch {}
      }
      // ai-settings.json 等
      const aiPath = path.join(dataDir, "ai-settings.json");
      if (fs.existsSync(aiPath)) {
        try {
          breakdown["ai-settings.json"] = fs.statSync(aiPath).size;
        } catch {}
      }
      const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
      const labels = {};
      for (const key of Object.keys(breakdown)) {
        if (BREAKDOWN_LABELS[key]) labels[key] = BREAKDOWN_LABELS[key];
      }
      return { ok: true, dataDir, total, breakdown, labels };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 在系统文件管理器中打开数据目录
  ipcMain.handle(CHANNELS.data.openDir, async () => {
    try {
      const dataDir = process.env.PETRI_LOCAL_DATA_DIR;
      if (!dataDir) return { ok: false, error: "数据目录未配置" };
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      await shell.openPath(dataDir);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // EVO-4 — 只读：harness 自进化证据（lessons 频率/状态 + incidents 日频）。
  // 零写入、零外发；路径与构造器单源均来自 core/shared-backend 与 migration-runner（R5 合规）。
  ipcMain.handle(CHANNELS.data.lessonEvidence, async () => {
    try {
      const dbPath = resolveDbPath(process.env);
      if (!dbPath || !fs.existsSync(dbPath)) {
        return { ok: true, lessons: [], incidentTrend: [], reason: 'db-not-found' };
      }
      const { loadDatabaseConstructor } = require('../migration-runner');
      const Database = loadDatabaseConstructor();
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        const lessons = db.prepare(
          `SELECT id, source_fingerprint, title, scope, status, confidence,
                  occurrences_before, occurrences_after, created_at, last_seen_at
           FROM lessons ORDER BY last_seen_at DESC LIMIT 200`
        ).all();
        const incidentTrend = db.prepare(
          `SELECT date(created_at) AS day, COUNT(*) AS count
           FROM incidents GROUP BY day ORDER BY day ASC`
        ).all();
        return { ok: true, lessons, incidentTrend };
      } finally {
        db.close();
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { setupDataManagementIpc };
