#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-living-foundation/g0-third-wave-acceptance.json');
const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const runtime = require('../core/shared-backend/g0-adaptive-runtime');
const memory = require('../core/shared-backend/g0-model-memory-cost');
const observable = require('../core/shared-backend/g0-observable-experience');
const read = (file) => readFileSync(join(root, file), 'utf8');
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const check = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });
const ancestor = (commit) => { try { execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'ignore' }); return true; } catch { return false; } };

function inspect(verification = null, bootstrap = false) {
  const plan = read('docs/g0-living-foundation-plan.md');
  const executor = read('core/r-server/helpers/tools-executor.js');
  const gateway = read('core/shared-backend/llm-providers/model-gateway.js');
  const checkpoint = read('core/shared-backend/loop-checkpoint.js');
  const summary = read('frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx');
  const commands = verification?.commands || [];
  const checks = [
    check('G0-W3-01', g0.validateG0BaselineBundle().ok && g0.manifest.lifecycleStatus === 'maintained' && g0.manifest.qualificationStatus === 'qualified', ['core/shared-backend/g0/baseline-manifest.json'], 'Maintained qualified baseline retains third-wave contracts.'),
    check('G0-W3-02', runtime.contract.resourceDimensions.length === 6 && runtime.contract.actions.length >= 7, ['core/shared-backend/g0/adaptive-runtime.json'], 'LF5 resource and control decisions are bounded.'),
    check('G0-W3-03', /createRuntimeResourceSnapshot/.test(executor) && runtime.contract.readinessRequired.length === 5, ['core/r-server/helpers/tools-executor.js'], 'LF5 reuses production resource and readiness truth.'),
    check('G0-W3-04', runtime.contract.scientificBoundary.includes('scientific design change'), ['core/shared-backend/g0/adaptive-runtime.json'], 'Runtime repair cannot silently alter science.'),
    check('G0-W3-05', memory.contract.cacheLayers.length === 5 && memory.contract.cacheFingerprintFields.length === 8, ['core/shared-backend/g0/model-memory-cost.json'], 'LF6 cache layers and invalidation identity are complete.'),
    check('G0-W3-06', memory.contract.durableFactKinds.length >= 7 && /buildLoopContextEnvelope/.test(checkpoint), ['core/shared-backend/loop-checkpoint.js'], 'LF6 compression is anchored to durable facts and checkpoints.'),
    check('G0-W3-07', /fallback/.test(gateway) && memory.contract.fallbackRules.length === 4, ['core/shared-backend/llm-providers/model-gateway.js'], 'Provider fallback remains explicit and audited.'),
    check('G0-W3-08', observable.contract.consumers.length === 5 && observable.contract.sources.length === 6, ['core/shared-backend/g0/observable-experience.json'], 'LF9 consumers share the same sources.'),
    check('G0-W3-09', /useRuntimeResourceSnapshot/.test(summary) && /deriveLoopDisplay/.test(summary), ['frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx'], 'Summary consumes backend Loop and resource truth.'),
    check('G0-W3-10', observable.contract.prohibited.includes('ui_inferred_completion') && observable.contract.prohibited.includes('hidden_reasoning_display'), ['core/shared-backend/g0/observable-experience.json'], 'UI cannot infer completion or expose hidden reasoning.'),
    check('G0-W3-11', bootstrap || (/G0-LF5[\s\S]*?状态：`completed`/.test(plan) && /G0-LF6[\s\S]*?状态：`completed`/.test(plan) && /G0-LF9[\s\S]*?状态：`completed`/.test(plan)), ['docs/g0-living-foundation-plan.md'], bootstrap ? 'Source bootstrap.' : 'LF5/LF6/LF9 completion recorded.'),
    check('G0-W3-12', bootstrap || (commands.length >= 7 && commands.every((item) => item.passed)), [evidencePath.replace(`${root}/`, '')], bootstrap ? 'Evidence bootstrap.' : 'All command gates passed.'),
  ];
  return { schemaVersion: 1, workPackage: 'G0-THIRD-WAVE', sourceCommit: git('rev-parse', 'HEAD'), baseline: g0.getCurrentG0Baseline(), privacy: 'digests_and_counts_only_no_raw_data_credentials_urls_or_provider_responses', checks, ...(verification ? { verification } : {}), passed: checks.every((item) => item.passed) };
}

function commands() {
  const specs = [
    ['third-wave-test', 'node', ['--test', 'test/g0-third-wave.test.mjs', 'test/g0-second-wave.test.mjs', 'test/runtime-resource-snapshot.test.mjs', 'test/loop-checkpoint.test.cjs', 'test/model-gateway.test.mjs', 'test/ai-settings-cache.test.mjs']],
    ['root-test', 'npm', ['test']],
    ['frontend-test', 'npm', ['run', 'test:files', '--prefix', 'frontend']],
    ['frontend-build', 'npm', ['run', 'build', '--prefix', 'frontend']],
    ['root-check', 'npm', ['run', 'check']],
    ['hle-production', 'npm', ['run', 'harness:loop:production']],
    ['runtime-control', 'npm', ['run', 'harness:runtime-control']],
  ];
  return specs.map(([label, bin, args]) => {
    const result = spawnSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, G0_LF0_BOOTSTRAP: '1', G0_FIRST_WAVE_BOOTSTRAP: '1', G0_SECOND_WAVE_BOOTSTRAP: '1', G0_THIRD_WAVE_BOOTSTRAP: '1', G0_FOURTH_WAVE_BOOTSTRAP: '1', G0_FIFTH_WAVE_BOOTSTRAP: '1' } });
    return { label, command: [bin, ...args].join(' '), exitCode: result.status, signal: result.signal || null, passed: result.status === 0, stdoutSha256: sha(result.stdout || ''), stderrSha256: sha(result.stderr || '') };
  });
}

try {
  if (process.argv.includes('--write-evidence')) {
    const verification = { generatedAt: new Date().toISOString(), commands: commands() };
    const report = { ...inspect(verification), generatedAt: verification.generatedAt };
    if (!report.passed) throw new Error([...report.checks.filter((x) => !x.passed).map((x) => x.id), ...verification.commands.filter((x) => !x.passed).map((x) => `${x.label}:${x.exitCode}`)].join(','));
    mkdirSync(dirname(evidencePath), { recursive: true }); writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log('[G0-THIRD-WAVE] PASS — evidence updated');
  } else if (process.env.G0_THIRD_WAVE_BOOTSTRAP === '1') {
    if (!inspect(null, true).passed) throw new Error('bootstrap checks failed');
    console.log('[G0-THIRD-WAVE] PASS (bootstrap current gate)');
  } else {
    if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:third-wave:update');
    const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
    if (!ancestor(stored.sourceCommit) || stored.baseline?.bundleDigest !== g0.getQualificationSubjectBaseline().bundleDigest || !stored.passed || !inspect(stored.verification).passed) throw new Error('stored evidence invalid or stale');
    console.log('[G0-THIRD-WAVE] PASS — 12/12');
  }
} catch (error) { console.error(`[G0-THIRD-WAVE] FAIL — ${error.message}`); process.exitCode = 1; }
