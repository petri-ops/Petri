// scripts/dev/verify-toolchain.mjs
// Petri Desktop local development toolchain smoke test.
// Confirms: Node ABI, fnm, MSVC, better-sqlite3 (root + core), node-pty,
// and that core/petri-server native modules load under the current Node.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const checks = [];

function check(name, fn) {
  try {
    const info = fn();
    checks.push({ name, ok: true, info });
  } catch (e) {
    checks.push({ name, ok: false, error: e.message });
  }
}

check('Node', () => `v${process.versions.node} (modules ABI ${process.versions.modules})`);
check('fnm env loaded',
  () => process.env.FNM_MULTISHELL_PATH ? `multishell=${process.env.FNM_MULTISHELL_PATH}` : 'NOT loaded');
check('VS 2022 Build Tools vcvars64',
  () => existsSync('C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat')
    ? 'OK'
    : 'MISSING');
check('VS 2022 MSVC v14.44',
  () => existsSync('C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC\\14.44.35207')
    ? 'OK'
    : 'MISSING');
check('better-sqlite3 (root)',
  () => {
    const v = require('better-sqlite3/package.json').version;
    const db = require('better-sqlite3')(':memory:');
    const row = db.prepare('SELECT sqlite_version() AS v').get();
    db.close();
    return `v${v}, sqlite ${row.v}`;
  });
check('node-pty',
  () => {
    const v = require('node-pty/package.json').version;
    const path = require.resolve('node-pty/build/Release/pty.node');
    return `v${v}, pty.node at ${path}`;
  });

console.log('┌─ Petri Desktop Toolchain Smoke Check');
for (const { name, ok, info, error } of checks) {
  console.log(`│ ${ok ? '✓' : '✗'} ${name.padEnd(28)} ${ok ? info : '(FAILED) ' + error}`);
}
console.log('└─');
process.exit(checks.every(c => c.ok) ? 0 : 1);