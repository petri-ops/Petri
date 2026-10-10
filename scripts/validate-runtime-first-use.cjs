#!/usr/bin/env node

"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const dataDir = process.env.PETRI_LOCAL_DATA_DIR;
if (!dataDir) {
  console.error("[runtime-first-use] PETRI_LOCAL_DATA_DIR is required");
  process.exit(2);
}

const resolvedDataDir = path.resolve(dataDir);
const defaultDataDir = path.join(app.getPath("documents"), "Petri-Local");
if (resolvedDataDir === path.resolve(defaultDataDir)) {
  console.error("[runtime-first-use] refusing to use the default user data directory");
  process.exit(2);
}
if (fs.existsSync(resolvedDataDir) && fs.readdirSync(resolvedDataDir).length > 0) {
  console.error(`[runtime-first-use] target must be empty: ${resolvedDataDir}`);
  process.exit(2);
}
fs.mkdirSync(resolvedDataDir, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return (result.stdout || result.stderr || "").trim();
}

async function main() {
  await app.whenReady();
  const pluginManager = require("../src/plugin-manager");
  const manifest = await pluginManager.getRemoteManifest();
  const platform = pluginManager.detectPlatform();
  if (platform !== "macos-arm64") {
    throw new Error(`runtime first-use artifact is not published for ${platform}`);
  }

  for (const id of ["petri-r-runtime", "petri-py-runtime"]) {
    const entry = manifest.plugins[id];
    if (!entry) throw new Error(`manifest entry missing: ${id}`);
    let lastPercent = -1;
    await pluginManager.installPlugin(
      { id, manifest: entry, platform },
      (ratio) => {
        const percent = Math.floor(ratio * 100);
        if (percent >= lastPercent + 10 || percent === 100) {
          lastPercent = percent;
          console.log(`[runtime-first-use] ${id} ${percent}%`);
        }
      },
    );
  }

  const status = pluginManager.getRuntimeStatus();
  if (!status.r.installed || !status.python.installed) {
    throw new Error(`runtime status is incomplete: ${JSON.stringify(status)}`);
  }

  const rscript = path.join(resolvedDataDir, "runtimes", "R", "bin", "Rscript");
  const python = path.join(resolvedDataDir, "runtimes", "Python", "bin", "python3");
  const rVersion = run(rscript, ["--version"]);
  const pythonVersion = run(python, ["--version"]);
  const installed = pluginManager.getInstalledPlugins();
  const installedIds = new Set(installed.map((entry) => entry.id));
  for (const id of ["petri-r-runtime", "petri-py-runtime"]) {
    if (!installedIds.has(id)) throw new Error(`installed ledger missing: ${id}`);
  }

  console.log(`[runtime-first-use] R ready: ${rVersion}`);
  console.log(`[runtime-first-use] Python ready: ${pythonVersion}`);
  console.log(`[runtime-first-use] PASS dataDir=${resolvedDataDir}`);
}

main()
  .then(() => app.quit())
  .catch((error) => {
    console.error("[runtime-first-use] FAIL", error);
    app.exit(1);
  });
