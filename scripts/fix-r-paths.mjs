#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rHome = process.argv[2];

if (!rHome || !fs.existsSync(rHome)) {
  console.error('Usage: node scripts/fix-r-paths.mjs <R_HOME_DIR>');
  process.exit(1);
}

if (process.platform !== 'darwin') {
  console.log(`[fix-r-paths] ${process.platform} detected; dylib path fix is macOS-only, skipping.`);
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shellScript = path.join(__dirname, 'fix-r-paths.sh');

if (!fs.existsSync(shellScript)) {
  console.error(`[fix-r-paths] missing shell helper: ${shellScript}`);
  process.exit(1);
}

execFileSync('bash', [shellScript, rHome], {
  stdio: 'inherit',
  env: process.env,
});
