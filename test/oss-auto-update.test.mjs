import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
const publisher = readFileSync(join(root, 'scripts/publish-macos-oss.mjs'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('macOS updater uses the BioF3 OSS generic latest feed', () => {
  assert.match(builder, /publish:\s*\n\s*provider: generic\s*\n\s*url: https:\/\/biof3-uploads\.oss-cn-hangzhou\.aliyuncs\.com\/desktop\/updates\/macos\s*\n\s*channel: latest/);
});

test('macOS build scripts choose architecture without locking it in the DMG target', () => {
  const macConfig = builder.slice(builder.indexOf('mac:'), builder.indexOf('\n# Windows'));
  assert.match(macConfig, /target:\s*\n\s*- dmg/);
  assert.doesNotMatch(macConfig, /arch:/);
  assert.doesNotMatch(builder, /target: zip/);
  assert.match(packageJson.scripts['build:mac'], /electron-builder --mac --arm64 --x64/);
  assert.match(packageJson.scripts['build:mac-arm64'], /electron-builder --mac --arm64$/);
  assert.match(packageJson.scripts['build:mac-x64'], /electron-builder --mac --x64$/);
});

test('OSS publisher uses the Node SDK and uploads immutable artifacts before the no-cache manifest', () => {
  const immutableIndex = publisher.indexOf("'public,max-age=31536000,immutable'");
  const manifestIndex = publisher.indexOf("'no-cache,no-store,must-revalidate'");
  assert.ok(immutableIndex > 0);
  assert.ok(manifestIndex > immutableIndex);
  assert.match(publisher, /import OSS from 'ali-oss'/);
  assert.match(publisher, /putACL\(objectName, 'public-read'\)/);
  assert.doesNotMatch(publisher, /ossutil/);
  assert.match(publisher, /expectedTag = `v\$\{version\}`/);
  assert.match(publisher, /working tree is not clean/);
  assert.match(publisher, /metadata SHA-512 mismatch/);
});
