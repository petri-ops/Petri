import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  UI_SOURCE_FILES,
  sanitizeUiEvidence,
} from '../scripts/g0-rs-p4r-ui-observation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('P4R-6 UI evidence binds only existing repository-relative sources', () => {
  for (const file of Object.values(UI_SOURCE_FILES)) {
    assert.equal(path.isAbsolute(file), false);
    assert.equal(file.includes('..'), false);
    assert.equal(existsSync(path.join(root, file)), true, `${file} is missing`);
  }
});

test('P4R-6 UI sanitizer accepts bounded renderer facts', () => {
  assert.doesNotThrow(() => sanitizeUiEvidence({
    workPackage: 'G0-RS-P4R-6',
    renderer: 'Electron 30 / Chromium 124',
    screenshot: 'light-1440.png',
    screenshotSha256: 'a'.repeat(64),
    viewport: { innerWidth: 1440, clientWidth: 1440, scrollWidth: 1440 },
    activeElement: { tag: 'button', textDigest: 'b'.repeat(64) },
    qualificationEligible: false,
  }));
});

test('P4R-6 UI sanitizer rejects URLs, absolute paths, internal ids and credentials', () => {
  for (const unsafe of [
    { endpoint: 'http://127.0.0.1:3000/project/private' },
    { file: '/Users/example/result.png' },
    { revision: 'rev_private123' },
    { value: 'sk-thislookslikeasecret' },
  ]) {
    assert.throws(() => sanitizeUiEvidence(unsafe), /privacy violation/);
  }
});

test('P4R-6 Electron driver performs real layout, capture and keyboard operations', () => {
  const source = readFileSync(path.join(root, 'scripts/g0-rs-p4r-ui-driver.cjs'), 'utf8');
  assert.match(source, /new BrowserWindow/);
  assert.match(source, /capturePage\(\)/);
  assert.match(source, /getBoundingClientRect\(\)/);
  assert.match(source, /sendInputEvent/);
  assert.match(source, /Input\.dispatchKeyEvent/);
  assert.match(source, /candidateLifecycleTrace/);
  assert.match(source, /serviceRestartTrace/);
  assert.match(source, /backendWasUnreachable/);
  assert.match(source, /draftPreserved/);
  assert.doesNotMatch(
    source.match(/const bodyCandidates[\s\S]*?: \[\];/)?.[0] || '',
    /\[role="alert"\]/,
    'an actionable error must not be counted as preserved Artifact body',
  );
  assert.match(source, /pageHorizontalOverflow/);
  assert.match(source, /allScreenshotsDistinct/);
});

test('P4R-6 UI parent owns and cleans backend, Vite and Electron children', () => {
  const source = readFileSync(path.join(root, 'scripts/g0-rs-p4r-ui-observation.mjs'), 'utf8');
  assert.match(source, /await stopChild\(electron\)/);
  assert.match(source, /await stopChild\(vite\)/);
  assert.match(source, /await stopServer\(backend\?\.child\)/);
  assert.match(source, /runAgentChild/);
  assert.match(source, /__P4R6_BACKEND_RESTART_REQUEST__/);
  assert.match(source, /__P4R6_BACKEND_RESTARTED__/);
  assert.match(source, /process\.once\('SIGINT'/);
  assert.match(source, /process\.once\('SIGTERM'/);
  assert.match(source, /refusing to write stale evidence/);
});
