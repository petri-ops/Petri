#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import OSS from 'ali-oss';

const ROOT = resolve(import.meta.dirname, '..');
const BUNDLE_DIR = join(ROOT, 'release', 'bundles');
const FILES = [
  join(BUNDLE_DIR, 'r-enrichment-1.0.0-macos-arm64.tar.gz'),
  join(BUNDLE_DIR, 'r-wgcna-1.0.0-macos-arm64.tar.gz'),
];
const bucket = process.env.PETRI_OSS_BUCKET || 'petri-uploads';
const region = process.env.OSS_REGION || 'cn-hangzhou';
const endpoint = process.env.OSS_ENDPOINT || 'oss-cn-hangzhou.aliyuncs.com';
const prefix = (process.env.PETRI_OSS_BUNDLE_PREFIX || 'bundles').replace(/^\/+|\/+$/g, '');
const uploadEnabled = process.argv.includes('--upload');

function fail(message) {
  console.error(`[bundle-upload] ERROR: ${message}`);
  process.exit(1);
}

function sha256(file) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
    stream.on('error', reject);
  });
}

for (const file of FILES) {
  if (!existsSync(file)) fail(`missing bundle: ${file}`);
}

const descriptors = [];
for (const file of FILES) {
  const name = basename(file);
  const match = name.match(/^(r-[a-z0-9-]+)-([0-9.]+)-(macos-(?:arm64|x64))\.tar\.gz$/);
  if (!match) fail(`unexpected bundle filename: ${name}`);
  descriptors.push({
    bundleId: match[1],
    version: match[2],
    platform: match[3],
    sha256: await sha256(file),
    sizeBytes: statSync(file).size,
    fileName: name,
    objectName: `${prefix}/${name}`,
    url: `https://${bucket}.${endpoint}/${prefix}/${encodeURIComponent(name)}`,
    file,
  });
}

console.log('[bundle-upload] verified local descriptor(s):');
console.log(
  JSON.stringify(
    descriptors.map(({ file: _file, objectName: _objectName, ...descriptor }) => descriptor),
    null,
    2
  )
);

if (!uploadEnabled) {
  console.log('[bundle-upload] inspection only; pass --upload for the human-authorized OSS write.');
  process.exit(0);
}

const accessKeyId = process.env.OSS_ACCESS_KEY_ID || process.env.OSS_AK;
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || process.env.OSS_SK;
if (!accessKeyId || !accessKeySecret) {
  fail('missing OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET credentials');
}

const client = new OSS({
  region: region.startsWith('oss-') ? region : `oss-${region}`,
  endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
  accessKeyId,
  accessKeySecret,
  bucket,
  secure: true,
});

for (const descriptor of descriptors) {
  let lastPercent = -1;
  console.log(`[bundle-upload] uploading ${descriptor.fileName} -> oss://${bucket}/${descriptor.objectName}`);
  await client.multipartUpload(descriptor.objectName, descriptor.file, {
    parallel: 4,
    partSize: 10 * 1024 * 1024,
    headers: {
      'Content-Type': 'application/gzip',
      'Cache-Control': 'public,max-age=31536000,immutable',
    },
    progress: async (ratio) => {
      const percent = Math.floor(ratio * 100);
      if (percent >= lastPercent + 10 || percent === 100) {
        lastPercent = percent;
        console.log(`[bundle-upload] ${descriptor.bundleId}: ${percent}%`);
      }
    },
  });
  await client.putACL(descriptor.objectName, 'public-read');
  const head = await client.head(descriptor.objectName);
  if (!head || Number(head.status) !== 200) {
    fail(`uploaded object HEAD verification failed: ${descriptor.objectName}`);
  }
  console.log(`[bundle-upload] verified ${descriptor.url}`);
}

console.log('[bundle-upload] upload complete; backfill descriptor hashes only after URL checks pass.');
