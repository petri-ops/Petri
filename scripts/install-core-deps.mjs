#!/usr/bin/env node
/**
 * scripts/install-core-deps.mjs
 *
 * postinstall hook: install node_modules for the embedded core servers
 * (core/biof3-server), which are spawned as child processes at
 * runtime and packaged verbatim via electron-builder extraResources.
 *
 * These directories have their own package.json but their node_modules are
 * gitignored, so a fresh clone needs them installed. We only install when
 * node_modules is missing (fresh clone) to keep repeat `npm install` fast.
 *
 * ── Native module ABI (dev vs packaged) ────────────────────────────────────
 * In DEV the r/py servers run under the *system* Node (see src/main.js
 * resolveNodeBin(): it uses `which node` in dev mode), so their native
 * modules must be compiled for the *system* Node ABI. At pack time
 * build/afterPack.js overwrites them with the Electron-rebuilt binaries
 * (ABI 123) for the packaged app, so a fresh `npm install` with
 * `--ignore-scripts` leaves core/* with NO usable native binary for dev.
 *
 * We therefore rebuild the native modules here for the *current* system Node
 * and skip the rebuild only when they already load cleanly under it. This
 * prevents the biof3-server "ERR_DLOPEN_FAILED / NODE_MODULE_VERSION mismatch"
 * crash that otherwise appears after a fresh clone or a Node upgrade
 * (e.g. Node 23 → 24 ABI 131 → 137).
 *
 * Escape hatches:
 *   BIOF3_SKIP_CORE_INSTALL=1   skip entirely (e.g. offline CI that pre-installs)
 *   BIOF3_FORCE_CORE_INSTALL=1  reinstall even if node_modules exists
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_SERVERS = ['core/biof3-server']; // BLOCK-30 P1: 独立 Python 后端已摘除
// Native modules in the core servers that must match the system Node ABI.
// `binary` is the compiled addon file name (convention: name with - → _).
const NATIVE_MODULES = [{ name: 'better-sqlite3', binary: 'better_sqlite3.node' }];

if (process.env.BIOF3_SKIP_CORE_INSTALL === '1') {
  console.log('[install-core-deps] skipped (BIOF3_SKIP_CORE_INSTALL=1)');
  process.exit(0);
}

const force = process.env.BIOF3_FORCE_CORE_INSTALL === '1';
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeBin = process.execPath; // the Node running this postinstall
const abi = process.versions.modules;

// Locate the compiled addon binary for a nested native module. Prefers
// build/Release/<binary>, falling back to a prebuilds/ N-API binary if one
// exists. Returns null when no candidate binary is present at all.
function nativeModuleBinaryPath(modDir) {
  const release = join(modDir, 'build', 'Release', 'better_sqlite3.node');
  if (existsSync(release)) return release;
  const pre = join(modDir, 'prebuilds');
  if (existsSync(pre)) {
    for (const plat of readdirSync(pre)) {
      const cand = join(pre, plat, 'node.napi.gnu.node');
      if (existsSync(cand)) return cand;
    }
  }
  return null;
}

// Returns true when every native module's compiled addon loads cleanly under
// the current system Node (i.e. its .node was built for this ABI).
//
// We `require()` the *specific .node binary file* — NOT the package — because
// a bare `require('better-sqlite3')` resolves upward to the hoisted root copy
// and masks a stale/missing nested binary, and the package entry can even
// resolve a fallback addon. Requiring the file directly makes dlopen fail
// (ERR_DLOPEN_FAILED / MODULE_NOT_FOUND) when it is missing or ABI-mismatched,
// which is exactly the condition we must detect and rebuild.
function nativeModulesLoad(dir) {
  for (const { name, binary } of NATIVE_MODULES) {
    const modDir = join(dir, 'node_modules', name);
    if (!existsSync(modDir)) return false;
    const bin = nativeModuleBinaryPath(modDir);
    if (!bin) return false;
    const res = spawnSync(
      nodeBin,
      ['-e', `require(${JSON.stringify(bin)})`],
      { cwd: dir, stdio: 'ignore' }
    );
    if (res.status !== 0) return false;
  }
  return true;
}

// Rebuild native modules for the current system Node. Tolerant: a build
// failure only warns (the app can still run; user can rebuild manually).
function rebuildNative(dir) {
  const names = NATIVE_MODULES.map((m) => m.name);
  const res = spawnSync(npmCmd, ['rebuild', ...names], {
    cwd: dir,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    console.warn(
      `[install-core-deps] ${dir}: native rebuild exited ${res.status}. ` +
        `If the backend fails to start, run \`npm rebuild --prefix ${dir} ${names.join(' ')}\` manually.`
    );
  }
}

for (const rel of CORE_SERVERS) {
  const dir = join(REPO_ROOT, rel);
  if (!existsSync(join(dir, 'package.json'))) {
    console.log(`[install-core-deps] ${rel}: no package.json, skip`);
    continue;
  }

  const hasNodeModules = existsSync(join(dir, 'node_modules'));

  if (!hasNodeModules) {
    // Fresh clone: install (skip lifecycle scripts; we rebuild native after).
    const useCi = existsSync(join(dir, 'package-lock.json'));
    const args = useCi ? ['ci', '--ignore-scripts'] : ['install', '--ignore-scripts'];
    console.log(`[install-core-deps] ${rel}: npm ${args.join(' ')} …`);
    const res = spawnSync(npmCmd, args, { cwd: dir, stdio: 'inherit' });
    if (res.status !== 0) {
      console.warn(
        `[install-core-deps] ${rel}: npm ${args[0]} exited ${res.status}. ` +
          `The desktop app will still install; run \`npm install --prefix ${rel}\` manually if the backend fails to start.`
      );
      continue; // nothing to rebuild yet
    }
  } else if (force) {
    console.log(`[install-core-deps] ${rel}: force reinstall (BIOF3_FORCE_CORE_INSTALL=1)`);
    const res = spawnSync(npmCmd, ['install', '--ignore-scripts'], { cwd: dir, stdio: 'inherit' });
    if (res.status !== 0) {
      console.warn(`[install-core-deps] ${rel}: npm install exited ${res.status}.`);
    }
  }

  // Ensure native modules match the current system Node ABI.
  if (nativeModulesLoad(dir)) {
    console.log(`[install-core-deps] ${rel}: native modules OK for Node ABI ${abi}, skip rebuild`);
  } else {
    console.log(`[install-core-deps] ${rel}: rebuilding native modules for Node ABI ${abi} …`);
    rebuildNative(dir);
  }
}
