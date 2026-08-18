#!/usr/bin/env node
'use strict';

/**
 * Resilient CDP bridge: keeps playwright MCP alive across Electron restarts.
 *
 * Loop:
 *   1. Poll for CDP endpoint (blocks until Electron is ready)
 *   2. Spawn playwright MCP with the resolved endpoint
 *   3. When playwright exits → go back to step 1
 *
 * The script never exits on its own. Only Ctrl+C / SIGTERM stops it.
 */
const http = require('http');
const { spawn } = require('child_process');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npx';
const PLAYWRIGHT_MCP = '@playwright/mcp@latest';
const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_POLL_MS = 800;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const req = mod.get(url, (res) => {
      if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('fetch timeout')); });
  });
}

async function pollCdp(port) {
  let attempt = 0;
  while (true) {
    attempt++;
    if (attempt === 1) {
      log(`polling for dev Electron CDP on port ${port}...`);
    } else if (attempt % 20 === 0) {
      log(`still polling for CDP... (attempt ${attempt})`);
      log(`start dev with: BIOF3_DEV_ELECTRON_CDP=1 npm run dev`);
    }
    try {
      const v = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      if (v?.webSocketDebuggerUrl) {
        log(`CDP ready: ${v.webSocketDebuggerUrl}`);
        return v.webSocketDebuggerUrl;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, CDP_POLL_MS));
  }
}

function log(msg) {
  process.stderr.write(`[cdp-wrap] ${msg}\n`);
}

async function spawnPlaywright(wsUrl) {
  log(`spawning @playwright/mcp with ${wsUrl}`);
  const child = spawn(npmCmd, [PLAYWRIGHT_MCP, '--no-sandbox'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: isWin,
    env: {
      ...process.env,
      PLAYWRIGHT_MCP_CDP_ENDPOINT: wsUrl,
      CDP_ENDPOINT: wsUrl,
    },
  });

  // Forward playwright stdout/stderr
  child.stdout?.on('data', (c) => process.stdout.write(c));
  child.stderr?.on('data', (c) => process.stderr.write(c));

  return new Promise((resolve) => {
    child.on('exit', (code) => {
      log(`playwright exited (code=${code})`);
      resolve(code);
    });
  });
}

async function main() {
  while (true) {
    const wsUrl = await pollCdp(CDP_PORT);
    await spawnPlaywright(wsUrl);
    log(`playwright stopped — Electron may have restarted, re-polling CDP...`);
  }
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
