#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = join(root, 'acceptance/g0-qualification/packaged-ui');
const evidencePath = join(root, 'acceptance/g0-qualification/visual-state-convergence.json');
const inspectionPath = join(evidenceDir, 'inspection.json');
const appPath = resolve(
  process.env.G0_QUALIFICATION_APP_PATH
    || join(root, 'dist/mac-arm64/BioF3.app'),
);
const appBuildSubjectPath = join(appPath, 'Contents/Resources/g0-build-subject.json');
const require = createRequire(import.meta.url);
const qualification = require('../core/shared-backend/g0-baseline-qualification');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const REQUIRED_STATES = Object.freeze([
  { id: 'chat-summary-light-wide', file: 'chat-summary-light-wide.png', theme: 'light', viewport: 'wide' },
  { id: 'chat-summary-dark-wide', file: 'chat-summary-dark-wide.png', theme: 'dark', viewport: 'wide' },
  { id: 'result-light-wide', file: 'result-light-wide.png', theme: 'light', viewport: 'wide' },
  { id: 'chat-summary-dark-narrow', file: 'chat-summary-dark-narrow.png', theme: 'dark', viewport: 'narrow' },
  { id: 'restart-restored-light-wide', file: 'restart-restored-light-wide.png', theme: 'light', viewport: 'wide' },
]);

function isAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('visual_screenshot_not_png');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function privacyClean(value) {
  const serialized = JSON.stringify(value);
  return !/https?:\/\//i.test(serialized)
    && !/Bearer\s+/i.test(serialized)
    && !/sk-[A-Za-z0-9]{12,}/.test(serialized)
    && !/\/Users\/[^/]+\//.test(serialized)
    && !/\/home\/[^/]+\//.test(serialized);
}

export function evaluateVisualEvidence(report) {
  const ids = new Set((report.states || []).map((item) => item.id));
  const checks = {
    allStatesPresent: REQUIRED_STATES.every((state) => ids.has(state.id)),
    screenshotsValid: (report.states || []).length === REQUIRED_STATES.length
      && report.states.every((state) => /^[a-f0-9]{64}$/.test(state.imageSha256)
        && state.width >= 720 && state.height >= 520 && state.bytes > 10000),
    themeMatrix: new Set((report.states || []).map((state) => state.theme)).size >= 2,
    viewportMatrix: new Set((report.states || []).map((state) => state.viewport)).size >= 2,
    productionSurfaces: ['chat', 'summary', 'task', 'files', 'result'].every((surface) =>
      (report.inspection?.visibleSurfaces || []).includes(surface)),
    truthfulStates: report.inspection?.terminalStateTruthful === true
      && report.inspection?.stageConclusionsOnly === true
      && report.inspection?.hiddenReasoningAbsent === true,
    responsive: report.inspection?.narrowLayoutUsable === true
      && report.inspection?.pageHorizontalOverflow === false,
    restartConvergence: report.inspection?.restartRestoredConversation === true
      && report.inspection?.restartRestoredTask === true
      && report.inspection?.restartRestoredFiles === true
      && report.inspection?.restartRestoredResult === true,
    accessibilityInspection: report.inspection?.method === 'computer-use-accessibility-and-screenshot-review',
    privacy: privacyClean(report),
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

function buildReport() {
  if (!existsSync(inspectionPath)) throw new Error('visual_inspection_missing');
  if (!existsSync(appBuildSubjectPath)) throw new Error('visual_build_subject_missing');
  const inspection = JSON.parse(readFileSync(inspectionPath, 'utf8'));
  const buildSubject = JSON.parse(readFileSync(appBuildSubjectPath, 'utf8'));
  const subject = qualification.buildQualificationManifest();
  if (buildSubject.sourceCommit !== execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()) {
    throw new Error('visual_source_commit_mismatch');
  }
  if (buildSubject.baseline?.bundleDigest !== subject.bundleDigest) throw new Error('visual_baseline_mismatch');
  const states = REQUIRED_STATES.map((state) => {
    const target = join(evidenceDir, state.file);
    if (!existsSync(target)) throw new Error(`visual_screenshot_missing:${state.id}`);
    const image = readFileSync(target);
    return {
      ...state,
      ...pngDimensions(image),
      bytes: image.length,
      imageSha256: sha256(image),
    };
  });
  const report = {
    schemaVersion: 1,
    qualificationId: qualification.contract.qualificationId,
    sourceCommit: buildSubject.sourceCommit,
    baseline: buildSubject.baseline,
    platform: 'macos-arm64',
    architecture: 'arm64',
    appMode: 'packaged-visual-state-convergence',
    privacy: 'sanitized_fixture_screenshot_hashes_dimensions_and_bounded_manual_observations_only',
    states,
    inspection,
    runnerHashes: {
      visualQualificationSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
      visualSeedSha256: sha256(readFileSync(join(root, 'scripts/g0-qualification-visual-seed.cjs'))),
    },
    generatedAt: new Date().toISOString(),
  };
  const verdict = evaluateVisualEvidence(report);
  return { ...report, checks: verdict.checks, passed: verdict.passed };
}

function verifyStored() {
  if (!existsSync(evidencePath)) throw new Error('visual_evidence_missing');
  const report = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const subject = qualification.buildQualificationManifest();
  const verdict = evaluateVisualEvidence(report);
  if (!report.passed || !verdict.passed) throw new Error('visual_qualification_failed');
  if (!isAncestor(report.sourceCommit)) throw new Error('visual_source_not_ancestor');
  if (report.baseline?.bundleDigest !== subject.bundleDigest) throw new Error('visual_baseline_stale');
  if (
    report.runnerHashes?.visualQualificationSha256 !== sha256(readFileSync(fileURLToPath(import.meta.url)))
    || report.runnerHashes?.visualSeedSha256 !== sha256(readFileSync(join(root, 'scripts/g0-qualification-visual-seed.cjs')))
  ) throw new Error('visual_runner_stale');
  for (const state of report.states) {
    const file = join(evidenceDir, basename(state.file));
    if (!existsSync(file) || sha256(readFileSync(file)) !== state.imageSha256) {
      throw new Error(`visual_screenshot_hash_mismatch:${state.id}`);
    }
  }
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes('--write-evidence')) {
      const report = buildReport();
      if (!report.passed) throw new Error(`visual_qualification_failed:${Object.entries(report.checks).filter(([, ok]) => !ok).map(([id]) => id).join(',')}`);
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
      console.log('[G0-LF12 visual] PASS — packaged UI state convergence matrix');
    } else {
      verifyStored();
      console.log('[G0-LF12 visual] PASS — stored evidence and screenshot hashes valid');
    }
  } catch (error) {
    console.error(`[G0-LF12 visual] FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
