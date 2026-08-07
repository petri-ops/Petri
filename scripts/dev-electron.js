#!/usr/bin/env node

/**
 * Start BioF3 desktop in renderer-HMR mode.
 *
 * One command starts:
 * 1. Vite dev server for frontend hot updates.
 * 2. Electron main process loading the Vite URL instead of frontend/dist.
 */

const { spawn } = require('child_process');
const http = require('http');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const npxCmd = isWin ? 'npx.cmd' : 'npx';
const rendererUrl = process.env.BIOF3_RENDERER_DEV_URL || 'http://localhost:3000';

const children = new Set();
let shuttingDown = false;

function spawnChild(command, args, options = {}) {
  const { shutdownOnExit = 'error', ...spawnOptions } = options;
  const child = spawn(command, args, {
    stdio: 'inherit',
    // npm.cmd / npx.cmd are batch files; on Windows they can only be launched
    // via a shell (cmd.exe /c). shell:true is required there and also safe on
    // POSIX (runs via sh -c).
    shell: true,
    detached: !isWin,
    ...spawnOptions,
  });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    if (shutdownOnExit === 'always') {
      shutdown(code || 0);
    } else if (signal !== 'SIGTERM' && code !== 0) {
      shutdown(code || 1);
    }
  });
  return child;
}

function terminateChild(child) {
  try {
    // npm and npx launch grandchildren (Vite/Electron). Killing the POSIX
    // process group prevents those grandchildren from surviving the launcher.
    if (!isWin && child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // The child may already have exited.
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    terminateChild(child);
  }
  setTimeout(() => process.exit(code), 250);
}

function urlIsAvailable(url, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForUrl(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(tick, 250);
      });
      req.setTimeout(1200, () => {
        req.destroy();
      });
    };
    tick();
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  if (await urlIsAvailable(rendererUrl)) {
    throw new Error(
      `${rendererUrl} is already serving a page. Close the previous BioF3 dev process ` +
        `before running npm run dev again.`
    );
  }

  spawnChild(npmCmd, ['--prefix', 'frontend', 'run', 'dev']);
  await waitForUrl(rendererUrl);

  spawnChild(npxCmd, ['electron', '.', '--dev'], {
    shutdownOnExit: 'always',
    env: {
      ...process.env,
      ELECTRON_IS_DEV: '1',
      NODE_ENV: 'development',
      BIOF3_RENDERER_DEV_URL: rendererUrl,
    },
  });
}

main().catch((error) => {
  console.error('[dev] failed:', error.message);
  shutdown(1);
});
