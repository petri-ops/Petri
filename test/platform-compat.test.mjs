import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const req = createRequire(import.meta.url);
const compat = req(resolve(process.cwd(), 'src/platform-compat.js'));
const runtimePaths = req(resolve(process.cwd(), 'vendor/biof3-core/shared-backend/runtime-paths.js'));

test('platform compat chooses runtime binary names per OS', () => {
  assert.deepEqual(compat.getRuntimeBinCandidates('r', 'win32'), ['Rscript.exe']);
  assert.deepEqual(compat.getRuntimeBinCandidates('python', 'win32'), [
    'python.exe',
    'python3.exe',
    'python3.11.exe',
  ]);
  assert.equal(compat.getRuntimeBinName('r', 'darwin'), 'Rscript');
  assert.equal(compat.getRuntimeBinName('python', 'linux'), 'python3');
});

test('platform compat builds shell open plans without executing them', () => {
  assert.equal(compat.getNodeLocator('win32'), 'where');
  assert.equal(compat.getNodeLocator('darwin'), 'which');
  assert.equal(compat.getOpenShellPlan('/tmp/demo', 'darwin').type, 'osascript');
  assert.equal(compat.getOpenShellPlan('C:\\demo', 'win32').type, 'cmd');
  assert.equal(compat.getOpenShellPlan('/tmp/demo', 'linux').type, 'terminal');
  assert.deepEqual(compat.getSessionShellSpec({ COMSPEC: 'cmd.exe' }, 'win32'), {
    shellPath: 'cmd.exe',
    args: [],
  });
});

test('python runtime path helpers cover Windows and Unix layouts', () => {
  assert.deepEqual(runtimePaths.getPythonExecutableCandidates('win32'), [
    'python.exe',
    'python3.exe',
    'python3.11.exe',
  ]);
  assert.deepEqual(runtimePaths.getPythonExecutableCandidates('linux'), ['python3', 'python']);
});
