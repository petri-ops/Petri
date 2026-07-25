#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = join(root, 'acceptance/g0-result-studio/rs9-ui');
const inspectionPath = join(evidenceDir, 'inspection.json');
const evidencePath = join(root, 'acceptance/g0-result-studio/rs9-visual-acceptance.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const REQUIRED_STATES = Object.freeze([
  { id: 'result-light-wide', file: 'result-light-wide.jpg', theme: 'light', viewport: 'wide' },
  { id: 'result-dark-wide', file: 'result-dark-wide.jpg', theme: 'dark', viewport: 'wide' },
  { id: 'result-dark-820', file: 'result-dark-820.jpg', theme: 'dark', viewport: '820' },
  { id: 'large-table-light-wide', file: 'large-table-light-wide.jpg', theme: 'light', viewport: 'wide' },
  { id: 'restart-restored-light-wide', file: 'restart-restored-light-wide.jpg', theme: 'light', viewport: 'wide' },
]);

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7), format: 'jpeg' };
      }
      offset += 2 + length;
    }
  }
  throw new Error('rs9_visual_image_format_unsupported');
}

function privacyClean(value) {
  const raw = JSON.stringify(value);
  return !/https?:\/\//i.test(raw) && !/Bearer\s+/i.test(raw) && !/sk-[A-Za-z0-9]{12,}/.test(raw)
    && !/\/Users\/[^/]+\//.test(raw) && !/\/home\/[^/]+\//.test(raw);
}

export function evaluateVisualReport(report) {
  const ids = new Set((report.states || []).map((item) => item.id));
  const inspection = report.inspection || {};
  const checks = {
    stateMatrix: REQUIRED_STATES.every((state) => ids.has(state.id)) && report.states?.length === REQUIRED_STATES.length,
    imagesValid: report.states?.every((state) => /^[a-f0-9]{64}$/.test(state.imageSha256)
      && state.bytes > 10000 && state.width >= 820 && state.height >= 600) === true,
    themeMatrix: new Set((report.states || []).map((item) => item.theme)).size === 2,
    viewportMatrix: new Set((report.states || []).map((item) => item.viewport)).size >= 2,
    diffReadable: inspection.diffBeforeAfterReadable === true && inspection.gitDetailsProgressivelyDisclosed === true,
    lifecycleVisible: inspection.restartRecovered === true && inspection.interruptedProgressPreserved === true,
    largeTableProgressive: inspection.largeTablePaged === true && inspection.localScrollOnly === true,
    responsive: inspection.pageHorizontalOverflow === false && inspection.viewport820Usable === true,
    truthProjection: inspection.blockedNeverGreen === true && inspection.singleCurrentRevision === true,
    privacy: privacyClean(report),
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

function buildReport() {
  if (!existsSync(inspectionPath)) throw new Error('rs9_visual_inspection_missing');
  const inspection = JSON.parse(readFileSync(inspectionPath, 'utf8'));
  const states = REQUIRED_STATES.map((state) => {
    const file = join(evidenceDir, state.file);
    if (!existsSync(file)) throw new Error(`rs9_visual_state_missing:${state.id}`);
    const image = readFileSync(file);
    return { ...state, ...imageDimensions(image), bytes: image.length, imageSha256: sha256(image) };
  });
  const report = {
    schemaVersion: 1,
    workPackage: 'G0-RS9',
    sourceCommit: git('rev-parse', 'HEAD'),
    platform: 'macos-arm64',
    appMode: 'real-renderer-isolated-result-studio-matrix',
    privacy: 'sanitized_fixture_screenshot_hashes_dimensions_and_bounded_observations_only',
    states,
    inspection,
    runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    generatedAt: new Date().toISOString(),
  };
  const verdict = evaluateVisualReport(report);
  return { ...report, checks: verdict.checks, passed: verdict.passed };
}

function isAncestor(commit) {
  try { execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'ignore' }); return true; }
  catch { return false; }
}

function verifyStored() {
  if (!existsSync(evidencePath)) throw new Error('rs9_visual_evidence_missing');
  const report = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const verdict = evaluateVisualReport(report);
  if (!report.passed || !verdict.passed) throw new Error('rs9_visual_matrix_failed');
  if (!isAncestor(report.sourceCommit)) throw new Error('rs9_visual_source_not_ancestor');
  if (report.runnerSha256 !== sha256(readFileSync(fileURLToPath(import.meta.url)))) throw new Error('rs9_visual_runner_stale');
  for (const state of report.states) {
    const file = join(evidenceDir, basename(state.file));
    if (!existsSync(file) || sha256(readFileSync(file)) !== state.imageSha256) throw new Error(`rs9_visual_hash_mismatch:${state.id}`);
  }
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes('--write-evidence')) {
      const report = buildReport();
      if (!report.passed) throw new Error(`rs9_visual_matrix_failed:${Object.entries(report.checks).filter(([, ok]) => !ok).map(([id]) => id).join(',')}`);
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
      console.log('[G0-RS9 visual] PASS — 5/5 real renderer states');
    } else {
      verifyStored();
      console.log('[G0-RS9 visual] PASS — stored screenshot matrix valid');
    }
  } catch (error) {
    console.error(`[G0-RS9 visual] FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
