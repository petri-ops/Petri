import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
const publisher = readFileSync(join(root, 'scripts/publish-macos-oss.mjs'), 'utf8');

test('macOS updater uses the BioF3 OSS generic latest feed', () => {
  assert.match(builder, /publish:\s*\n\s*provider: generic\s*\n\s*url: https:\/\/biof3-uploads\.oss-cn-hangzhou\.aliyuncs\.com\/desktop\/updates\/macos\s*\n\s*channel: latest/);
});

test('macOS build emits DMG installers and ZIP updater payloads for both architectures', () => {
  assert.match(builder, /target: dmg[\s\S]*?- arm64[\s\S]*?- x64/);
  assert.match(builder, /target: zip[\s\S]*?- arm64[\s\S]*?- x64/);
});

test('OSS publisher uploads immutable artifacts before the no-cache manifest', () => {
  const immutableIndex = publisher.indexOf("'public,max-age=31536000,immutable'");
  const manifestIndex = publisher.indexOf("'no-cache,no-store,must-revalidate'");
  assert.ok(immutableIndex > 0);
  assert.ok(manifestIndex > immutableIndex);
  assert.match(publisher, /--acl', 'public-read'/);
  assert.match(publisher, /expectedTag = `v\$\{version\}`/);
  assert.match(publisher, /working tree is not clean/);
  assert.match(publisher, /metadata SHA-512 mismatch/);
});
