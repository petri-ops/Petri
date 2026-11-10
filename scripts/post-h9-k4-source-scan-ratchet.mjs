#!/usr/bin/env node
/** K4 / K-20 源码扫描契约只减不增棘轮门（--freeze 只用于首次冻结当前读数）。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCAN_CONTRACT_FILES, countSourceScanAsserts, adjudicateSourceScan } from './lib/post-h9-k4-architecture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'acceptance/post-h9-2026-11-10/k4/k4-source-scan-baseline.json';

function current() {
  const perFile = {};
  for (const rel of SCAN_CONTRACT_FILES) perFile[rel] = countSourceScanAsserts(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  return perFile;
}

function main(argv) {
  const abs = path.join(ROOT, OUT);
  const now = current();
  if (argv.includes('--freeze')) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify({
      schemaVersion: 1, kind: 'post-h9-k4-source-scan-baseline', generatedAt: new Date().toISOString(),
      policy: '只减不增：新增源码扫描式断言（includes/源码正则/行数锚）即红；换成行为断言后重打下调。',
      perFile: now,
    }, null, 2)}\n`);
    console.log(JSON.stringify({ frozen: OUT, perFile: now }, null, 2));
    return;
  }
  const stored = JSON.parse(fs.readFileSync(abs, 'utf8')).perFile;
  const verdict = adjudicateSourceScan(now, stored);
  console.log(JSON.stringify({ ...verdict, current: now, frozen: stored }, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

try { main(process.argv.slice(2)); } catch (e) { console.error(`[post-h9:k4-ratchet] fail-closed: ${e.message}`); process.exitCode = 1; }
