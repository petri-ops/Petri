import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  compareVersions,
  createMacOssUpdater,
  parseLatestMacYaml,
  resolveArtifactUrl,
  selectDmg,
} = require('../src/macos-oss-updater');

const payload = Buffer.from('petri-dmg-fixture');
const sha512 = createHash('sha512').update(payload).digest('base64');
const manifest = `version: 0.0.1-rc.3
files:
  - url: Petri-0.0.1-rc.3-arm64.dmg
    sha512: ${sha512}
    size: ${payload.length}
  - url: Petri-0.0.1-rc.3.dmg
    sha512: ${sha512}
    size: ${payload.length}
releaseDate: '2026-07-15T12:00:00.000Z'
`;

test('parses latest-mac.yml and selects the matching architecture DMG', () => {
  const parsed = parseLatestMacYaml(manifest);
  assert.equal(parsed.version, '0.0.1-rc.3');
  assert.match(selectDmg(parsed.files, 'arm64').url, /-arm64\.dmg$/);
  assert.doesNotMatch(selectDmg(parsed.files, 'x64').url, /-arm64\.dmg$/);
});

test('compares release-candidate versions correctly', () => {
  assert.equal(compareVersions('0.0.1-rc.3', '0.0.1-rc.2'), 1);
  assert.equal(compareVersions('0.0.1', '0.0.1-rc.9'), 1);
  assert.equal(compareVersions('0.0.1-rc.2', '0.0.1-rc.2'), 0);
});

test('rejects update artifacts outside the configured HTTPS feed', () => {
  const feed = 'https://example.com/updates/macos/';
  assert.throws(() => resolveArtifactUrl(feed, 'https://evil.example/Petri.dmg'));
  assert.throws(() => resolveArtifactUrl(feed, '../../../Petri.dmg'));
});

test('downloads, verifies and opens a DMG without electron-updater', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'petri-updater-'));
  const opened = [];
  const progress = [];
  const fetchImpl = async (url) => {
    if (String(url).endsWith('latest-mac.yml')) return new Response(manifest);
    return new Response(payload);
  };
  const updater = createMacOssUpdater({
    currentVersion: '0.0.1-rc.2',
    arch: 'arm64',
    downloadsDir: dir,
    fetchImpl,
    openPath: async (file) => { opened.push(file); return ''; },
    onProgress: (value) => progress.push(value),
  });
  try {
    const check = await updater.check();
    assert.equal(check.hasUpdate, true);
    const downloaded = await updater.download();
    assert.deepEqual(readFileSync(downloaded.path), payload);
    assert.equal(progress.at(-1).ratio, 1);
    await updater.install();
    assert.deepEqual(opened, [downloaded.path]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a DMG whose SHA-512 does not match the manifest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'petri-updater-corrupt-'));
  const fetchImpl = async (url) => {
    if (String(url).endsWith('latest-mac.yml')) return new Response(manifest);
    return new Response(Buffer.alloc(payload.length, 0));
  };
  const updater = createMacOssUpdater({
    currentVersion: '0.0.1-rc.2',
    arch: 'arm64',
    downloadsDir: dir,
    fetchImpl,
    openPath: async () => '',
  });
  try {
    await updater.check();
    await assert.rejects(updater.download(), /校验失败/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
