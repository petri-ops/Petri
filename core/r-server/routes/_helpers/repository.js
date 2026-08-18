'use strict';

/**
 * routes/_helpers/repository.js — DB 操作聚合共享 helper
 *
 * 抽自 `core/r-server/routes/result-studio.js` PHASE 2.1a 拆分 commit。
 * 跨 result-studio / harness / ai-agent 三大文件复用预期。
 * 当前 commit 仅 result-studio 引入；harness / ai-agent 在 PHASE 2.2 / 2.3 切换。
 *
 * 类别：DB / repository 操作（与 io/fs/file 无关）
 *   - loadJobAndProject(req, jobId)             → 工具 job + project + 鉴权
 *   - findArtifactRecord(result, path, name)    → artifact truth 查找
 *   - verifyArtifactRecordBytes(record, path)  → artifact bytes 校对
 *   - parseToolJobResult(job)                  → job.result JSON 解析
 *   - persistedToolJobConversation(job)        → job.conversation_id 抽取
 */

const fs = require('fs');
const db = require('../../db');

function persistedToolJobConversation(job) {
  if (!job) return null;
  const value = job.conversation_id ?? job.conversationId ?? null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseToolJobResult(job) {
  if (job?.result && typeof job.result === 'object') return job.result;
  try { return JSON.parse(job?.result_json || '{}'); } catch { return {}; }
}

function loadJobAndProject(req, jobId, deps = {}) {
  const validate = deps.canAccessProject || require('./validate').canAccessProject;
  const sqlite = db.db;
  const job = db.getToolJob(jobId);
  if (!job) return { error: { status: 404, code: 'job_not_found' } };
  const project = job.project_id
    ? sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(job.project_id)
    : null;
  if (!project) return { error: { status: 404, code: 'project_not_found' } };
  if (!validate(req, project)) return { error: { status: 403, code: 'forbidden' } };
  return { job, project };
}

function artifactTruthError(reason, message, code = 'artifact_truth_unavailable') {
  return { error: { status: 409, code, reason, message } };
}

function artifactTruthAvailability(result) {
  const truth = result?.artifactTruth;
  if (!truth || truth.blocking === true || !['valid', 'degraded'].includes(truth.status)) {
    return artifactTruthError(
      'job_artifact_truth_unavailable',
      'The completed Job does not have usable Artifact Truth.',
    );
  }
  return null;
}

function verifyArtifactRecordBytes(artifactRecord, absolutePath, deps = {}) {
  const expectedSha256 = String(artifactRecord?.sha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return artifactTruthError(
      'artifact_sha256_unavailable',
      'The selected Artifact has no trusted SHA-256 in Job Artifact Truth.',
    );
  }
  const hashFile = deps.hashFile || require('./storage').hashFile;
  let actualSha256;
  try {
    actualSha256 = hashFile(absolutePath);
  } catch {
    return artifactTruthError(
      'artifact_file_unavailable',
      'The selected Artifact file is unavailable.',
    );
  }
  if (actualSha256 !== expectedSha256) {
    return artifactTruthError(
      'artifact_hash_drift',
      'The selected Artifact bytes no longer match Job Artifact Truth.',
      'artifact_truth_drift',
    );
  }
  return { artifactRecord, expectedSha256, actualSha256 };
}

function findArtifactRecord(result, absolutePath, artifactName, deps = {}) {
  const unavailable = artifactTruthAvailability(result);
  if (unavailable) return unavailable;
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  let realTarget;
  try {
    realTarget = fs.realpathSync(absolutePath);
    if (!fs.statSync(realTarget).isFile()) throw new Error('artifact_not_file');
  } catch {
    return artifactTruthError(
      'artifact_file_unavailable',
      'The selected Artifact file is unavailable.',
    );
  }
  const matches = artifacts.filter((artifact) => {
    if (!artifact || !artifact.id) return false;
    if (artifact.id === artifactName || artifact.name === artifactName || artifact.filename === artifactName) return true;
    if (!artifact.path) return false;
    try { return fs.realpathSync(artifact.path) === realTarget; } catch { return false; }
  });
  if (matches.length === 0) {
    return artifactTruthError(
      'artifact_record_missing',
      'The selected file is not present in Job Artifact Truth.',
    );
  }
  if (matches.length > 1) {
    return artifactTruthError(
      'artifact_identity_ambiguous',
      'The selected file does not resolve to one unique Artifact Truth record.',
    );
  }
  return verifyArtifactRecordBytes(matches[0], realTarget, deps);
}

module.exports = {
  loadJobAndProject,
  findArtifactRecord,
  verifyArtifactRecordBytes,
  parseToolJobResult,
  persistedToolJobConversation,
  artifactTruthError,
  artifactTruthAvailability,
};
