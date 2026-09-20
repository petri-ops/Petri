#!/usr/bin/env node
// release-checksums.mjs — 一键计算 dist/ 全部发布产物的 SHA-256 并合并到 SHA256SUMS.txt。
//
// 用法：
//   node scripts/release-checksums.mjs            # 扫描 dist/，写出 dist/SHA256SUMS.txt
//   node scripts/release-checksums.mjs --verify   # 对照 dist/SHA256SUMS.txt 重新校验
//   node scripts/release-checksums.mjs --quiet    # 静默模式，只在出错时输出
//
// 退出码：
//   0 = 成功（或 --verify 全过）
//   1 = --verify 失败（任一文件哈希不匹配）
//   2 = dist/ 目录不存在
//
// 与 .github/workflows/release.yml 的 release job 行为一致：按文件名字典序合并。
// macOS / Windows / Linux 三类产物的 SHA256SUMS-*.txt 在 CI 中分别产生后由 release
// job `sort -k 2` 合并。本脚本作为本地等价物——单一机器构建时直接覆盖三段文件。

import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const DIST_DIR = resolve(process.cwd(), 'dist');
const SUMS_FILE = join(DIST_DIR, 'SHA256SUMS.txt');
const VERIFY = process.argv.includes('--verify');
const QUIET = process.argv.includes('--quiet');

const log = QUIET ? () => {} : (...a) => console.log(...a);

async function hashFile(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

function classify(filename) {
  if (/\.dmg$/i.test(filename)) return 'mac';
  if (/\.zip$/i.test(filename)) return 'mac';
  if (/\.exe$/i.test(filename)) return 'win';
  if (/\.AppImage$|\.deb$|\.snap$|\.tar\.gz$|\.pacman$/i.test(filename)) return 'linux';
  if (/\.blockmap$/i.test(filename)) return 'mac'; // mac blockmap 自带在 mac 分组
  return null;
}

function parseSumLine(line) {
  // 形如：  abc123...  filename
  const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
  return m ? { hash: m[1].toLowerCase(), file: m[2].trim() } : null;
}

async function listReleaseArtifacts() {
  try {
    const entries = await import('node:fs/promises').then((m) => m.readdir(DIST_DIR, { withFileTypes: true }));
    return entries
      .filter((e) => e.isFile())
      .filter((e) => classify(e.name))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if (err.code === 'ENOENT') {
      log(`[release-checksums] dist/ does not exist. Run \`npm run build:*\` first.`);
      process.exit(2);
    }
    throw err;
  }
}

async function compute() {
  const names = await listReleaseArtifacts();
  if (names.length === 0) {
    log('[release-checksums] no release artifacts found in dist/.');
    process.exit(2);
  }
  log(`[release-checksums] hashing ${names.length} artifact(s)...`);
  const lines = [];
  for (const name of names) {
    const path = join(DIST_DIR, name);
    const h = await hashFile(path);
    lines.push(`${h}  ${name}`);
    log(`  ${h}  ${name}`);
  }
  lines.sort((a, b) => a.split(/\s+/)[1].localeCompare(b.split(/\s+/)[1]));
  await writeFile(SUMS_FILE, lines.join('\n') + '\n');
  log(`[release-checksums] wrote ${SUMS_FILE}`);
}

async function verify() {
  let raw;
  try {
    raw = await readFile(SUMS_FILE, 'utf8');
  } catch {
    log(`[release-checksums] ${SUMS_FILE} not found. Run without --verify to generate it.`);
    process.exit(2);
  }
  const entries = raw
    .split('\n')
    .map(parseSumLine)
    .filter(Boolean);
  log(`[release-checksums] verifying ${entries.length} entry/entries...`);
  let failed = 0;
  for (const { hash, file } of entries) {
    const path = join(DIST_DIR, file);
    try {
      await stat(path);
    } catch {
      log(`  MISSING  ${file}`);
      failed += 1;
      continue;
    }
    const actual = await hashFile(path);
    if (actual !== hash) {
      log(`  MISMATCH ${file}\n    expected ${hash}\n    actual   ${actual}`);
      failed += 1;
    } else {
      log(`  OK       ${file}`);
    }
  }
  if (failed > 0) {
    log(`[release-checksums] ${failed} verification failure(s).`);
    process.exit(1);
  }
  log(`[release-checksums] all entries match.`);
}

if (VERIFY) {
  await verify();
} else {
  await compute();
}