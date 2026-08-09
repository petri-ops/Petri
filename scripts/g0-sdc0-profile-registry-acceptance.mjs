#!/usr/bin/env node

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(repoRoot, 'acceptance/g0-scientific-data-contract/profile-registry.json');
const require = createRequire(import.meta.url);
const profiles = require('../core/shared-backend/artifact-profiles');
const workflow = require('../core/shared-backend/agent-workflow');
const g0 = require('../core/shared-backend/g0-baseline');

const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });
const clone = (value) => JSON.parse(JSON.stringify(value));

function isAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function inspect() {
  const registry = profiles.validateProfileRegistry();
  const profileIds = profiles.listProfiles();
  const identities = profileIds.map((profileId) => profiles.getProfileIdentity(profileId));
  const base = clone(profiles.getProfile('biof3.gene-list.v1'));
  const additive = clone(base);
  additive.profileId = 'biof3.gene-list.v2';
  additive.version = 'v2';
  additive.schemaVersion = 2;
  additive.optionalColumns.push({ name: 'weight', type: 'number', nullable: true });
  const migratory = clone(additive);
  migratory.requiredColumns.push({ name: 'source', type: 'string', nullable: false });
  const semanticBreak = clone(additive);
  semanticBreak.scientificMeaning = 'A distinct scientific object';

  const unknownPlan = {
    agentWorkflowPlanVersion: 1,
    steps: [
      { id: 'source', dependsOn: [], inputBindings: [] },
      {
        id: 'target',
        dependsOn: ['source'],
        inputBindings: [{
          inputId: 'data',
          fromStepId: 'source',
          artifactProfile: 'biof3.unregistered.v1',
        }],
      },
    ],
  };
  const unknownPlanValidation = workflow.validateWorkflowPlanBindings(unknownPlan);
  const changeClasses = [
    profiles.classifyProfileChange(base, additive).changeClass,
    profiles.classifyProfileChange(base, migratory).changeClass,
    profiles.classifyProfileChange(base, semanticBreak).changeClass,
  ];
  const exactCompatibility = profiles.resolveProfileCompatibility('biof3.deg.v1', 'biof3.deg.v1');
  const unknownCompatibility = profiles.resolveProfileCompatibility('biof3.deg.v1', 'biof3.unregistered.v1');

  const checks = [
    item('SDC0-01', registry.valid && registry.profileCount === 6, ['core/shared-backend/artifact-profiles.js'], 'Registry validates with exactly six initial canonical profiles.'),
    item('SDC0-02', profiles.PROFILE_KINDS.join(',') === 'data,artifact,display', ['core/shared-backend/artifact-profiles.js'], 'Data, scientific Artifact and Display Artifact kinds are distinct.'),
    item('SDC0-03', profileIds.every((id) => profiles.validateProfileDefinition(profiles.getProfile(id)).valid), ['test/g0-sdc0-profile-registry.test.mjs'], 'Every profile has a valid versioned machine contract.'),
    item('SDC0-04', identities.length === 6 && new Set(identities.map((entry) => entry.contractDigest)).size === 6, ['acceptance/g0-scientific-data-contract/profile-registry.json'], 'Each profile has a stable, distinct contract digest.'),
    item('SDC0-05', profiles.getProfile('biof3.deg.v1')?.knownColumnAliases?.log2FC === 'log2FoldChange', ['test/hle-c5r-regression.test.mjs'], 'The admitted DEG profile remains backward compatible.'),
    item('SDC0-06', changeClasses.join(',') === 'compatible,migration,breaking', ['test/g0-sdc0-profile-registry.test.mjs'], 'Change classification covers compatible, migration and breaking outcomes.'),
    item('SDC0-07', !unknownPlanValidation.valid && unknownPlanValidation.errors.some((error) => error.includes('unregistered_artifact_profile')), ['core/shared-backend/agent-workflow.js'], 'An unregistered profile cannot become a typed workflow edge.'),
    item('SDC0-08', exactCompatibility.status === 'compatible' && unknownCompatibility.status === 'blocked', ['core/shared-backend/artifact-profiles.js'], 'Compatibility is exact and unknown versions fail closed.'),
    item('SDC0-09', g0.currentContractVersions().artifactProfile === 1, ['core/shared-backend/g0-baseline.js'], 'The G0 contract projection carries the registry schema version.'),
    item('SDC0-10', g0.manifest.executionTruthChain.join(',') === 'run_tool,tool_job,artifact_truth', ['core/shared-backend/g0/baseline-manifest.json'], 'SDC-0 does not create a second execution truth.'),
  ];

  return {
    schemaVersion: 1,
    workPackage: 'G0-SDC0',
    sourceCommit: git('rev-parse', 'HEAD'),
    privacy: 'profile_ids_contract_digests_counts_and_repository_relative_paths_only',
    registryVersion: profiles.ARTIFACT_PROFILE_REGISTRY_VERSION,
    registryDigest: registry.registryDigest,
    profileCount: registry.profileCount,
    profileIdentities: identities,
    changeClasses,
    checks,
    passed: checks.every((check) => check.passed),
  };
}

try {
  const report = inspect();
  if (!report.passed) {
    throw new Error(report.checks.filter((check) => !check.passed).map((check) => check.id).join(','));
  }
  if (process.argv.includes('--write-evidence')) {
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2)}\n`);
    console.log('[G0-SDC0] PASS — evidence updated (10/10)');
  } else {
    if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:sdc0:update');
    const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
    if (!stored.passed || !isAncestor(stored.sourceCommit)) throw new Error('stored evidence source is invalid');
    if (stored.registryDigest !== report.registryDigest || stored.profileCount !== report.profileCount) {
      throw new Error('stored profile registry evidence is stale');
    }
    console.log('[G0-SDC0] PASS — 10/10');
  }
} catch (error) {
  console.error(`[G0-SDC0] FAIL — ${error.message}`);
  process.exitCode = 1;
}
