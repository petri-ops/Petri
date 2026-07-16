#!/usr/bin/env node
/**
 * scripts/install-core-deps.mjs
 *
 * postinstall hook: install node_modules for the embedded core servers
 * (core/r-server, core/py-server), which are spawned as child processes at
 * runtime and packaged verbatim via electron-builder extraResources.
 *
 * These directories have their own package.json but their node_modules are
 * gitignored, so a fresh clone needs them installed. We only install when
 * node_modules is missing (fresh clone) to keep repeat `npm install` fast.
 *
 * Escape hatches:
 *   BIOF3_SKIP_CORE_INSTALL=1   skip entirely (e.g. offline CI that pre-installs)
 *   BIOF3_FORCE_CORE_INSTALL=1  reinstall even if node_modules exists
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_SERVERS = ['core/r-server', 'core/py-server'];

if (process.env.BIOF3_SKIP_CORE_INSTALL === '1') {
  console.log('[install-core-deps] skipped (BIOF3_SKIP_CORE_INSTALL=1)');
  process.exit(0);
}

const force = process.env.BIOF3_FORCE_CORE_INSTALL === '1';
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

for (const rel of CORE_SERVERS) {
  const dir = join(REPO_ROOT, rel);
  if (!existsSync(join(dir, 'package.json'))) {
    console.log(`[install-core-deps] ${rel}: no package.json, skip`);
    continue;
  }
  if (!force && existsSync(join(dir, 'node_modules'))) {
    console.log(`[install-core-deps] ${rel}: node_modules present, skip (set BIOF3_FORCE_CORE_INSTALL=1 to reinstall)`);
    continue;
  }
  // Prefer reproducible `npm ci` when a lockfile exists, else `npm install`.
  const useCi = existsSync(join(dir, 'package-lock.json'));
  const args = useCi ? ['ci'] : ['install'];
  console.log(`[install-core-deps] ${rel}: npm ${args.join(' ')} …`);
  const res = spawnSync(npmCmd, args, { cwd: dir, stdio: 'inherit' });
  if (res.status !== 0) {
    console.warn(
      `[install-core-deps] ${rel}: npm ${args[0]} exited ${res.status}. ` +
        `The desktop app will still install; run \`npm install --prefix ${rel}\` manually if the backend fails to start.`
    );
  }
}
