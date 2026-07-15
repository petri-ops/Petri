#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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
  .filter((name) => /\.(dmg|zip|blockmap)$/.test(name))
  .sort();

const dmgNames = artifactNames.filter((name) => name.endsWith('.dmg'));
const zipNames = artifactNames.filter((name) => name.endsWith('.zip'));
if (dmgNames.length !== 2) fail(`expected 2 DMGs for ${version}, found ${dmgNames.length}`);
if (zipNames.length !== 2) fail(`expected 2 ZIPs for ${version}, found ${zipNames.length}`);

for (const name of zipNames) {
  if (!metadata.includes(`url: ${name}`)) {
    fail(`latest-mac.yml does not reference ${name}`);
  }
}

const metadataFiles = [...metadata.matchAll(/^\s*- url: (.+)\n\s+sha512: (.+)\n\s+size: (\d+)$/gm)]
  .map((match) => ({ name: match[1], sha512: match[2], size: Number(match[3]) }));
if (metadataFiles.length !== 4) {
  fail(`expected 4 files in latest-mac.yml, found ${metadataFiles.length}`);
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
const checksumLines = [...dmgNames, ...zipNames]
  .sort()
  .map((name) => {
    const digest = createHash('sha256').update(readFileSync(join(DIST, name))).digest('hex');
    return `${digest}  ${name}`;
  });
writeFileSync(checksumPath, `${checksumLines.join('\n')}\n`);

const immutableFiles = [...artifactNames.map((name) => join(DIST, name)), checksumPath];

function contentType(file) {
  if (file.endsWith('.yml')) return 'text/yaml; charset=utf-8';
  if (file.endsWith('.zip')) return 'application/zip';
  if (file.endsWith('.dmg')) return 'application/x-apple-diskimage';
  return 'application/octet-stream';
}

function findOssutil() {
  for (const command of ['ossutil', 'ossutil64']) {
    const result = spawnSync('command', ['-v', command], { shell: true, encoding: 'utf8' });
    if (result.status === 0) return command;
  }
  return null;
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

const ossEnv = {
  ...process.env,
  OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID || process.env.OSS_AK,
  OSS_ACCESS_KEY_SECRET: process.env.OSS_ACCESS_KEY_SECRET || process.env.OSS_SK,
  OSS_REGION: region,
  OSS_ENDPOINT: endpoint,
};

function upload(command, file, cacheControl) {
  const name = basename(file);
  const destination = `oss://${bucket}/${prefix}/${name}`;
  const args = [
    'cp', file, destination,
    '--region', region,
    '--endpoint', endpoint,
    '--acl', 'public-read',
    '--content-type', contentType(file),
    '--cache-control', cacheControl,
    '--force',
  ];
  console.log(`[oss-update] ${dryRun ? 'would upload' : 'uploading'} ${name}`);
  console.log(`[oss-update] public URL: ${publicBaseUrl}/${encodeURIComponent(name)}`);
  if (dryRun) return;
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: ossEnv });
  if (result.status !== 0) fail(`ossutil failed while uploading ${name}`);
}

console.log(`[oss-update] version=${version}`);
console.log(`[oss-update] artifacts=${immutableFiles.length + 1}`);
console.log(`[oss-update] checksum=${checksumPath}`);

if (prepareOnly) {
  console.log('[oss-update] preparation complete; no files uploaded');
  process.exit(0);
}

const ossutil = findOssutil();
if (!dryRun && !ossutil) {
  fail('ossutil is not installed; install it and configure a least-privilege RAM credential first');
}
if (!dryRun) verifyReleaseSource();

// Immutable versioned objects are uploaded first. The channel manifest is the
// atomic switch and must always be uploaded last with caching disabled.
for (const file of immutableFiles) {
  upload(ossutil, file, 'public,max-age=31536000,immutable');
}
upload(ossutil, metadataPath, 'no-cache,no-store,must-revalidate');

console.log(`[oss-update] complete: ${publicBaseUrl}/latest-mac.yml`);
