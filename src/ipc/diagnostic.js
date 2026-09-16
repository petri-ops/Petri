const CHANNELS = require('./channels');
// ============================================================
// IPC handler: diagnostic:export
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 4.
// Original location: src/main.js ~line 1008 (setupDiagnosticIpc).
//
// Dependencies injected via parameter:
//   - mainWindow: for default save dialog
//   - getLogDir(): log directory path (from backend-proc-manager)
//   - flushLogs(): flush all log streams before export
//   - redaction: redactSensitiveText function (self-required)
//
// archiver v8 is ESM-only — Electron's Node 20 cannot require()
// it, so we use dynamic `import("archiver")` and fall back to
// .txt concatenation when archiver is unavailable.
// ============================================================

const fs = require("fs");
const path = require("path");
const { ipcMain, app, dialog } = require("electron");

function setupDiagnosticIpc({ mainWindow, getLogDir, flushLogs } = {}) {
  // BLOCK-10 S-004: assertTrustedSender helper, additive alongside BLOCK-3.
  const { createSenderGuard } = require("./_sender-guard");
  // BLOCK-10 S-007 / BLOCK-3 invariant: capture a live getter so the guard
  // tracks window replacement (app.on('activate') recreates mainWindow).
  const assertSender = createSenderGuard(typeof mainWindow === "function" ? mainWindow : () => mainWindow);
  ipcMain.handle(CHANNELS.diagnostic.export, async (event, requestedTargetPath) => {
    const deny = assertSender(event); if (deny) return deny;
    try {
      const logDir = getLogDir();
      const { createWriteStream } = fs;
      const zlib = require("zlib");
      // 模块本体在 src/diagnostic-redaction.js（BLOCK-75 P0 实测抓真修：BLOCK-9.1 抽取到
      // src/ipc/ 后相对路径未跟改，`./` 使整条导出链每次 require 即死——dialog 都不弹）。
      const { redactSensitiveText } = require("../diagnostic-redaction");

      // BLOCK-10 S-007: 路径强约束 — diagnostic:export 永远走 user-chosen
      // 保存对话框,绝不接受 renderer 注入的 targetPath。这避免一个被入侵的
      // webview 通过这条 IPC 写入到任意位置。
      let outPath = null;
      if (!mainWindow || (typeof mainWindow === "function" ? mainWindow() : mainWindow)?.isDestroyed?.()) {
        return { ok: false, error: "no window available for save dialog" };
      }
      {
        const win = typeof mainWindow === "function" ? mainWindow() : mainWindow;
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: "导出诊断日志",
          defaultPath: `gewu-diagnostic-${ts}.zip`,
          filters: [{ name: "ZIP", extensions: ["zip"] }],
        });
        if (canceled) return { ok: false, error: "cancelled" };
        outPath = filePath;
      }
      // requestedTargetPath is ignored by design; keep parameter so the IPC
      // signature remains stable for callers.
      void requestedTargetPath;
      if (!outPath) return { ok: false, error: "no output path" };

      // 先 flush 日志流
      flushLogs();

      // 收集系统信息
      const sysInfo = {
        platform: process.platform,
        arch: process.arch,
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        timestamp: new Date().toISOString(),
        rRuntimeConfigured: !!process.env.BIOF3_R_HOME,
        pythonRuntimeConfigured: !!process.env.BIOF3_PY_HOME,
      };

      // 用简单的方式打包：逐文件写入 zip（避免额外依赖）
      // 如果有 archiver 就用，没有就用 tar.gz
      let usedArchiver = false;
      try {
        // archiver v8 is ESM-only; Electron's Node 20 cannot require() it.
        const { ZipArchive } = await import("archiver");
        const output = createWriteStream(outPath);
        const archive = new ZipArchive({ zlib: { level: 6 } });
        output.on("close", () => {});
        archive.pipe(output);

        // 添加日志文件
        for (const name of ["biof3-server"]) { // BLOCK-30 P1: py-server 已摘除 {
          const logFile = path.join(logDir, `${name}.log`);
          if (fs.existsSync(logFile)) {
            archive.append(
              redactSensitiveText(fs.readFileSync(logFile, "utf8")),
              { name: `${name}.log` },
            );
          }
        }
        // 添加系统信息
        archive.append(JSON.stringify(sysInfo, null, 2), {
          name: "system-info.json",
        });
        // 添加 installed plugins
        try {
          const { getInstalledPlugins } = require("../plugin-manager");
          archive.append(JSON.stringify(getInstalledPlugins(), null, 2), {
            name: "installed-plugins.json",
          });
        } catch {}

        archive.append(
          "This diagnostic package excludes databases, settings, conversations, results, and credential files.\n",
          { name: "privacy.txt" },
        );

        await archive.finalize();
        usedArchiver = true;
      } catch {
        // archiver 不可用 — 用 tar.gz fallback
      }

      if (!usedArchiver) {
        // fallback: 写一个简单的 .txt 包（日志拼接 + 系统信息）
        const lines = [];
        lines.push("=== Gewu Diagnostic Package ===");
        lines.push(JSON.stringify(sysInfo, null, 2));
        lines.push("");
        for (const name of ["biof3-server"]) { // BLOCK-30 P1: py-server 已摘除 {
          const logFile = path.join(logDir, `${name}.log`);
          lines.push(`\n=== ${name}.log ===`);
          try {
            lines.push(
              redactSensitiveText(fs.readFileSync(logFile, "utf8").slice(-5000)),
            );
          } catch {
            lines.push("(log file not found)");
          }
        }
        try {
          const { getInstalledPlugins } = require("../plugin-manager");
          lines.push("\n=== installed-plugins.json ===");
          lines.push(JSON.stringify(getInstalledPlugins(), null, 2));
        } catch {}
        lines.push("\n=== privacy ===");
        lines.push("诊断包不包含数据库、设置、对话、结果或凭据文件。");
        fs.writeFileSync(outPath, lines.join("\n"));
      }

      return { ok: true, path: outPath };
    } catch (e) {
      console.error("[diagnostic] export failed:", e.message);
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { setupDiagnosticIpc };
