const CHANNELS = require('./channels');
// ============================================================
// IPC handlers: file:save-dialog, file:open-dialog,
//               file:open-path, file:open-workspace-file
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 1.
// Original location: src/main.js ~line 1608 (setupFileDialogIpc).
//
// Requires mainWindow reference (via parameter) and the
// ALLOWED_OPEN_EXTENSIONS whitelist (defined here for
// self-containment). Note: the original ALLOWED_OPEN_EXTENSIONS
// whitelist in main.js is preserved verbatim to keep preload.js
// and any external security-policy references in sync.
// ============================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, ipcMain, dialog, net, shell } = require("electron");

/**
 * File-type whitelist for the file:open-path IPC channel (SEC-002).
 * Mirrors the original constant in src/main.js:75-91.
 */
const ALLOWED_OPEN_EXTENSIONS = Object.freeze([
  // Text & data
  ".txt", ".md", ".json", ".jsonc", ".csv", ".tsv", ".xml", ".html", ".htm",
  ".css", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
  ".log", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
  ".py", ".r", ".R", ".sql", ".graphql", ".vue", ".svelte",
  // Images (commonly previewed)
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
  // Documents & archives
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".rar",
  // Genomics / Gewu domain
  ".h5ad", ".loom", ".mtx", ".h5", ".rds", ".rdata",
  ".maf", ".vcf", ".bed", ".gtf", ".gff", ".fasta", ".fa", ".fastq", ".fq",
]);

