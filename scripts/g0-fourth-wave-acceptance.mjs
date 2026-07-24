#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-living-foundation/g0-fourth-wave-acceptance.json');
const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const supply = require('../core/shared-backend/g0-capability-supply-chain');
const resilience = require('../core/shared-backend/g0-resilience-lab');
const read = (f) => readFileSync(join(root, f), 'utf8');
const sha = (v) => createHash('sha256').update(String(v)).digest('hex');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });
const ancestor = (c) => { try { execFileSync('git', ['merge-base', '--is-ancestor', c, 'HEAD'], { cwd: root, stdio: 'ignore' }); return true; } catch { return false; } };
function inspect(verification = null, bootstrap = false) {
  const plan = read('docs/g0-living-foundation-plan.md');
  const loader = read('core/shared-backend/plugin-sdk.js');
  const policy = read('core/r-server/agent-tools/agent-tool-policy.js');
  const workspace = read('core/r-server/agent-tools/workspace-tools.js');
  const server = read('core/r-server/server.js');
  const commands = verification?.commands || [];
  const checks = [
    item('G0-W4-01', g0.validateG0BaselineBundle().ok && g0.manifest.lifecycleStatus === 'maintained' && g0.manifest.qualificationStatus === 'qualified', ['core/shared-backend/g0/baseline-manifest.json'], 'Maintained qualified baseline retains fourth-wave contracts.'),
    item('G0-W4-02', g0.capabilitySupplyChain.contractVersion === 2 && g0.capabilitySupplyChain.requiredControls.length >= 16, ['core/shared-backend/g0/capability-supply-chain.json'], 'LF7 production controls are complete.'),
    item('G0-W4-03', /builtin-canonical/.test(loader) && supply.contract.forbidden.includes('plugin_owned_job_or_artifact_ledger'), ['core/shared-backend/plugin-sdk.js'], 'LF7 reuses canonical Plugin SDK without a second ledger.'),
    item('G0-W4-04', /failureModes/.test(loader) && /validators/.test(read('core/shared-backend/g0-capability-supply-chain.js')), ['core/shared-backend/plugin-sdk.js', 'core/shared-backend/g0-capability-supply-chain.js'], 'Plugin failure and validator contracts are enforced.'),
    item('G0-W4-05', g0.securityPermissionMatrix.contractVersion === 2 && g0.securityPermissionMatrix.riskFactors.length === 6, ['core/shared-backend/g0/security-permission-matrix.json'], 'LF8 evaluates mode, scope, risk, path and side effects.'),
    item('G0-W4-06', /source_data_immutable/.test(policy) && /command_blocked/.test(workspace), ['core/r-server/agent-tools/agent-tool-policy.js', 'core/r-server/agent-tools/workspace-tools.js'], 'LF8 production boundaries remain wired.'),
    item('G0-W4-07', g0.securityPermissionMatrix.fullAccessStillBlocks.length >= 7, ['core/shared-backend/g0/security-permission-matrix.json'], 'Full access retains non-negotiable blocks.'),
    item('G0-W4-08', resilience.validateFaultMatrix().ok && resilience.contract.faultDomains.length === 8, ['core/shared-backend/g0/resilience-lab.json'], 'LF10 covers eight fault domains.'),
    item('G0-W4-09', resilience.contract.requiredAssertions.length === 5 && /recovery_required/.test(server), ['core/r-server/server.js'], 'LF10 requires no false success, audit, isolation, stable science and bounded retry.'),
    item('G0-W4-10', g0.manifest.executionTruthChain.join(',') === 'run_tool,tool_job,artifact_truth', ['core/shared-backend/g0/constitution.json'], 'No second execution or fault truth exists.'),
    item('G0-W4-11', bootstrap || (/G0-LF7[\s\S]*?状态：`completed`/.test(plan) && /G0-LF8[\s\S]*?状态：`completed`/.test(plan) && /G0-LF10[\s\S]*?状态：`completed`/.test(plan)), ['docs/g0-living-foundation-plan.md'], bootstrap ? 'Source bootstrap.' : 'LF7/LF8/LF10 completion recorded.'),
    item('G0-W4-12', bootstrap || (commands.length >= 8 && commands.every((x) => x.passed)), ['acceptance/g0-living-foundation/g0-fourth-wave-acceptance.json'], bootstrap ? 'Evidence bootstrap.' : 'All command gates passed.'),
  ];
  return { schemaVersion: 1, workPackage: 'G0-FOURTH-WAVE', sourceCommit: git('rev-parse', 'HEAD'), baseline: g0.getCurrentG0Baseline(), privacy: 'digests_and_counts_only_no_raw_data_credentials_urls_or_provider_responses', checks, ...(verification ? { verification } : {}), passed: checks.every((x) => x.passed) };
}
function runCommands() {
  const specs = [
    ['fourth-wave-test','node',['--test','test/g0-fourth-wave.test.mjs','test/g0-third-wave.test.mjs','test/plugin-sdk.test.mjs','test/agent-tool-policy.test.mjs','test/harness-workspace-tools.test.mjs','test/diagnostic-redaction.test.mjs','test/loop-recovery-integration.test.mjs','test/loop-false-success-regression.test.mjs']],
    ['root-test','npm',['test']], ['frontend-test','npm',['test','--prefix','frontend']], ['frontend-build','npm',['run','build','--prefix','frontend']],
    ['root-check','npm',['run','check']], ['plugins','npm',['run','harness:plugins']], ['hle-production','npm',['run','harness:loop:production']], ['runtime-control','npm',['run','harness:runtime-control']],
  ];
  return specs.map(([label,bin,args]) => { const r=spawnSync(bin,args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,G0_LF0_BOOTSTRAP:'1',G0_FIRST_WAVE_BOOTSTRAP:'1',G0_SECOND_WAVE_BOOTSTRAP:'1',G0_THIRD_WAVE_BOOTSTRAP:'1',G0_FOURTH_WAVE_BOOTSTRAP:'1',G0_FIFTH_WAVE_BOOTSTRAP:'1'}}); return {label,command:[bin,...args].join(' '),exitCode:r.status,signal:r.signal||null,passed:r.status===0,stdoutSha256:sha(r.stdout||''),stderrSha256:sha(r.stderr||'')}; });
}
try {
  if (process.argv.includes('--write-evidence')) { const verification={generatedAt:new Date().toISOString(),commands:runCommands()}; const report={...inspect(verification),generatedAt:verification.generatedAt}; if(!report.passed) throw new Error([...report.checks.filter(x=>!x.passed).map(x=>x.id),...verification.commands.filter(x=>!x.passed).map(x=>`${x.label}:${x.exitCode}`)].join(',')); mkdirSync(dirname(evidencePath),{recursive:true}); writeFileSync(evidencePath,`${JSON.stringify(report,null,2)}\n`); console.log('[G0-FOURTH-WAVE] PASS — evidence updated'); }
  else if(process.env.G0_FOURTH_WAVE_BOOTSTRAP==='1'){const report=inspect(null,true);if(!report.passed)throw new Error(report.checks.filter(x=>!x.passed).map(x=>x.id).join(','));console.log('[G0-FOURTH-WAVE] PASS (bootstrap current gate)');}
  else {if(!existsSync(evidencePath))throw new Error('evidence missing; run npm run g0:fourth-wave:update');const stored=JSON.parse(readFileSync(evidencePath,'utf8'));if(!ancestor(stored.sourceCommit)||stored.baseline?.bundleDigest!==g0.getQualificationSubjectBaseline().bundleDigest||!stored.passed||!inspect(stored.verification).passed)throw new Error('stored evidence invalid or stale');console.log('[G0-FOURTH-WAVE] PASS — 12/12');}
} catch(error){console.error(`[G0-FOURTH-WAVE] FAIL — ${error.message}`);process.exitCode=1;}
