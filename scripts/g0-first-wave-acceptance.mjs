#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(repoRoot, 'acceptance/g0-living-foundation/g0-first-wave-acceptance.json');
const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const durable = require('../core/shared-backend/g0-durable-state');
const read = (relative) => readFileSync(join(repoRoot, relative), 'utf8');
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });

function isAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function inspect(verification = null, bootstrap = false) {
  const workflow = read('core/biof3-server/helpers/harness-workflow-state.js');
  const delivery = read('core/shared-backend/delivery-manifest.js');
  const db = read('core/biof3-server/db.js');
  const server = read('core/biof3-server/server.js');
  const pluginLoader = read('core/biof3-server/plugin-loader.js');
  const policy = read('core/biof3-server/agent-tools/agent-tool-policy.js');
  const plan = read('docs/g0-living-foundation-plan.md');
  const commands = verification?.commands || [];
  const checks = [
    item('G0-W1-01', g0.validateG0BaselineBundle().ok && g0.manifest.lifecycleStatus === 'maintained' && g0.manifest.qualificationStatus === 'qualified', ['core/shared-backend/g0/baseline-manifest.json'], 'Maintained qualified baseline retains first-wave contracts.'),
    item('G0-W1-02', g0.truthLattice.levels.map((entry) => entry.id).join(',') === 'job,artifact,scientific,delivery,presentation', ['core/shared-backend/g0/truth-lattice.json'], 'Five truth levels have fixed authorities.'),
    item('G0-W1-03', /buildTruthProjection/.test(workflow) && /truthProjection/.test(delivery), ['core/biof3-server/helpers/harness-workflow-state.js', 'core/shared-backend/delivery-manifest.js'], 'Workflow and Delivery use the shared projection.'),
    item('G0-W1-04', g0.truthLattice.completionRule.includes('presentation cannot promote'), ['core/shared-backend/g0/truth-lattice.json', 'test/g0-first-wave.test.mjs'], 'Presentation cannot promote upstream truth.'),
    item('G0-W1-05', g0.truthLattice.invalidationFingerprintFields.length === 5 && /reduceTruthEvents/.test(read('core/shared-backend/g0-truth-projection.js')), ['core/shared-backend/g0-truth-projection.js'], 'Invalidation and event reduction are deterministic.'),
    item('G0-W1-06', durable.validateDurableInventory().ok && durable.inventory.objects.length >= 13, ['core/shared-backend/g0/durable-state-inventory.json'], 'Durable objects have owners, stores and recovery outcomes.'),
    item('G0-W1-07', durable.inventory.failureClasses.length === 10 && /markStalledToolJobsRecovery/.test(db) && /recovery_required/.test(server), ['core/shared-backend/g0-durable-state.js', 'core/biof3-server/db.js', 'core/biof3-server/server.js'], 'Failure inventory reuses production recovery.'),
    item('G0-W1-08', g0.capabilitySupplyChain.requiredControls.length >= 10 && /builtin-canonical/.test(pluginLoader), ['core/shared-backend/g0/capability-supply-chain.json', 'core/biof3-server/plugin-loader.js'], 'LF7 foundation fixes source and supply controls.'),
    item('G0-W1-09', g0.securityPermissionMatrix.nonOverridableBoundaries.length >= 6 && /source_data_immutable/.test(policy), ['core/shared-backend/g0/security-permission-matrix.json', 'core/biof3-server/agent-tools/agent-tool-policy.js'], 'LF8 foundation keeps full-access invariants.'),
    item('G0-W1-10', g0.manifest.executionTruthChain.join(',') === 'run_tool,tool_job,artifact_truth', ['core/shared-backend/g0/constitution.json'], 'No second execution truth exists.'),
    item('G0-W1-11', bootstrap || (/G0-LF1[\s\S]*?状态：`completed`/.test(plan) && /G0-LF2[\s\S]*?状态：`completed`/.test(plan)), ['docs/g0-living-foundation-plan.md'], bootstrap ? 'Source bootstrap before status promotion.' : 'LF1/LF2 completion recorded.'),
    item('G0-W1-12', bootstrap || (commands.length >= 7 && commands.every((entry) => entry.passed)), ['acceptance/g0-living-foundation/g0-first-wave-acceptance.json'], bootstrap ? 'Evidence bootstrap.' : 'All required command gates passed.'),
  ];
  return {
    schemaVersion: 1,
    workPackage: 'G0-FIRST-WAVE',
    sourceCommit: git('rev-parse', 'HEAD'),
    baseline: g0.getCurrentG0Baseline(),
    privacy: 'status_and_output_digests_only_no_raw_output_credentials_headers_urls_or_provider_responses',
    checks,
    ...(verification ? { verification } : {}),
    passed: checks.every((entry) => entry.passed),
  };
}