function setupFileDialogIpc({ mainWindow } = {}) {
  ipcMain.handle(CHANNELS.file.saveDialog, async (event, defaultName) => {
    if (!mainWindow) return null;
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName,
      });
      return canceled ? null : filePath;
    } catch (e) {
      console.error("[desktop] save dialog failed:", e.message);
      return null;
    }
  });

  ipcMain.handle(CHANNELS.file.openDialog, async (event, optionsOrFilters) => {
    if (!mainWindow) return null;
    try {
      const isOptions =
        optionsOrFilters &&
        typeof optionsOrFilters === "object" &&
        !Array.isArray(optionsOrFilters);
      const filters = isOptions ? optionsOrFilters.filters : optionsOrFilters;
      const isDirectory = isOptions && optionsOrFilters.openDirectory;
      const properties = isDirectory
        ? ["openDirectory", "createDirectory"]
        : ["openFile"];
      // UI-304 加映三 — 对齐 ZCode 实测可用的调用姿势：
      // ① 目录选择时不带 filters（含空数组）：macOS 上 filters 会挂
      //    allowed-types 校验链，目录永远匹配不上 → 「打开」按钮恒置灰；
      // ② 文件选择路径维持原行为（filters 对扩展名过滤有意义）。
      const showOpts = { properties };
      if (!isDirectory && Array.isArray(filters) && filters.length > 0) {
        showOpts.filters = filters;
      }
      // UI-304 后续二 — 目录选择不传 parent window（对齐 Codex；传 parent 可能触发分栏视图怪癖）
      const parent = isDirectory ? null : mainWindow;
      const { canceled, filePaths } = await dialog.showOpenDialog(parent, showOpts);
      return canceled ? null : filePaths[0];
    } catch (e) {
      console.error("[desktop] open dialog failed:", e.message);
      return null;
    }
  });

  // UI-257 — 手动输入路径校验：目录选择面板被系统禁用「打开」时的兜底通道。
  // 校验存在 + 是目录，返回 realpath；不做 TCC/共享限制探测（交由创建失败可见化）。
  ipcMain.handle(CHANNELS.file.validateDirectory, async (_event, targetPath) => {
    try {
      if (typeof targetPath !== "string" || !targetPath.trim()) {
        return { ok: false, error: "路径为空" };
      }
      const trimmed = targetPath.trim().replace(/[\\/]+$/, "") || "/";
      if (!path.isAbsolute(trimmed)) {
        return { ok: false, error: "必须是绝对路径（以 / 开头）" };
      }
      const st = fs.statSync(trimmed);
      if (!st.isDirectory()) {
        return { ok: false, error: "该路径不是文件夹" };
      }
      return { ok: true, data: { path: fs.realpathSync(trimmed) } };
    } catch (e) {
      return { ok: false, error: e.code === "ENOENT" ? "路径不存在" : e.message };
    }
  });

  // UI-259 — 应用内文件夹浏览：系统目录面板对共享路径禁用「打开」时的兜底通道。
  // 列出目标目录下的一级子目录（隐藏项跳过），供 FolderPicker 组件导航选择。
  ipcMain.handle(CHANNELS.file.listDirectory, async (_event, dirPath) => {
    try {
      const raw = typeof dirPath === "string" ? dirPath.trim() : "";
      const target = raw || os.homedir();
      const real = fs.realpathSync(target);
      if (!fs.statSync(real).isDirectory()) {
        return { ok: false, error: "该路径不是文件夹" };
      }
      const dirs = fs
        .readdirSync(real, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== ".")
        .map((entry) => ({ name: entry.name, path: path.join(real, entry.name) }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans"));
      const parent = path.dirname(real);
      return {
        ok: true,
        data: {
          path: real,
          parent: parent === real ? null : parent,
          home: os.homedir(),
          dirs,
        },
      };
    } catch (e) {
      const message =
        e.code === "EACCES" || e.code === "EPERM" ? "没有权限访问该文件夹" : e.message;
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(CHANNELS.file.openPath, async (_event, targetPath) => {
    try {
      if (!targetPath || typeof targetPath !== "string") {
        return { ok: false, error: "invalid path" };
      }
      if (!fs.existsSync(targetPath)) {
        return { ok: false, error: "path does not exist" };
      }
      const ext = path.extname(targetPath).toLowerCase();
      if (ext && !ALLOWED_OPEN_EXTENSIONS.includes(ext)) {
        return {
          ok: false,
          error: `file type '${ext}' is not allowed to be opened; supported types: ${ALLOWED_OPEN_EXTENSIONS.join(", ")}`,
        };
      }
      const error = await shell.openPath(targetPath);
      return error ? { ok: false, error } : { ok: true };
    } catch (e) {
      console.error("[desktop] open path failed:", e.message);
      return { ok: false, error: e.message };
    }
  });

  // UI-400-2 — 文件导出/下载到本地：渲染层把预览同源 API URL 交给主进程，
  // 保存对话框 + 受限来源（仅本机 API 主机名）流式写盘。blob 下载在 Electron
  // 里会以 GUID.tmp 落盘且无文件名，故下载收尾必须在主进程完成。
  ipcMain.handle(CHANNELS.file.downloadFromUrl, async (_event, payload) => {
    const { url, name } = payload || {};
    try {
      if (typeof url !== "string" || typeof name !== "string" || !name) {
        return { ok: false, error: "invalid download payload" };
      }
      if (/["<>|?*\u0000-\u001f]/.test(name) || name === "." || name === "..") {
        return { ok: false, error: "invalid file name" };
      }
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return { ok: false, error: "invalid url" };
      }
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        !["127.0.0.1", "localhost"].includes(parsed.hostname)
      ) {
        return { ok: false, error: "url origin not allowed" };
      }
      // 浏览器式静默落 Downloads（重名自动 -2/-3 后缀）；不弹保存对话框——
      // 点击即下载的心智，另存为交给「系统应用打开后另存」路径。
      const downloads = app.getPath("downloads");
      const ext = path.extname(name);
      const stem = name.slice(0, name.length - ext.length);
      let filePath = path.join(downloads, name);
      for (let n = 2; fs.existsSync(filePath); n += 1) {
        filePath = path.join(downloads, `${stem}-${n}${ext}`);
      }

      await new Promise((resolve, reject) => {
        const request = net.request(url);
        const file = fs.createWriteStream(filePath);
        request.on("response", (response) => {
          if (response.statusCode !== 200) {
            file.destroy();
            reject(new Error(`HTTP ${response.statusCode}`));
            request.abort();
            return;
          }
          response.on("error", reject);
          response.pipe(file);
        });
        request.on("error", reject);
        file.on("error", reject);
        file.on("finish", resolve);
        request.end();
      });
      return { ok: true, path: filePath };
    } catch (e) {
      console.error("[desktop] download from url failed:", e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.file.openWorkspaceFile, async (_event, workspacePath, relativePath) => {
    try {
      if (
        typeof workspacePath !== "string" ||
        typeof relativePath !== "string" ||
        !workspacePath ||
        !relativePath ||
        path.isAbsolute(relativePath)
      ) {
        return { ok: false, error: "invalid workspace file path" };
      }
      const realRoot = fs.realpathSync(workspacePath);
      const realTarget = fs.realpathSync(path.resolve(realRoot, relativePath));
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
        return { ok: false, error: "file is outside the project workspace" };
      }
      if (!fs.statSync(realTarget).isFile()) {
        return { ok: false, error: "target is not a file" };
      }
      const error = await shell.openPath(realTarget);
      return error ? { ok: false, error } : { ok: true };
    } catch (e) {
      console.error("[desktop] open workspace file failed:", e.message);
      return { ok: false, error: e.message };
    }
  });

  /**
   * BLOCK-19 — workspace:write-text-file
   * 覆盖项目 workspace 内的文本文件；与 file:open-workspace-file 共用同一安全边界
   * (realpathSync + startsWith + 必须是已存在的 file)。不创建新文件、不允许跳出 workspace。
   * @param {string} workspacePath
   * @param {string} relativePath  必须相对路径（path.isAbsolute 校验）
   * @param {string} content       必须 string
   */
  ipcMain.handle(CHANNELS.workspace.writeTextFile, async (_event, workspacePath, relativePath, content) => {
    try {
      if (
        typeof workspacePath !== "string" ||
        typeof relativePath !== "string" ||
        typeof content !== "string" ||
        !workspacePath ||
        !relativePath ||
        path.isAbsolute(relativePath)
      ) {
        return { ok: false, error: "invalid args" };
      }
      const realRoot = fs.realpathSync(workspacePath);
      const realTarget = fs.realpathSync(path.resolve(realRoot, relativePath));
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
        return { ok: false, error: "file is outside the project workspace" };
      }
      if (!fs.statSync(realTarget).isFile()) {
        return { ok: false, error: "target is not a file" };
      }
      fs.writeFileSync(realTarget, content, "utf-8");
      return { ok: true, data: { savedAt: new Date().toISOString() } };
    } catch (e) {
      console.error("[desktop] write workspace file failed:", e.message);
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { setupFileDialogIpc };
