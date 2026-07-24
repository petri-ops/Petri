#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-living-foundation/g0-fifth-wave-acceptance.json');
const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const evolution = require('../core/shared-backend/g0-evolution-pipeline');
const read = (f) => readFileSync(join(root, f), 'utf8');
const sha = (v) => createHash('sha256').update(String(v)).digest('hex');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });
const ancestor = (c) => { try { execFileSync('git', ['merge-base', '--is-ancestor', c, 'HEAD'], { cwd: root, stdio: 'ignore' }); return true; } catch { return false; } };
function inspect(verification = null, bootstrap = false) {
  const plan = read('docs/g0-living-foundation-plan.md');
  const vocab = g0.governanceVocabulary;
  const commands = verification?.commands || [];
  const gateComplete = evolution.evaluatePromotionGate({ changeClass: 'policy', providedEvidence: [...evolution.contract.promotionGate.requiredEvidence, 'metrics', 'replay', 'rollback'] });
  const gateMissing = evolution.evaluatePromotionGate({ changeClass: 'migration', providedEvidence: ['problem_evidence'] });
  const breaking = evolution.classifyChange({ changeClass: 'breaking' });
  const learnBlocked = evolution.evaluatePolicyLearning({ target: 'scientific_threshold', controls: evolution.contract.policyLearning.requiredControls });
  const learnOk = evolution.evaluatePolicyLearning({ target: 'resource_hint', controls: evolution.contract.policyLearning.requiredControls });
  const checks = [
    item('G0-W5-01', g0.validateG0BaselineBundle().ok && g0.manifest.baselineVersion === '0.6.0' && g0.manifest.qualificationStatus === 'not_yet_qualified', ['core/shared-backend/g0/baseline-manifest.json'], 'Fifth-wave baseline is consistent, versioned 0.6.0 and not qualified.'),
    item('G0-W5-02', evolution.EVOLUTION_PIPELINE_VERSION === 1 && Object.keys(evolution.contract.changeClasses).length === 4, ['core/shared-backend/g0/evolution-pipeline.json'], 'LF11 defines the four change classes.'),
    item('G0-W5-03', evolution.contract.promotionGate.requiredEvidence.length === 8, ['core/shared-backend/g0/evolution-pipeline.json'], 'Promotion Gate requires all eight evidence items.'),
    item('G0-W5-04', evolution.contract.policyLearning.outputKind === 'candidate_only' && evolution.contract.policyLearning.immutableWithoutQualification.includes('scientific_threshold') && evolution.contract.policyLearning.immutableWithoutQualification.includes('conclusion_rule'), ['core/shared-backend/g0/evolution-pipeline.json'], 'Policy learning is candidate-only and cannot drift scientific thresholds or conclusion rules.'),
    item('G0-W5-05', breaking.ok && breaking.requiresNewMajor === true && breaking.requiresMigration === true && evolution.classifyChange({ changeClass: 'policy' }).requiresNewMajor === false, ['core/shared-backend/g0-evolution-pipeline.js'], 'Change classification separates breaking (new major + migration) from policy.'),
    item('G0-W5-06', gateComplete.allowed === true && gateMissing.allowed === false && gateMissing.missing.length > 0 && gateComplete.createsSecondLedger === false, ['core/shared-backend/g0-evolution-pipeline.js'], 'Promotion Gate allows only complete evidence and never creates a second ledger.'),
    item('G0-W5-07', learnBlocked.accepted === false && learnBlocked.reasons.some((r) => r.startsWith('immutable_target')) && learnOk.accepted === true && learnOk.mutatesBaseline === false, ['core/shared-backend/g0-evolution-pipeline.js'], 'Policy learning rejects immutable scientific targets and never mutates the baseline directly.'),
    item('G0-W5-08', g0.manifest.contracts.evolutionPipeline === 1 && Object.keys(vocab.changeClasses).length === 4 && Object.keys(evolution.contract.changeClasses).every((k) => vocab.changeClasses[k]), ['core/shared-backend/g0/baseline-manifest.json', 'core/shared-backend/g0/governance-vocabulary.json'], 'Evolution contract is registered and aligned with governance vocabulary.'),
    item('G0-W5-09', g0.manifest.executionTruthChain.join(',') === 'run_tool,tool_job,artifact_truth', ['core/shared-backend/g0/constitution.json'], 'No second execution or workflow truth is introduced.'),
    item('G0-W5-10', evolution.contract.forbidden.includes('second_execution_or_workflow_truth') && evolution.contract.forbidden.includes('direct_baseline_mutation_from_learning') && evolution.contract.forbidden.includes('implicit_online_scientific_threshold_drift'), ['core/shared-backend/g0/evolution-pipeline.json'], 'LF11 forbids second truth, direct baseline mutation and implicit scientific drift.'),
    item('G0-W5-11', bootstrap || /G0-LF11[\s\S]*?状态：`completed`/.test(plan), ['docs/g0-living-foundation-plan.md'], bootstrap ? 'Source bootstrap.' : 'LF11 completion recorded.'),
    item('G0-W5-12', bootstrap || (commands.length >= 8 && commands.every((x) => x.passed)), ['acceptance/g0-living-foundation/g0-fifth-wave-acceptance.json'], bootstrap ? 'Evidence bootstrap.' : 'All command gates passed.'),
  ];
  return { schemaVersion: 1, workPackage: 'G0-FIFTH-WAVE', sourceCommit: git('rev-parse', 'HEAD'), baseline: g0.getCurrentG0Baseline(), privacy: 'digests_and_counts_only_no_raw_data_credentials_urls_or_provider_responses', checks, ...(verification ? { verification } : {}), passed: checks.every((x) => x.passed) };
}
function runCommands() {
  const specs = [
    ['fifth-wave-test','node',['--test','test/g0-fifth-wave.test.mjs','test/g0-fourth-wave.test.mjs','test/g0-third-wave.test.mjs']],
    ['root-test','npm',['test']], ['frontend-test','npm',['test','--prefix','frontend']], ['frontend-build','npm',['run','build','--prefix','frontend']],
    ['root-check','npm',['run','check']], ['plugins','npm',['run','harness:plugins']], ['hle-production','npm',['run','harness:loop:production']], ['runtime-control','npm',['run','harness:runtime-control']],
  ];
  return specs.map(([label,bin,args]) => { const r=spawnSync(bin,args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,G0_LF0_BOOTSTRAP:'1',G0_FIRST_WAVE_BOOTSTRAP:'1',G0_SECOND_WAVE_BOOTSTRAP:'1',G0_THIRD_WAVE_BOOTSTRAP:'1',G0_FOURTH_WAVE_BOOTSTRAP:'1',G0_FIFTH_WAVE_BOOTSTRAP:'1'}}); return {label,command:[bin,...args].join(' '),exitCode:r.status,signal:r.signal||null,passed:r.status===0,stdoutSha256:sha(r.stdout||''),stderrSha256:sha(r.stderr||'')}; });
}
try {
  if (process.argv.includes('--write-evidence')) { const verification={generatedAt:new Date().toISOString(),commands:runCommands()}; const report={...inspect(verification),generatedAt:verification.generatedAt}; if(!report.passed) throw new Error([...report.checks.filter(x=>!x.passed).map(x=>x.id),...verification.commands.filter(x=>!x.passed).map(x=>`${x.label}:${x.exitCode}`)].join(',')); mkdirSync(dirname(evidencePath),{recursive:true}); writeFileSync(evidencePath,`${JSON.stringify(report,null,2)}\n`); console.log('[G0-FIFTH-WAVE] PASS — evidence updated'); }
  else if(process.env.G0_FIFTH_WAVE_BOOTSTRAP==='1'){const report=inspect(null,true);if(!report.passed)throw new Error(report.checks.filter(x=>!x.passed).map(x=>x.id).join(','));console.log('[G0-FIFTH-WAVE] PASS (bootstrap current gate)');}
  else {if(!existsSync(evidencePath))throw new Error('evidence missing; run npm run g0:fifth-wave:update');const stored=JSON.parse(readFileSync(evidencePath,'utf8'));if(!ancestor(stored.sourceCommit)||stored.baseline?.bundleDigest!==g0.getCurrentG0Baseline().bundleDigest||!stored.passed||!inspect(stored.verification).passed)throw new Error('stored evidence invalid or stale');console.log('[G0-FIFTH-WAVE] PASS — 12/12');}
} catch(error){console.error(`[G0-FIFTH-WAVE] FAIL — ${error.message}`);process.exitCode=1;}
