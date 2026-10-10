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
const { app, ipcMain, dialog, net, shell, nativeImage } = require("electron");

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
  // Genomics / Petri domain
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

  // UI-444 加映（用户反馈「点击了下载但没有窗口出来」）——文本另存为：
  // 原生保存对话框（用户确认位置/文件名=显式同意）+ 主进程写入所选路径。
  // 与 downloadFromUrl（静默落 Downloads）并存：需要位置可控的导出走本通道。
  const SAVE_TEXT_MAX_BYTES = 20 * 1024 * 1024;
  ipcMain.handle(CHANNELS.file.saveTextFile, async (_event, payload) => {
    if (!mainWindow) return { ok: false, error: "no main window" };
    const { defaultName, content } = payload || {};
    if (typeof defaultName !== "string" || !defaultName.trim()) {
      return { ok: false, error: "invalid default name" };
    }
    // 文件名非法字符校验（含控制字符；用字符码而非正则——no-control-regex 棘轮）
    const invalidName = /["<>|?*]/.test(defaultName)
      || defaultName === "." || defaultName === ".."
      || Array.from(defaultName).some((ch) => ch.charCodeAt(0) <= 0x1f);
    if (invalidName) {
      return { ok: false, error: "invalid file name" };
    }
    if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > SAVE_TEXT_MAX_BYTES) {
      return { ok: false, error: "content too large or invalid" };
    }
    try {
      // defaultPath 用「绝对路径」（下载目录+默认名）——裸文件名在部分 Windows
      // Electron 版本上不回填文件名框（用户实测：对话框弹出但文件名为空）。
      const defaultPath = path.join(app.getPath("downloads"), defaultName);
      const opts = {
        title: "导出会话",
        defaultPath,
        filters: [{ name: "Markdown", extensions: ["md"] }, { name: "文本文件", extensions: ["txt"] }, { name: "所有文件", extensions: ["*"] }],
      };
      // 无父窗口形态：带父窗口的模态形式在本机 Electron 41 实测中 defaultPath/filters
      // 被丢弃（探针隔离环境同参正常，app 内空对话框——2026-09-26 UI-444 抓真）。
      const { canceled, filePath } = await dialog.showSaveDialog(opts);
      if (canceled || !filePath) return { ok: true, canceled: true };
      fs.writeFileSync(filePath, content, "utf8");
      return { ok: true, path: filePath };
    } catch (e) {
      console.error("[desktop] save text file failed:", e.message);
      return { ok: false, error: e.message };
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

  // UI-400-2 → UI-453 — 文件导出/下载到本地：渲染层把预览同源 API URL 交给主进程，
  // 保存对话框 + 受限来源（仅本机 API 主机名）流式写盘。blob 下载在 Electron
  // 里会以 GUID.tmp 落盘且无文件名，故下载收尾必须在主进程完成。
  // UI-453（用户裁决「按理说应该是弹出个文件管理器 我们选择对应的路径确定后
  // 这个文件可以到对应路径下」）：原「静默落 Downloads」退役，改原生保存对话框
  // 选路径（默认文件名预填、取消静默），落盘后在资源管理器中高亮该文件。
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
      console.log("[desktop] download-from-url invoked:", name);
      // UI-453 — 原生保存对话框：选路径确认后流式落盘（覆盖确认由对话框自身处理）；
      // 取消静默返回 canceled（前端不显示错误）。
      // Windows 保存框完整形态：defaultPath 绝对路径（裸文件名实测不预填）+ 按扩展名
      // filters——无 filters 时 Windows 的文件名框不回填 defaultPath（用户两轮实机
      // 反馈抓真：弹窗出现但文件名空），补齐后文件名随 defaultPath 预填。
      const ext = path.extname(name).slice(1).toLowerCase();
      const dialogOptions = {
        title: "下载到…",
        defaultPath: path.join(app.getPath("downloads"), name),
        filters: ext
          ? [
              { name: `${ext.toUpperCase()} 文件`, extensions: [ext] },
              { name: "所有文件", extensions: ["*"] },
            ]
          : [{ name: "所有文件", extensions: ["*"] }],
      };
      const hasParent = Boolean(mainWindow && !mainWindow.isDestroyed());
      console.log("[desktop] save-dialog options:", JSON.stringify({
        title: dialogOptions.title,
        defaultPath: dialogOptions.defaultPath,
        filters: dialogOptions.filters,
        hasParent,
      }));
      // UI-453 加映三（实机抓真）— 【不传 parent】：传 BrowserWindow 时本机 Windows
      // 弹的是通用「另存为」外壳（title/filters/文件名预填全失效，地址落桌面），
      // 不传 parent 时同一 options 完整生效（最小脚本 A/B 对照实验双证）。
      const picked = await dialog.showSaveDialog(dialogOptions);
      if (picked.canceled || !picked.filePath) {
        console.log("[desktop] download-from-url canceled by user");
        return { ok: false, canceled: true };
      }
      const filePath = picked.filePath;
      console.log("[desktop] download-from-url picked:", filePath);

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
      // 成功反馈：在系统文件管理器中定位并高亮该文件（失败不阻塞成功语义）
      try { shell.showItemInFolder(filePath); } catch { /* ignore */ }
      console.log("[desktop] download-from-url saved:", filePath);
      return { ok: true, path: filePath };
    } catch (e) {
      console.error("[desktop] download from url failed:", e.message);
      return { ok: false, error: e.message };
    }
  });

  // UI-453 加映二 — OS 拖出导出：dragstart 时渲染层请主进程接管为真文件拖拽
  // （webContents.startDrag，Electron 官方文件拖出通道）。本地项目直接拖源文件
  // （OS 级复制语义，零拷贝）；ssh 项目先经本机 REST 拉到临时文件再拖（>16MB 端点
  // 诚实 413，拖出失败可见）。DownloadURL 方案（Windows 实测不落盘）就此退役。
  ipcMain.handle(CHANNELS.file.startFileDrag, async (event, payload) => {
    try {
      const { localPath, url, name } = payload || {};
      if (typeof name !== "string" || !name) {
        return { ok: false, error: "invalid drag payload" };
      }
      let filePath = null;
      if (typeof localPath === "string" && localPath) {
        filePath = localPath;
      } else if (typeof url === "string" && url) {
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
        // ssh/远程：先拉到临时文件（用户仍按住鼠标；下载完成即接管拖拽）
        const tempDir = path.join(app.getPath("temp"), "petri-dragout");
        fs.mkdirSync(tempDir, { recursive: true });
        filePath = path.join(tempDir, `${Date.now()}-${name}`);
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
      } else {
        return { ok: false, error: "localPath or url required" };
      }
      if (!fs.existsSync(filePath)) {
        return { ok: false, error: "source file not found" };
      }
      let icon;
      try {
        icon = await app.getFileIcon(filePath, { size: "normal" });
      } catch {
        icon = nativeImage.createEmpty();
      }
      event.sender.startDrag({ file: filePath, icon });
      return { ok: true };
    } catch (e) {
      console.error("[desktop] start-drag failed:", e.message);
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
