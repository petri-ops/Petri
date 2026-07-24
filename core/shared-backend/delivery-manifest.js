'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stableStringify } = require('./scientific-task-spec');
const { buildTruthProjection } = require('./g0-truth-projection');

const DELIVERY_MANIFEST_VERSION = 1;
const DELIVERY_STATUSES = Object.freeze(['valid', 'degraded', 'blocked']);

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function relativeInside(root, target) {
  if (!root || !target) return null;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) return null;
  return path.relative(resolvedRoot, resolvedTarget).split(path.sep).join('/');
}

function artifactReproducibility(artifact, provenance) {
  const link = artifact.provenance || {};
  const script = provenance?.script || {};
  if (!provenance || !link.provenanceHash) return { status: 'unavailable', reason: 'artifact_provenance_missing' };
  if (!script.snapshotPath || !script.sha256) return { status: 'unavailable', reason: 'script_snapshot_missing' };
  if (link.replayVerified === true) return { status: 'verified', scriptPath: script.snapshotPath, scriptSha256: script.sha256, reproductionTarget: link.reproductionTarget || artifact.id || artifact.filename };
  return { status: 'available', scriptPath: script.snapshotPath, scriptSha256: script.sha256, reproductionTarget: link.reproductionTarget || artifact.id || artifact.filename, replayRequiresConfirmation: true };
}

function requirementCoverage(requested = [], artifacts = []) {
  return requested.map((requirement) => {
    const token = String(requirement).toLowerCase();
    const matches = artifacts.filter((artifact) => [artifact.id, artifact.type, artifact.filename, artifact.name].filter(Boolean).some((value) => String(value).toLowerCase().includes(token) || token.includes(String(value).toLowerCase())));
    return { requirement, status: matches.length ? 'satisfied' : 'unresolved', artifactIds: matches.map((item) => item.id || item.filename || item.name) };
  });
}

function createDeliveryManifest({ taskRecord, job, projectRoot = null, findings = {} } = {}) {
  if (!taskRecord?.spec || !job) throw new Error('delivery_task_and_job_required');
  const result = parseJson(job.result_json || job.result, {});
  const truth = result.artifactTruth || null;
  const scientificValidation = result.scientificValidation || null;
  const provenance = result.executionProvenance || null;
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const normalizedArtifacts = artifacts.map((artifact) => ({
    id: artifact.id || null,
    type: artifact.type || 'file',
    label: artifact.label || artifact.title || artifact.filename || artifact.name,
    relativePath: relativeInside(projectRoot, artifact.path) || artifact.canonicalPath || null,
    sizeBytes: artifact.size ?? null,
    sha256: provenance?.artifacts?.find((item) => (item.id && item.id === artifact.id) || item.filename === (artifact.filename || artifact.name))?.sha256 || null,
    reproducibility: artifactReproducibility(artifact, provenance),
  }));
  const coverage = requirementCoverage(taskRecord.spec.requestedDeliverables || [], normalizedArtifacts);
  const unresolved = coverage.filter((item) => item.status !== 'satisfied');
  const unavailable = normalizedArtifacts.filter((item) => item.reproducibility.status === 'unavailable');
  let status = 'valid';
  if (
    job.status !== 'completed'
    || !truth
    || truth.status === 'blocked'
    || truth.blocking === true
    || scientificValidation?.blocking === true
    || scientificValidation?.truthStatus === 'blocked'
    || normalizedArtifacts.length === 0
  ) status = 'blocked';
  else if (
    truth.status === 'degraded'
    || ['degraded', 'needs_review'].includes(scientificValidation?.truthStatus || scientificValidation?.status)
    || unavailable.length
    || unresolved.length
  ) status = 'degraded';
  const manifest = {
    deliveryManifestVersion: DELIVERY_MANIFEST_VERSION,
    status,
    task: { taskId: taskRecord.task_id, version: taskRecord.version, taskSpecHash: taskRecord.spec_hash, projectId: taskRecord.project_id, conversationId: taskRecord.conversation_id },
    job: { toolJobId: job.id, toolId: job.tool_id, status: job.status, createdAt: job.created_at || null, completedAt: job.completed_at || null },
    method: taskRecord.spec.method,
    lockedInputs: (taskRecord.spec.inputs || []).map((input) => ({ role: input.role, relativePath: input.relativePath, sha256: input.sha256, sizeBytes: input.sizeBytes })),
    artifactTruth: truth,
    scientificValidation,
    artifactDiagnostics: result.artifactDiagnostics || [],
    artifacts: normalizedArtifacts,
    requirementCoverage: coverage,
    findings: {
      statisticalFacts: Array.isArray(findings.statisticalFacts) ? findings.statisticalFacts : [],
      scientificInterpretations: Array.isArray(findings.scientificInterpretations) ? findings.scientificInterpretations : [],
      trends: Array.isArray(findings.trends) ? findings.trends : [],
      limitations: Array.isArray(findings.limitations) ? findings.limitations : [],
    },
    summary: {
      conclusion: status === 'blocked'
        ? '结果未通过科学或交付校验，不能作为完成结果交付。'
        : status === 'degraded'
          ? '已有可审阅结果，但存在科学限制、缺失项或需要复核。'
          : scientificValidation?.outcome === 'not_significant'
            ? '分析有效完成；在声明的阈值下没有获得支持目标效应的证据。'
            : '结果、科学校验、产物和复现证据均通过交付校验。',
      whatWasDone: `${job.tool_id || '分析工具'} 产生 ${normalizedArtifacts.length} 个已登记产物。`,
      cautions: [
        ...(scientificValidation?.findings || []).map((item) => `科学校验：${item.code}`),
        ...unresolved.map((item) => `未满足交付项：${item.requirement}`),
        ...unavailable.map((item) => `${item.label} 缺少复现入口`),
      ],
    },
    unresolved: [...unresolved.map((item) => ({ code: 'deliverable_unresolved', requirement: item.requirement })), ...(status === 'blocked' ? [{ code: 'delivery_blocked', reason: job.error || truth?.status || 'artifact_validation_failed' }] : [])],
    generatedAt: new Date().toISOString(),
  };
  const manifestHash = crypto.createHash('sha256').update(stableStringify(manifest)).digest('hex');
  const withHash = { ...manifest, manifestHash };
  return {
    ...withHash,
    truthProjection: buildTruthProjection({
      job,
      deliveryManifest: withHash,
      scientificValidation,
    }),
  };
}

function writeDeliveryManifest({ manifest, outputPath, projectRoot } = {}) {
  if (!manifest || !DELIVERY_STATUSES.includes(manifest.status)) throw new Error('delivery_manifest_invalid');
  const relative = relativeInside(projectRoot, outputPath);
  if (relative == null) throw new Error('delivery_manifest_path_outside_project');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
  return { outputPath: path.resolve(outputPath), relativePath: relative };
}

module.exports = { DELIVERY_MANIFEST_VERSION, DELIVERY_STATUSES, relativeInside, artifactReproducibility, requirementCoverage, createDeliveryManifest, writeDeliveryManifest };