function runCommands() {
  const specs = [
    ['first-wave-test', 'node', ['--test', 'test/g0-first-wave.test.mjs', 'test/g0-baseline.test.mjs', 'test/g0-project-baseline.test.mjs', 'test/harness-workflow-state.test.mjs']],
    ['root-test', 'npm', ['test']],
    ['frontend-test', 'npm', ['run', 'test:files', '--prefix', 'frontend']],
    ['frontend-build', 'npm', ['run', 'build', '--prefix', 'frontend']],
    ['root-check', 'npm', ['run', 'check']],
    ['hle-production', 'npm', ['run', 'harness:loop:production']],
    ['plugin-contracts', 'npm', ['run', 'harness:check']],
  ];
  return specs.map(([label, bin, args]) => {
    const result = spawnSync(bin, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        G0_FIRST_WAVE_BOOTSTRAP: '1',
        G0_LF0_BOOTSTRAP: '1',
        G0_SECOND_WAVE_BOOTSTRAP: '1',
        G0_THIRD_WAVE_BOOTSTRAP: '1',
        G0_FOURTH_WAVE_BOOTSTRAP: '1',
        G0_FIFTH_WAVE_BOOTSTRAP: '1',
      },
    });
    return {
      label,
      command: [bin, ...args].join(' '),
      exitCode: result.status,
      signal: result.signal || null,
      passed: result.status === 0,
      stdoutSha256: sha(result.stdout || ''),
      stderrSha256: sha(result.stderr || ''),
    };
  });
}

function updateEvidence() {
  const verification = { generatedAt: new Date().toISOString(), commands: runCommands() };
  const report = inspect(verification);
  report.generatedAt = verification.generatedAt;
  if (!report.passed) {
    const failed = report.checks.filter((entry) => !entry.passed).map((entry) => entry.id);
    const commands = verification.commands.filter((entry) => !entry.passed).map((entry) => `${entry.label}(exit=${entry.exitCode})`);
    throw new Error(`cannot write failed evidence: ${[...failed, ...commands].join(', ')}`);
  }
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log('[G0-FIRST-WAVE] PASS — evidence updated');
}

function verifyEvidence() {
  if (process.env.G0_FIRST_WAVE_BOOTSTRAP === '1') {
    const report = inspect(null, true);
    if (!report.passed) throw new Error(report.checks.filter((entry) => !entry.passed).map((entry) => entry.id).join(', '));
    console.log('[G0-FIRST-WAVE] PASS (bootstrap current gate)');
    return;
  }
  if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:first-wave:update');
  const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
  if (!isAncestor(stored.sourceCommit)) throw new Error('evidence source commit is not an ancestor of HEAD');
  if (stored.baseline?.bundleDigest !== g0.getQualificationSubjectBaseline().bundleDigest) throw new Error('qualified subject changed without requalification');
  const current = inspect(stored.verification);
  if (!stored.passed || !current.passed) throw new Error(current.checks.filter((entry) => !entry.passed).map((entry) => entry.id).join(', '));
  console.log('[G0-FIRST-WAVE] PASS — 12/12');
}

try {
  if (process.argv.includes('--write-evidence')) updateEvidence();
  else verifyEvidence();
} catch (error) {
  console.error(`[G0-FIRST-WAVE] FAIL — ${error.message}`);
  process.exitCode = 1;
}
