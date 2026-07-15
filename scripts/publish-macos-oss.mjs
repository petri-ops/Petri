#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import OSS from 'ali-oss';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const bucket = process.env.BIOF3_OSS_BUCKET || 'biof3-uploads';
const region = process.env.OSS_REGION || 'cn-hangzhou';
const endpoint = process.env.OSS_ENDPOINT || 'oss-cn-hangzhou.aliyuncs.com';
const prefix = (process.env.BIOF3_OSS_UPDATE_PREFIX || 'desktop/updates/macos').replace(/^\/+|\/+$/g, '');
const publicBaseUrl = process.env.BIOF3_OSS_UPDATE_URL ||
  `https://${bucket}.${endpoint}/${prefix}`;
const dryRun = process.argv.includes('--dry-run');
const prepareOnly = process.argv.includes('--prepare-only');

function fail(message) {
  console.error(`[oss-update] ERROR: ${message}`);
  process.exit(1);
}

if (!existsSync(DIST)) fail('dist/ does not exist; run npm run build:mac first');

const metadataPath = join(DIST, 'latest-mac.yml');
if (!existsSync(metadataPath)) fail('dist/latest-mac.yml is missing');

const metadata = readFileSync(metadataPath, 'utf8');
if (!metadata.includes(`version: ${version}`)) {
  fail(`latest-mac.yml does not describe package version ${version}`);
}

const artifactNames = readdirSync(DIST)
  .filter((name) => name.includes(version))
  .filter((name) => name.endsWith('.dmg'))
  .sort();

const dmgNames = artifactNames.filter((name) => name.endsWith('.dmg'));
if (dmgNames.length !== 2) fail(`expected 2 DMGs for ${version}, found ${dmgNames.length}`);

const metadataFiles = [...metadata.matchAll(/^\s*- url: (.+)\n\s+sha512: (.+)\n\s+size: (\d+)$/gm)]
  .map((match) => ({ name: match[1], sha512: match[2], size: Number(match[3]) }));
if (metadataFiles.length !== 2) {
  fail(`expected 2 DMG files in latest-mac.yml, found ${metadataFiles.length}`);
}
for (const entry of metadataFiles) {
  const file = join(DIST, entry.name);
  if (!existsSync(file)) fail(`metadata references missing file ${entry.name}`);
  if (statSync(file).size !== entry.size) fail(`metadata size mismatch for ${entry.name}`);
  const sha512 = createHash('sha512').update(readFileSync(file)).digest('base64');
  if (sha512 !== entry.sha512) fail(`metadata SHA-512 mismatch for ${entry.name}`);
}

const checksumName = `SHA256SUMS-mac-${version}.txt`;
const checksumPath = join(DIST, checksumName);
const checksumLines = dmgNames
  .sort()
  .map((name) => {
    const digest = createHash('sha256').update(readFileSync(join(DIST, name))).digest('hex');
    return `${digest}  ${name}`;
  });
writeFileSync(checksumPath, `${checksumLines.join('\n')}\n`);

const immutableFiles = [...dmgNames.map((name) => join(DIST, name)), checksumPath];

function contentType(file) {
  if (file.endsWith('.yml')) return 'text/yaml; charset=utf-8';
  if (file.endsWith('.dmg')) return 'application/x-apple-diskimage';
  return 'application/octet-stream';
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function verifyReleaseSource() {
  const expectedTag = `v${version}`;
  const head = git('rev-parse', 'HEAD');
  const taggedCommit = git('rev-list', '-n', '1', expectedTag);
  const dirty = git('status', '--porcelain');
  if (!head || !taggedCommit) fail(`release tag ${expectedTag} does not exist`);
  if (head !== taggedCommit) fail(`${expectedTag} does not point to the current commit`);
  if (dirty) fail('working tree is not clean; commit release source before uploading');
}

let client = null;

async function upload(file, cacheControl) {
  const name = basename(file);
  const objectName = `${prefix}/${name}`;
  const destination = `oss://${bucket}/${prefix}/${name}`;
  console.log(`[oss-update] ${dryRun ? 'would upload' : 'uploading'} ${name}`);
  console.log(`[oss-update] public URL: ${publicBaseUrl}/${encodeURIComponent(name)}`);
  if (dryRun) return;
  try {
    await client.put(objectName, file, {
      headers: {
        'Content-Type': contentType(file),
        'Cache-Control': cacheControl,
      },
    });
    await client.putACL(objectName, 'public-read');
  } catch (error) {
    fail(`OSS upload failed for ${name}: ${error.message}`);
  }
}

console.log(`[oss-update] version=${version}`);
console.log(`[oss-update] artifacts=${immutableFiles.length + 1}`);
console.log(`[oss-update] checksum=${checksumPath}`);

if (prepareOnly) {
  console.log('[oss-update] preparation complete; no files uploaded');
  process.exit(0);
}

if (!dryRun) {
  verifyReleaseSource();
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID || process.env.OSS_AK;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || process.env.OSS_SK;
  if (!accessKeyId || !accessKeySecret) {
    fail('missing OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET release credentials');
  }
  client = new OSS({
    region: region.startsWith('oss-') ? region : `oss-${region}`,
    endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
    accessKeyId,
    accessKeySecret,
    bucket,
    secure: true,
  });
}

// Immutable versioned objects are uploaded first. The channel manifest is the
// atomic switch and must always be uploaded last with caching disabled.
for (const file of immutableFiles) {
  await upload(file, 'public,max-age=31536000,immutable');
}
await upload(metadataPath, 'no-cache,no-store,must-revalidate');

console.log(`[oss-update] complete: ${publicBaseUrl}/latest-mac.yml`);
