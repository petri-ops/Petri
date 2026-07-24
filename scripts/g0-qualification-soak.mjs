#!/usr/bin/env node

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  evaluatePackagedReport,
  runPackagedQualification,
} from './g0-qualification-packaged.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-qualification/soak-endurance.json');
const require = createRequire(import.meta.url);
const qualification = require('../core/shared-backend/g0-baseline-qualification');
const MINIMUM_SOAK_MS = 5 * 60 * 1000;
const MINIMUM_TASK_CYCLES = 2;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const runnerSha256 = () => sha256(readFileSync(fileURLToPath(import.meta.url)));

function isAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function verifyStored() {
  if (!existsSync(evidencePath)) throw new Error('soak_evidence_missing');
  const report = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const subject = qualification.buildQualificationManifest();
  const verdict = evaluatePackagedReport(report, {
    minimumTaskCycles: MINIMUM_TASK_CYCLES,
    minimumObservationMs: MINIMUM_SOAK_MS,
    minimumHealthSamples: 60,
  });
  if (!report.passed || !verdict.passed) throw new Error('soak_qualification_failed');
  if (!isAncestor(report.sourceCommit)) throw new Error('soak_source_not_ancestor');
  if (report.baseline?.bundleDigest !== subject.bundleDigest) throw new Error('soak_baseline_stale');
  if (report.runnerHashes?.soakQualificationSha256 !== runnerSha256()) throw new Error('soak_runner_stale');
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes('--write-evidence')) {
      const baseReport = await runPackagedQualification({
        taskCycles: MINIMUM_TASK_CYCLES,
        minimumObservationMs: MINIMUM_SOAK_MS,
        appMode: 'packaged-macos-arm64-soak',
      });
      const report = {
        ...baseReport,
        runnerHashes: {
          ...baseReport.runnerHashes,
          soakQualificationSha256: runnerSha256(),
        },
      };
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
      if (!report.passed) throw new Error('soak_qualification_failed');
      console.log('[G0-LF12 soak] PASS — 5 minute packaged endurance, real tasks and restart');
    } else {
      verifyStored();
      console.log('[G0-LF12 soak] PASS — stored evidence valid');
    }
  } catch (error) {
    console.error(`[G0-LF12 soak] FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
