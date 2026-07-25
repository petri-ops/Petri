'use strict';

const crypto = require('node:crypto');

const RESULT_STUDIO_QUALIFICATION_VERSION = 1;

const REQUIRED_TASKS = Object.freeze([
  'deg_selection_to_enrichment',
  'volcano_ai_presentation_edit',
  'heatmap_manual_then_ai_edit',
  'scientific_threshold_recompute',
  'historical_alternative_compare',
]);

const REQUIRED_ENVIRONMENTS = Object.freeze([
  'managed_non_git',
  'existing_clean_git',
  'existing_dirty_git',
  'restart_and_interruption',
  'light_theme',
  'dark_theme',
  'viewport_820',
  'viewport_wide',
  'two_real_providers',
]);

const REQUIRED_EVIDENCE = Object.freeze([
  'git_commits_refs',
  'changesets_revisions',
  'job_artifact_truth',
  'scripts_parameters',
  'diff_compare_visuals',
  'adopt_revert_restart',
  'performance_storage',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function idsWithStatus(items, status = 'passed') {
  return new Set((Array.isArray(items) ? items : [])
    .filter((item) => item && item.status === status)
    .map((item) => item.id));
}

function missing(required, observed) {
  return required.filter((id) => !observed.has(id));
}

function evaluateResultStudioQualification(report = {}) {
  const taskIds = idsWithStatus(report.tasks);
  const environmentIds = idsWithStatus(report.environments);
  const evidenceIds = idsWithStatus(report.evidence);
  const missingTasks = missing(REQUIRED_TASKS, taskIds);
  const missingEnvironments = missing(REQUIRED_ENVIRONMENTS, environmentIds);
  const missingEvidence = missing(REQUIRED_EVIDENCE, evidenceIds);
  const providers = new Set((report.providers || [])
    .filter((item) => item && item.status === 'passed')
    .map((item) => item.providerClass));
  const commands = Array.isArray(report.commands) ? report.commands : [];
  const invariants = report.invariants || {};
  const privacyClean = report.privacyClean === true;
  const checks = {
    schema: report.schemaVersion === RESULT_STUDIO_QUALIFICATION_VERSION,
    taskMatrix: missingTasks.length === 0,
    environmentMatrix: missingEnvironments.length === 0,
    evidenceMatrix: missingEvidence.length === 0,
    twoRealProviders: providers.size >= 2,
    commandsPassed: commands.length > 0 && commands.every((item) => item.passed === true),
    singleExecutionTruth: invariants.executionTruth === 'run_tool -> tool_job -> artifact_truth',
    immutableHistory: invariants.sourceDataPreserved === true
      && invariants.artifactHistoryPreserved === true
      && invariants.unrelatedGitWipPreserved === true,
    honestRecovery: invariants.falseSuccessCount === 0
      && invariants.partialAdoptCount === 0
      && invariants.silentLossCount === 0,
    independentScripts: invariants.formalArtifactsWithIndependentScripts === invariants.formalArtifactCount
      && Number(invariants.formalArtifactCount) > 0,
    privacy: privacyClean,
  };
  const passed = Object.values(checks).every(Boolean);
  return Object.freeze({
    passed,
    checks: Object.freeze(checks),
    missingTasks: Object.freeze(missingTasks),
    missingEnvironments: Object.freeze(missingEnvironments),
    missingEvidence: Object.freeze(missingEvidence),
    providerClassCount: providers.size,
    qualificationDigest: sha256(JSON.stringify({ checks, missingTasks, missingEnvironments, missingEvidence })),
  });
}

module.exports = {
  RESULT_STUDIO_QUALIFICATION_VERSION,
  REQUIRED_TASKS,
  REQUIRED_ENVIRONMENTS,
  REQUIRED_EVIDENCE,
  evaluateResultStudioQualification,
};
