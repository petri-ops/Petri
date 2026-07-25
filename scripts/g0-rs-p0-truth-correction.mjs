#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-result-studio/rs-p0-truth-correction.json');
const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const productQualification = require('../core/shared-backend/result-studio-qualification');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const HISTORICAL_INPUTS = Object.freeze({
  'rs9-product-acceptance': 'acceptance/g0-result-studio/rs9-product-acceptance.json',
  'rs9-provider-acceptance': 'acceptance/g0-result-studio/rs9-provider-acceptance.json',
  'rs9-visual-acceptance': 'acceptance/g0-result-studio/rs9-visual-acceptance.json',
  'rs9-visual-table-seed': 'scripts/g0-rs9-visual-table-seed.cjs',
});

const SOURCE_INPUTS = Object.freeze({
  projectWorkspace: 'frontend/src/pages/project-workspace.tsx',
  artifactSelection: 'frontend/src/lib/artifact-selection.ts',
  resultStudioRoute: 'core/r-server/routes/result-studio.js',
  systemPrompt: 'core/r-server/helpers/system-prompt.js',
  supportMatrix: 'core/shared-backend/g0/support-matrix.json',
  qualificationManifest: 'core/shared-backend/g0/qualification-manifest.json',
  productQualification: 'core/shared-backend/result-studio-qualification.js',
  uiBaseline: 'acceptance/g0-result-studio/rs-p0-ui-baseline.json',
});

const readRelative = (relativePath) => readFileSync(join(root, relativePath), 'utf8');
const hashRelative = (relativePath) => sha256(readFileSync(join(root, relativePath)));

function safeReport(value) {
  const raw = JSON.stringify(value);
  return !/https?:\/\//i.test(raw)
    && !/Bearer\s+/i.test(raw)
    && !/sk-[A-Za-z0-9]{12,}/.test(raw)
    && !/\/Users\/[^/]+\//.test(raw)
    && !/\/home\/[^/]+\//.test(raw);
}

function currentObservations() {
  const workspace = readRelative(SOURCE_INPUTS.projectWorkspace);
  const route = readRelative(SOURCE_INPUTS.resultStudioRoute);
  const prompt = readRelative(SOURCE_INPUTS.systemPrompt);
  const componentFiles = readdirSync(join(root, 'frontend/src/components/result-studio')).sort();
  const setterCalls = [...workspace.matchAll(/setArtifactSelection\(([^)]*)\)/g)].map((match) => match[1].trim());
  const selectionBuilders = [
    'buildRowSelection',
    'buildQuerySelection',
    'buildPointSelection',
    'buildRegionSelection',
    'toPersistPayload',
    'fromPersistedSelection',
    'formatSelectionChip',
  ];
  const missingPromptBindings = [
    'artifactId',
    'revisionId',
    'artifactFamilyId',
    'selectionId',
    'sourceScriptRef',
  ].filter((field) => !prompt.includes(`context.activeArtifact.${field}`));
  return [
    {
      id: 'selection_ui_unwired',
      status: setterCalls.length === 1 && setterCalls[0] === 'null'
        && selectionBuilders.every((name) => !workspace.includes(name)) ? 'observed' : 'not_observed',
      evidenceRef: SOURCE_INPUTS.projectWorkspace,
      detail: 'artifactSelection is only cleared; selection builders are not consumed by the workspace UI',
    },
    {
      id: 'plot_entity_mapping_unavailable',
      status: route.includes('entityMapping: null') ? 'observed' : 'not_observed',
      evidenceRef: SOURCE_INPUTS.resultStudioRoute,
      detail: 'generic plot interaction advertises no stable entity mapping',
    },
    {
      id: 'agent_result_context_incomplete',
      status: missingPromptBindings.length === 5 ? 'observed' : 'not_observed',
      evidenceRef: SOURCE_INPUTS.systemPrompt,
      detail: 'system prompt does not bind artifact/revision/family/selection/source-script coordinates',
      missingBindings: missingPromptBindings,
    },
    {
      id: 'manual_and_ai_editor_missing',
      status: componentFiles.every((name) => !/Manual|ParameterEditor|EditComposer|ResultStudioCanvas/.test(name)) ? 'observed' : 'not_observed',
      evidenceRef: 'frontend/src/components/result-studio',
      detail: 'component surface contains review/client files but no manual parameter editor, AI composer or central canvas',
      componentFileNames: componentFiles,
    },
  ];
}

