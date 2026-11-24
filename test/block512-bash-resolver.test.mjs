'use strict';

/**
 * BLOCK-512 P2 — bash-resolver 检测逻辑单测（检测器可注入，Windows 形态由注入模拟；
 * 实机 Windows 验证属外部环境，如实登记不可达——见 helper 文件头）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkBash, isWslLauncherPath } = require('./helpers/bash-resolver.cjs');

const WSL_BASH = 'C:\\Users\\Admin\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe';
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

test('darwin/正常环境：PATH bash 直通（本机形态，行为不变）', () => {
  const r = checkBash({ platform: 'darwin', whichFn: () => '/bin/bash' });
  assert.deepEqual(r, { ok: true, bashPath: '/bin/bash' });
});

test('win32 + WSL launcher + Git Bash 在标准位：自动改用显式路径（零人工）', () => {
  const r = checkBash({
    platform: 'win32',
    whichFn: () => WSL_BASH,
    existsFn: (p) => p === GIT_BASH,
  });
  assert.equal(r.ok, true);
  assert.equal(r.bashPath, GIT_BASH);
  assert.match(r.note, /WSL launcher/);
});

test('win32 + WSL launcher + 无 Git Bash：ok:false 带可操作原因（假红→诚实 skip）', () => {
  const r = checkBash({ platform: 'win32', whichFn: () => WSL_BASH, existsFn: () => false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /WSL launcher/);
  assert.match(r.reason, /AUDIT-LOG 2026-10-20/);
});

test('bash 缺失：ok:false 带原因', () => {
  const r = checkBash({ platform: 'darwin', whichFn: () => null });
  assert.equal(r.ok, false);
  assert.match(r.reason, /没有 bash/);
});

test('isWslLauncherPath 判据：WindowsApps 形态命中、Git Bash 形态不命中', () => {
  assert.equal(isWslLauncherPath(WSL_BASH), true);
  assert.equal(isWslLauncherPath(GIT_BASH), false);
  assert.equal(isWslLauncherPath('/bin/bash'), false);
});
