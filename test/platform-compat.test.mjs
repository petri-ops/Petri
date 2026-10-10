import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const req = createRequire(import.meta.url);
const compat = req(resolve(process.cwd(), 'src/platform-compat.js'));
const runtimePaths = req(resolve(process.cwd(), 'core/shared-backend/runtime-paths.js'));

test('platform compat chooses runtime binary names per OS', () => {
  assert.deepEqual(compat.getRuntimeBinCandidates('r', 'win32'), ['Rscript.exe', 'R.exe']);
  assert.deepEqual(compat.getRuntimeBinCandidates('python', 'win32'), [
    'python.exe',
    'python3.exe',
    'python3.11.exe',
    'python3.12.exe',
    'python3.13.exe',
    'py.exe',
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
    'python3.12.exe',
    'python3.13.exe',
    'py.exe',
  ]);
  assert.deepEqual(runtimePaths.getPythonExecutableCandidates('linux'), ['python3', 'python']);
});

test('python runtime lookup prefers bin launcher over framework root dylib', () => {
  const fs = req('node:fs');
  const os = req('node:os');
  const path = req('node:path');
  const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-python-home-'));
  try {
    fs.mkdirSync(path.join(runtimeHome, 'bin'));
    fs.writeFileSync(path.join(runtimeHome, 'python'), 'framework dylib placeholder');
    fs.writeFileSync(path.join(runtimeHome, 'bin', 'python3'), '#!/bin/sh\n');
    assert.equal(
      runtimePaths.getPythonRuntimeExecutable(runtimeHome, 'darwin'),
      path.join(runtimeHome, 'bin', 'python3'),
    );
  } finally {
    fs.rmSync(runtimeHome, { recursive: true, force: true });
  }
});

test('built-in plugin root matches electron-builder extraResources layout', () => {
  assert.equal(
    compat.getBuiltInPluginsDir({
      isPackaged: false,
      projectRoot: '/repo/desktop',
      resourcesPath: '/app/Contents/Resources',
    }),
    '/repo/desktop/resources/built-in-plugins',
  );
  assert.equal(
    compat.getBuiltInPluginsDir({
      isPackaged: true,
      projectRoot: '/app/Contents/Resources',
      resourcesPath: '/app/Contents/Resources',
    }),
    '/app/Contents/Resources/built-in-plugins',
  );
});

// Regression guard — this bug class has now shipped three times:
//   1. r-executor `binPath` getter        (fixed 2026-08-08 早, Task #44)
//   2. r-executor `buildPoolWorker`       (same commit)
//   3. plugin-manager `getRuntimeStatus`  (fixed 2026-08-08 晚, UI-108)
// Every occurrence was the same mistake: probing `path.join(rHome,'bin','Rscript')`
// with fs.existsSync(). On Windows the file is `Rscript.exe`, and existsSync()
// does NOT apply PATHEXT resolution the way a shell does — so a perfectly
// installed R tree is reported as "not installed". #3 was the nastiest: the
// store downloaded + extracted 657MB successfully, installed.json recorded it,
// yet the UI still said "R 运行时未安装" after restart.
//
// Runtime code must always derive the binary name from getRuntimeBinName().
// This guard scans the shipped runtime sources (not scripts/, which are dev and
// acceptance tooling that never enters the packaged app) for extensionless
// literals so a future edit cannot silently reintroduce it.
test('runtime sources never probe an extensionless Rscript literal', () => {
  const fs = req('node:fs');

  const stripComments = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^\S\r\n])\/\/.*$/gm, '$1');

  const guardedFiles = [
    'src/plugin-manager.js',
    'src/main.js',
    'core/shared-backend/executors/r-executor.js',
    'core/shared-backend/runtime-paths.js',
    'src/platform-compat.js',
  ];

  const offenders = [];
  for (const relativePath of guardedFiles) {
    const absolutePath = resolve(process.cwd(), relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const source = stripComments(fs.readFileSync(absolutePath, 'utf8'));
    source.split('\n').forEach((line, index) => {
      // Matches 'Rscript' / "Rscript" but not 'Rscript.exe'.
      if (/['"]Rscript['"]/.test(line) && !/Rscript\.exe/.test(line)) {
        offenders.push(`${relativePath}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    'extensionless Rscript literal found in runtime source — use getRuntimeBinName() so Windows resolves Rscript.exe:\n' +
      offenders.join('\n'),
  );
});

test('getRuntimeBinName keeps the two platform helpers in sync', () => {
  // plugin-manager/getRuntimeStatus and r-executor/binPath both rely on these
  // returning the .exe suffix on win32; platform-compat carries a parallel copy
  // that must not drift (see the sync note in runtime-paths.js).
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.equal(
      runtimePaths.getRuntimeBinName('r', platform),
      compat.getRuntimeBinName('r', platform),
      `r bin name drifted between runtime-paths and platform-compat on ${platform}`,
    );
    assert.equal(
      runtimePaths.getRuntimeBinName('python', platform),
      compat.getRuntimeBinName('python', platform),
      `python bin name drifted between runtime-paths and platform-compat on ${platform}`,
    );
  }
  assert.equal(runtimePaths.getRuntimeBinName('r', 'win32'), 'Rscript.exe');
  assert.equal(runtimePaths.getRuntimeBinName('r', 'darwin'), 'Rscript');
});
