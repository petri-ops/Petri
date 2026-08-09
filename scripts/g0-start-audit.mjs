#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..');
export const START_EVIDENCE_PATH = join(
  REPO_ROOT,
  'acceptance/g0-living-foundation/g0-start-audit.json',
);

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(REPO_ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function isAncestor(commit, head = 'HEAD') {
  if (!commit) return false;
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    execFileSync('git', ['merge-base', '--is-ancestor', commit, head], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function makeCheck(id, passed, evidence, detail = null) {
  return {
    id,
    passed: passed === true,
    evidence,
    ...(detail ? { detail } : {}),
  };
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function validSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validGitCommit(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}

export function inspectG0Start(options = {}) {
  const hlePlan = readText('docs/harness-loop-engineering-plan.md');
  const closurePlan = readText('docs/harness-loop-production-closure-plan.md');
  const auditLog = readText('docs/AUDIT-LOG.md');
  const handoff = readText('docs/project-workspace-handoff.md');
  const agentMatrix = readJson('acceptance/harness-loop/production/agent-loop-matrix.json');
  const repairMatrix = readJson('acceptance/harness-loop/production/validator-repair-matrix.json');
  const restartMatrix = readJson('acceptance/harness-loop/production/restart-recovery-matrix.json');
  const providerMatrix = readJson('acceptance/harness-loop/production/provider-matrix.json');
  const normal = readJson('acceptance/harness-loop/production/spt1-normal/evidence.json');
  const repairable = readJson('acceptance/harness-loop/production/spt1-repairable/evidence.json');
  const blocking = readJson('acceptance/harness-loop/production/spt1-blocking/evidence.json');
  const hleGate = readJson('acceptance/harness-loop/hle-all-gate.json');
  const uiMatrix = readText('acceptance/harness-loop/production/ui-matrix.md');
  const verification = options.verification || null;
  const bootstrap = options.bootstrap === true;

  const trackByLabel = new Map(agentMatrix.tracks.map((track) => [track.label, track]));
  const normalTrack = trackByLabel.get('spt1-normal');
  const repairTrack = trackByLabel.get('spt1-repairable');
  const blockingTrack = trackByLabel.get('spt1-blocking');
  const finalRepairCheckpoint = repairable.checkpoints.at(-1);
  const deliveredTasks = normal.scientificTasks.filter((task) => {
    const job = normal.jobs.find((candidate) => candidate.jobId === task.tool_job_id);
    return job
      && job.delivery?.status === 'valid'
      && job.replay?.status === 'complete'
      && validSha(job.hashes?.scriptSha256)
      && validSha(job.hashes?.paramsSha256)
      && validSha(job.hashes?.provenanceSha256)
      && validSha(job.hashes?.deliveryManifestSha256)
      && validSha(job.hashes?.replayPackageManifestSha256);
  });
  const verificationCommands = verification?.commands || [];
  const requiredLabels = new Set([
    'root-test',
    'frontend-test',
    'frontend-build',
    'root-check',
    'hle-production',
  ]);
  const verificationPassed = verificationCommands.length > 0
    && verificationCommands.every((command) => command.passed === true)
    && [...requiredLabels].every((label) => verificationCommands.some((command) => command.label === label));

  const evidenceCommits = [
    agentMatrix.sourceCommit,
    repairMatrix.sourceCommit,
    restartMatrix.sourceCommit,
    providerMatrix.sourceCommit,
  ];
  // Production closure is asserted from the evidence that demonstrates it, not
  // from a sentence describing it.
  //
  // This previously matched /HLE-C4R\/HLE-C5 已完成生产收口/ against
  // docs/AUDIT-LOG.md. That broke in 5bb2263, where RH0 compacted the broadcast
  // board into docs/archive/checkpoints/ exactly as the governance rules require
  // — so following the rules turned a G0 gate red, and G0-START-01, G0-START-09
  // and the cascading G0-LF0-01 all failed while nothing about HLE had changed.
  //
  // AUDIT-LOG is a rolling board by design; asserting durable facts against its
  // prose couples a gate to editorial churn. The four production matrices and
  // the aggregate HLE gate are the artifacts the sentence was reporting, and
  // they are already loaded above.
  const auditRecordsProductionClosure = hleGate.passed === true
    && hleGate.totalCommands > 0
    && hleGate.totalFailed === 0
    && hleGate.totalPassed === hleGate.totalCommands
    && repairMatrix.passed === true
    && restartMatrix.passed === true
    && providerMatrix.passed === true
    && Array.isArray(agentMatrix.tracks) && agentMatrix.tracks.length === 3;
  const checks = [
    makeCheck(
      'G0-START-01',
      /状态：`completed`/.test(hlePlan)
        && /状态：`completed`/.test(closurePlan)
        && auditRecordsProductionClosure,
      [
        'docs/harness-loop-engineering-plan.md',
        'docs/harness-loop-production-closure-plan.md',
        'acceptance/harness-loop/hle-all-gate.json',
        'acceptance/harness-loop/production/validator-repair-matrix.json',
        'acceptance/harness-loop/production/restart-recovery-matrix.json',
        'acceptance/harness-loop/production/provider-matrix.json',
        'acceptance/harness-loop/production/agent-loop-matrix.json',
      ],
      'HLE status and production closure agree.',
    ),
    makeCheck(
      'G0-START-02',
      agentMatrix.tracks.length === 3
        && normalTrack?.taskStatus === 'completed'
        && normalTrack?.loopStatus === 'completed'
        && normalTrack?.jobs === 7
        && repairTrack?.loopStatus === 'completed'
        && repairTrack?.jobs >= 2
        && blockingTrack?.loopStatus === 'waiting_for_user'
        && blockingTrack?.jobs === 0
        && normal.jobs.every((job) => job.status === 'completed' && job.artifactTruthStatus === 'valid'),
      [
        'acceptance/harness-loop/production/agent-loop-matrix.json',
        'acceptance/harness-loop/production/spt1-normal/evidence.json',
      ],
      'Normal, repairable and scientific-blocking production tracks are present.',
    ),
    makeCheck(
      'G0-START-03',
      repairMatrix.passed === true
        && repairMatrix.failedJobs.length >= 1
        && repairMatrix.completedJobs.length >= 1
        && repairMatrix.evidenceCount >= 2
        && finalRepairCheckpoint?.repairAttempt?.repaired === true
        && repairable.jobs.some((job) => job.status === 'failed' && job.artifactTruthStatus === 'blocked')
        && repairable.jobs.some((job) => job.status === 'completed' && job.artifactTruthStatus === 'valid'),
      [
        'acceptance/harness-loop/production/validator-repair-matrix.json',
        'acceptance/harness-loop/production/spt1-repairable/evidence.json',
      ],
      'Failed parent truth remains blocked and a verified replacement carries repair lineage.',
    ),
    makeCheck(
      'G0-START-04',
      restartMatrix.passed === true
        && restartMatrix.loopStatus === 'failed'
        && restartMatrix.recoveryRequired === true
        && restartMatrix.recoveryReason === 'server_restart_during_active_loop',
      ['acceptance/harness-loop/production/restart-recovery-matrix.json'],
      'Restart interruption is rebuilt as recovery-required, not silent success.',
    ),
    makeCheck(
      'G0-START-05',
      providerMatrix.passed === true
        && providerMatrix.passedProviders >= 2
        && providerMatrix.targets.filter((target) => target.passedBar === true).length >= 2
        && providerMatrix.privacy === 'no_credentials_urls_headers_or_provider_responses',
      ['acceptance/harness-loop/production/provider-matrix.json'],
      'Two live Provider profiles pass required probes with sanitized evidence.',
    ),
    makeCheck(
      'G0-START-06',
      /Overall: PASS/.test(uiMatrix)
        && (uiMatrix.match(/\| PASS \|/g) || []).length >= 8
        && /820×900/.test(uiMatrix)
        && /recovery-required/.test(uiMatrix),
      ['acceptance/harness-loop/production/ui-matrix.md'],
      'Renderer covers themes, narrow viewport, stop history and restart recovery.',
    ),
    makeCheck(
      'G0-START-07',
      deliveredTasks.length >= 2
        && normal.jobs.filter((job) => job.status === 'completed').every((job) =>
          validSha(job.hashes?.paramsSha256)
          && validSha(job.hashes?.provenanceSha256)
          && validSha(job.hashes?.scriptSha256)
        ),
      ['acceptance/harness-loop/production/spt1-normal/evidence.json'],
      'Real tasks retain scripts, parameters, provenance, Delivery and Replay hashes.',
    ),
    makeCheck(
      'G0-START-08',
      hleGate.passed === true
        && hleGate.totalFailed === 0
        && hleGate.totalPassed === hleGate.totalCommands
        && (bootstrap || verificationPassed),
      [
        'acceptance/harness-loop/hle-all-gate.json',
        ...(verification ? ['acceptance/g0-living-foundation/g0-lf0-acceptance.json'] : []),
      ],
      bootstrap
        ? 'Bootstrap mode validates the historical HLE gate while the current full gate is running.'
        : 'Root tests/check, frontend tests/build and production HLE verification passed.',
    ),
    makeCheck(
      'G0-START-09',
      /HLE-C0～HLE-C5 已完成/.test(handoff)
        && /`G0-START`.*LF0.*已关闭/.test(handoff)
        && auditRecordsProductionClosure,
      [
        'docs/project-workspace-handoff.md',
        'acceptance/harness-loop/hle-all-gate.json',
        'acceptance/harness-loop/production/validator-repair-matrix.json',
        'acceptance/harness-loop/production/restart-recovery-matrix.json',
        'acceptance/harness-loop/production/provider-matrix.json',
      ],
      'Plan, audit broadcast and handoff agree that HLE is closed and G0 START/LF0 are established.',
    ),
    makeCheck(
      'G0-START-10',
      evidenceCommits.every((commit) => validGitCommit(commit) && isAncestor(commit)),
      [
        'acceptance/harness-loop/production/baseline.json',
        'git:HEAD',
      ],
      'Every production evidence source commit exists and is an ancestor of the current source state.',
    ),
  ];

  return {
    schemaVersion: 1,
    gate: 'G0-START',
    sourceCommit: git('rev-parse', 'HEAD'),
    sourceTree: hash(git('status', '--short', '--untracked-files=no')),
    privacy: 'sanitized_status_hashes_relative_paths_and_command_digests_only',
    checks,
    passed: checks.every((check) => check.passed),
  };
}

export function writeStartEvidence(report, targetPath = START_EVIDENCE_PATH) {
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(report, null, 2)}\n`);
}

function verifyStoredEvidence() {
  const bootstrap = process.env.G0_LF0_BOOTSTRAP === '1';
  if (bootstrap) {
    const report = inspectG0Start({ bootstrap: true });
    if (!report.passed) throw new Error(`G0-START bootstrap failed: ${report.checks.filter((item) => !item.passed).map((item) => item.id).join(', ')}`);
    console.log('[G0-START] PASS (bootstrap current gate)');
    return;
  }
  if (!existsSync(START_EVIDENCE_PATH)) {
    throw new Error('G0-START evidence missing; run npm run g0:lf0:update after the LF0 source commit');
  }
  const stored = JSON.parse(readFileSync(START_EVIDENCE_PATH, 'utf8'));
  const report = inspectG0Start({ verification: stored.verification });
  if (!stored.passed || !report.passed) {
    throw new Error(`G0-START failed: ${report.checks.filter((item) => !item.passed).map((item) => item.id).join(', ')}`);
  }
  if (stored.sourceCommit !== report.sourceCommit && !isAncestor(stored.sourceCommit)) {
    throw new Error('G0-START evidence source commit is not an ancestor of HEAD');
  }
  console.log('[G0-START] PASS — 10/10 launch conditions verified');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    verifyStoredEvidence();
  } catch (error) {
    console.error(`[G0-START] FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}
