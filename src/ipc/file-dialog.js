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
const path = require("path");
const { ipcMain, dialog, shell } = require("electron");

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
  // Genomics / BioF3 domain
  ".h5ad", ".loom", ".mtx", ".h5", ".rds", ".rdata",
  ".maf", ".vcf", ".bed", ".gtf", ".gff", ".fasta", ".fa", ".fastq", ".fq",
]);

function setupFileDialogIpc({ mainWindow } = {}) {
  ipcMain.handle("file:save-dialog", async (event, defaultName) => {
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

  ipcMain.handle("file:open-dialog", async (event, optionsOrFilters) => {
    if (!mainWindow) return null;
    try {
      const isOptions =
        optionsOrFilters &&
        typeof optionsOrFilters === "object" &&
        !Array.isArray(optionsOrFilters);
      const filters = isOptions ? optionsOrFilters.filters : optionsOrFilters;
      const properties =
        isOptions && optionsOrFilters.openDirectory
          ? ["openDirectory", "createDirectory"]
          : ["openFile"];
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        filters: Array.isArray(filters) ? filters : [],
        properties,
      });
      return canceled ? null : filePaths[0];
    } catch (e) {
      console.error("[desktop] open dialog failed:", e.message);
      return null;
    }
  });

  ipcMain.handle("file:open-path", async (_event, targetPath) => {
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

  ipcMain.handle("file:open-workspace-file", async (_event, workspacePath, relativePath) => {
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
}

module.exports = { setupFileDialogIpc, ALLOWED_OPEN_EXTENSIONS };
