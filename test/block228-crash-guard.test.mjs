/**
 * BLOCK-228 — 本地崩溃记录（session-health / dump 清单 / 测试实例模拟守卫）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');
const { createCrashGuard, evaluateSessionHealth } = require(path.join(ROOT, 'src/main/crash-guard.js'));

function tempApp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-crash-'));
  const userData = path.join(root, 'userData');
  const crashDumps = path.join(root, 'Crashpad', 'completed');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(crashDumps, { recursive: true });
  return {
    root,
    app: { getPath: (name) => (name === 'userData' ? userData : crashDumps) },
    crashDumps,
    userData,
  };
}

const crashReporter = { start() {} };

test('evaluateSessionHealth：cleanExit 缺省/true/false 三态', () => {
  assert.equal(evaluateSessionHealth(null, []).uncleanExit, false);
  assert.equal(evaluateSessionHealth({ cleanExit: true }, []).uncleanExit, false);
  assert.equal(evaluateSessionHealth({ cleanExit: false, startedAt: 't0' }, []).uncleanExit, true);
  const result = evaluateSessionHealth({ cleanExit: false }, [{ name: 'a' }, { name: 'b' }]);
  assert.equal(result.previousStartedAt, null);
  assert.deepEqual(result.dumps.map((d) => d.name), ['a', 'b']);
});

test('干净退出后重启不报异常；未标记退出则下次报异常', () => {
  const { app, root } = tempApp();
  try {
    const first = createCrashGuard({ app, crashReporter });
    first.start();
    assert.equal(first.getStatus().uncleanExit, false);
    first.markCleanExit();

    const second = createCrashGuard({ app, crashReporter });
    second.start();
    assert.equal(second.getStatus().uncleanExit, false, '上次 cleanExit=true');

    const third = createCrashGuard({ app, crashReporter });
    third.start();
    assert.equal(third.getStatus().uncleanExit, true, '上次未 markCleanExit');
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

test('dump 清单只读文件名/大小/时间；模拟通道仅测试实例可用', () => {
  const { app, crashDumps, root } = tempApp();
  try {
    fs.writeFileSync(path.join(crashDumps, 'x.dmp'), 'abc');
    const guard = createCrashGuard({ app, crashReporter });
    guard.start();
    const status = guard.getStatus();
    assert.equal(status.dumps.length, 1);
    assert.equal(status.dumps[0].name, 'x.dmp');
    assert.equal(status.dumps[0].size, 3);

    assert.equal(guard.simulateForTest({ uncleanExit: true }).ok, false);
    const testGuard = createCrashGuard({ app, crashReporter, isTestInstance: true });
    testGuard.start();
    assert.equal(testGuard.simulateForTest({ uncleanExit: true }).ok, true);
    assert.equal(testGuard.getStatus().uncleanExit, true);
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});
