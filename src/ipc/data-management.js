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
  ipcMain.handle("data:info", async () => {
    try {
      const dataDir = process.env.BIOF3_LOCAL_DATA_DIR;
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
      // biof3.db 单独算
      const dbPath = path.join(dataDir, "biof3.db");
      if (fs.existsSync(dbPath)) {
        try {
          breakdown["biof3.db"] = fs.statSync(dbPath).size;
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
      return { ok: true, dataDir, total, breakdown };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 在系统文件管理器中打开数据目录
  ipcMain.handle("data:open-dir", async () => {
    try {
      const dataDir = process.env.BIOF3_LOCAL_DATA_DIR;
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
}

module.exports = { setupDataManagementIpc };
