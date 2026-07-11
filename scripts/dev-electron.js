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
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown && code !== 0 && signal !== 'SIGTERM') {
      shutdown(code || 1);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  setTimeout(() => process.exit(code), 250);
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
  spawnChild(npmCmd, ['--prefix', 'frontend', 'run', 'dev']);
  await waitForUrl(rendererUrl);

  spawnChild(npxCmd, ['electron', '.', '--dev'], {
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
