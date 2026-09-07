// ============================================================
// Core utilities: path resolution + node bin + port reservation
//
// Extracted from src/main.js by SUB-15.1 PHASE 1.
// Original locations:
//   L44         agentWorkbenchFlags
//   L60-62      runtimePathsModule
//   L67-70      isDevMode
//   L72-73      rendererDevUrl
//   L108        IS_DEV
//   L109        PROJECT_ROOT
//   L112-117    resolveCoreRoot
//   L120-125    resolveResource
//   L128-130    resolveCore
//   L139-171    resolveNodeBin
//   L172        NODE_BIN
//   L175-219    BASE_R_PACKAGES
//   L220-229    BASE_PY_PACKAGES
//   L245-265    reserveAvailablePort
//
// Low-risk: utility functions. All values are derived from
// process.env / path module only. Safe for --check via lazy
// Electron access.
// ============================================================

const path = require("path");
const fs = require("fs");
const nodeNet = require("net");

// ── Runtime environment flags ───────────────────────────────────────────────

// Safe for --check: uses process.argv / env, not Electron app state.
const isDevMode =
  process.argv.includes("--dev") ||
  process.env.ELECTRON_IS_DEV === "1" ||
  process.env.NODE_ENV === "development";

// Safe for --check: plain env access.
const rendererDevUrl =
  process.env.BIOF3_RENDERER_DEV_URL || "http://localhost:3000";

// ── IS_DEV / PROJECT_ROOT ─────────────────────────────────────────────────
//
// Lazy: only reads Electron app state when called (not at module load),
// so the file is safe to `node --check` without Electron running.

let _IS_DEV = null;
let _PROJECT_ROOT = null;

function _ensureElectronState() {
  if (_IS_DEV !== null) return;
  try {
    const { app } = require("electron");
    _IS_DEV = !app.isPackaged;
    // __dirname = <repo>/src/main. Two levels up lands on the repo root.
    // (The previous single ".." stopped at <repo>/src and made resolveCore()
    // / PROJECT_ROOT point one level too shallow. That was harmless while the
    // root better-sqlite3 happened to match the system Node ABI; after the
    // Electron 30 -> 41 bump the root copy carries the Electron ABI (145), so
    // the shallow root made the migration child fall back to it and crash
    // with "NODE_MODULE_VERSION 145 ... requires 137".)
    _PROJECT_ROOT = _IS_DEV ? path.join(__dirname, "..", "..") : process.resourcesPath;
  } catch {
    // Fallback for non-Electron env (e.g. `node --check`):
    _IS_DEV = process.env.NODE_ENV === "development" || process.env.ELECTRON_IS_DEV === "1";
    _PROJECT_ROOT = path.join(__dirname, "..", "..");
  }
}

const IS_DEV = (() => {
  _ensureElectronState();
  return _IS_DEV;
})();

const PROJECT_ROOT = (() => {
  _ensureElectronState();
  return _PROJECT_ROOT;
})();

// ── Path resolution helpers ────────────────────────────────────────────────

function resolveCoreRoot() {
  _ensureElectronState();
  if (_IS_DEV) {
    return path.join(_PROJECT_ROOT, "core");
  }
  return path.join(process.resourcesPath, "core");
}

function resolveResource(...parts) {
  _ensureElectronState();
  if (_IS_DEV) {
    return path.join(_PROJECT_ROOT, ...parts);
  }
  return path.join(process.resourcesPath, ...parts);
}

function resolveCore(...parts) {
  return path.join(resolveCoreRoot(), ...parts);
}

// ── Node executable resolution ─────────────────────────────────────────────

function resolveNodeBin() {
  let isDev = null;
  try {
    const { app } = require("electron");
    isDev = !app.isPackaged;
  } catch {
    isDev = process.env.NODE_ENV === "development" || process.env.ELECTRON_IS_DEV === "1";
  }
  if (!isDev) {
    if (process.platform === "darwin") {
      const helperName = `${path.basename(process.execPath)} Helper`;
      const helperBin = path.join(
        path.dirname(process.execPath),
        "..",
        "Frameworks",
        `${helperName}.app`,
        "Contents",
        "MacOS",
        helperName,
      );
      if (fs.existsSync(helperBin)) return helperBin;
    }
    return process.execPath;
  }
  try {
    const { execFileSync } = require("child_process");
    const { getNodeLocator } = require("./platform-compat");
    const locator = getNodeLocator(process.platform);
    const bin = execFileSync(locator, ["node"], {
      encoding: "utf-8",
      timeout: 3000,
    })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    if (bin && fs.existsSync(bin)) return bin;
  } catch {
    /* fallback */
  }
  return "node";
}

const NODE_BIN = resolveNodeBin();

// ── Base package sets ─────────────────────────────────────────────────────

const BASE_R_PACKAGES = new Set([
  "ggplot2",
  "dplyr",
  "tidyr",
  "reshape2",
  "data.table",
  "pheatmap",
  "ggrepel",
  "RColorBrewer",
  "patchwork",
  "cowplot",
  "plotly",
  "igraph",
  "ggraph",
  "tidygraph",
  "circlize",
  "ComplexHeatmap",
  "UpSetR",
  "ggalluvial",
  "treemap",
  "networkD3",
  "Seurat",
  "SingleCellExperiment",
  "MOFA2",
  "CellChat",
  "WGCNA",
  "maftools",
  "clusterProfiler",
  "enrichplot",
  "DOSE",
  "org.Hs.eg.db",
  "survival",
  "survminer",
  "rms",
  "pROC",
  "glmnet",
  "caret",
  "timeROC",
  "PRROC",
  "dcurves",
  "scatterpie",
  "Rtsne",
  "STRINGdb",
  "gganimate",
]);

const BASE_PY_PACKAGES = new Set([
  "matplotlib",
  "numpy",
  "pandas",
  "scanpy",
  "anndata",
  "scikit-learn",
  "seaborn",
  "scipy",
]);

// ── Port reservation ──────────────────────────────────────────────────────

function reserveAvailablePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const tryListen = (port) => {
      const server = nodeNet.createServer();
      server.unref();
      server.once("error", (error) => {
        if (port === preferredPort && error.code === "EADDRINUSE") {
          tryListen(0);
          return;
        }
        reject(error);
      });
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        const address = server.address();
        const selectedPort = typeof address === "object" && address ? address.port : port;
        server.close((error) => (error ? reject(error) : resolve(selectedPort)));
      });
    };
    tryListen(preferredPort);
  });
}

module.exports = {
  // Flags
  isDevMode,
  rendererDevUrl,
  // IS_DEV / PROJECT_ROOT — lazy (safe for --check)
  IS_DEV,
  PROJECT_ROOT,
  // Path helpers
  resolveCoreRoot,
  resolveResource,
  resolveCore,
  // Node resolution
  resolveNodeBin,
  NODE_BIN,
  // Package sets
  BASE_R_PACKAGES,
  BASE_PY_PACKAGES,
  // Port
  reserveAvailablePort,
};