function buildReport() {
  const historicalEvidence = Object.entries(HISTORICAL_INPUTS).map(([id, sourceRef]) => {
    const policy = productQualification.classifyHistoricalEvidence(id);
    return {
      id,
      sourceRef,
      sourceSha256: hashRelative(sourceRef),
      classification: policy.classification,
      qualificationEligible: policy.qualificationEligible,
      reasons: [...policy.reasons],
    };
  });
  const observations = currentObservations();
  const capability = g0.supportMatrix.productCapabilities.find((item) => item.id === 'result-studio-editing');
  const resultStudioRequired = g0.qualificationManifest.requiredEvidenceClasses.some((item) => item.id === 'result_studio_product');
  const resultStudioSupported = g0.qualificationManifest.supportClaims.some((item) => item.id === 'result-studio-editing');
  const resultStudioExcluded = g0.qualificationManifest.excludedClaims.some((item) => item.id === 'result-studio-editing');
  const storedRs9 = JSON.parse(readRelative(HISTORICAL_INPUTS['rs9-product-acceptance']));
  const uiBaseline = JSON.parse(readRelative(SOURCE_INPUTS.uiBaseline));
  const oldQualificationVerdict = productQualification.evaluateResultStudioQualification(storedRs9);
  const checks = {
    baselinePatchVersioned: g0.manifest.baselineVersion === '1.1.1'
      && g0.registry.baselines.find((item) => item.baselineId === g0.manifest.baselineId)?.baselineVersion === '1.1.1',
    baselineBundleValid: g0.validateG0BaselineBundle().ok === true,
    capabilityExperimental: capability?.status === 'experimental',
    claimExcluded: resultStudioExcluded && !resultStudioSupported,
    productEvidenceNotMandatory: resultStudioRequired === false,
    historicalEvidenceClassified: historicalEvidence.length === 4
      && historicalEvidence.every((item) => item.qualificationEligible === false && item.reasons.length > 0),
    oldRs9Rejected: oldQualificationVerdict.passed === false,
    productGapsObserved: observations.length === 4 && observations.every((item) => item.status === 'observed'),
    continuousTraceContractFrozen: productQualification.RESULT_STUDIO_QUALIFICATION_VERSION === 2
      && productQualification.RESULT_STUDIO_PRODUCT_TRACE_VERSION === 1
      && productQualification.REQUIRED_TRACE_STEPS.length === 14,
    interactiveBaselineRecorded: uiBaseline.captureMode === 'interactive_dev_renderer_observation'
      && uiBaseline.qualificationEligible === false
      && uiBaseline.observations?.every((item) => item.status === 'observed') === true,
  };
  const report = {
    schemaVersion: 1,
    workPackage: 'G0-RS-P0',
    sourceCommit: git('rev-parse', 'HEAD'),
    baseline: g0.getCurrentG0Baseline(),
    status: 'implemented_unverified',
    supportClaim: {
      id: 'result-studio-editing',
      status: capability?.status || null,
      qualificationEligible: false,
      reason: capability?.reason || null,
      nextQualificationStage: 'G0-RS-P7',
    },
    evidencePolicy: {
      historicalEvidence,
      qualifyingEvidenceKind: 'continuous_product_trace_v1',
      forbiddenSubstitutions: [...productQualification.FORBIDDEN_EVIDENCE_KINDS],
    },
    productBaseline: {
      engineFoundation: 'implemented',
      productSurface: 'incomplete',
      qualification: 'suspended',
      rendererObservationRef: SOURCE_INPUTS.uiBaseline,
      observations,
    },
    traceContract: {
      schemaVersion: productQualification.RESULT_STUDIO_PRODUCT_TRACE_VERSION,
      qualificationVersion: productQualification.RESULT_STUDIO_QUALIFICATION_VERSION,
      requiredSteps: [...productQualification.REQUIRED_TRACE_STEPS],
      requiredInvariants: [...productQualification.REQUIRED_INVARIANTS],
      qualifyingEvidenceKinds: [...productQualification.QUALIFYING_EVIDENCE_KINDS],
    },
    inputHashes: Object.fromEntries(Object.entries({ ...HISTORICAL_INPUTS, ...SOURCE_INPUTS }).map(([id, file]) => [id, hashRelative(file)])),
    checks,
    privacy: 'repository_relative_refs_hashes_contract_ids_and_deterministic_source_observations_only',
    runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    generatedAt: new Date().toISOString(),
  };
  report.privacyClean = safeReport(report);
  report.passed = Object.values(checks).every(Boolean) && report.privacyClean;
  return report;
}

function isAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function verifyStored(live) {
  if (!existsSync(evidencePath)) throw new Error('rs_p0_evidence_missing');
  const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
  if (!stored.passed || !Object.values(stored.checks || {}).every(Boolean)) throw new Error('rs_p0_truth_correction_failed');
  if (!isAncestor(stored.sourceCommit)) throw new Error('rs_p0_source_not_ancestor');
  if (stored.baseline?.bundleDigest !== live.baseline.bundleDigest) throw new Error('rs_p0_baseline_stale');
  if (stored.runnerSha256 !== live.runnerSha256) throw new Error('rs_p0_runner_stale');
  for (const [id, digest] of Object.entries(live.inputHashes)) {
    if (stored.inputHashes?.[id] !== digest) throw new Error(`rs_p0_input_stale:${id}`);
  }
  return stored;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const report = buildReport();
    if (!report.passed) {
      const failed = Object.entries(report.checks).filter(([, passed]) => !passed).map(([id]) => id);
      throw new Error(`rs_p0_truth_correction_failed:${failed.join(',')}`);
    }
    if (argv.includes('--write-evidence')) {
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
      console.log('[G0-RS-P0] PASS — truth corrected; Result Studio product claim remains experimental');
    } else {
      verifyStored(report);
      console.log('[G0-RS-P0] PASS — stored truth-correction evidence valid');
    }
  } catch (error) {
    console.error(`[G0-RS-P0] FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
