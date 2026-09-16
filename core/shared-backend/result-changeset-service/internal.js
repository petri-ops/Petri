'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stableStringify } = require('../canonical-json');
const { isPathContained } = require('../project-run-layout');
const { ResultStudioPrivatePathError } = require('../result-studio-private-path');

const RESULT_CHANGESET_SERVICE_VERSION = 1;
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_PARAMETERS_BYTES = 1024 * 1024;
const ZERO_OID = '0'.repeat(40);
const DEFAULT_PREVIEW_BASE_MEMORY_BYTES = 256 * 1024 * 1024;
const DEFAULT_PREVIEW_INPUT_MEMORY_MULTIPLIER = 4;
const DEFAULT_PREVIEW_OUTPUT_DISK_MULTIPLIER = 2;
const PREVIEW_METADATA_RESERVE_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCE_MODEL_MULTIPLIER = 64;
const SENSITIVE_PARAMETER = /(?:^|_)(?:api_?key|access_?token|secret|password|credential)(?:$|_)/i;

class ResultChangeSetError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ResultChangeSetError';
    this.code = code;
    this.detail = detail;
  }
}

function resultChangeSetPrivatePathError(error) {
  if (!(error instanceof ResultStudioPrivatePathError)) return error;
  return new ResultChangeSetError(error.code, error.message, error.detail);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFile(filePath) {
  return fs.existsSync(filePath) ? sha256(fs.readFileSync(filePath)) : null;
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function deterministicId(prefix, ...parts) {
  return `${prefix}_${sha256(parts.map((part) => String(part || '')).join('\0')).slice(0, 32)}`;
}

function safeSegment(value, field) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new ResultChangeSetError(`${field}_invalid`, `${field} must be a safe identifier.`);
  }
  return normalized;
}

function resourceNumber(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function boundedResourceProduct(...values) {
  let product = 1;
  for (const value of values) {
    product *= value;
    if (!Number.isFinite(product) || product > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  }
  return Math.ceil(product);
}

function trustedFileSize(workspaceRoot, candidate, code) {
  try {
    const root = fs.realpathSync(workspaceRoot);
    const target = fs.realpathSync(candidate);
    const stat = fs.statSync(target);
    if (!isPathContained(root, target) || !stat.isFile()) throw new Error('outside');
    return stat.size;
  } catch {
    throw new ResultChangeSetError(code, 'A trusted resource-estimation file is missing or escapes the project.');
  }
}

function stableJson(value) {
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`;
}

function gitFailureDiagnostic(error) {
  if (!error || error.name !== 'GitAdapterError' || !error.detail || typeof error.detail !== 'object') {
    return null;
  }
  const detail = error.detail;
  return {
    operation: typeof error.code === 'string' ? error.code : 'git_command_failed',
    command: typeof detail.command === 'string' ? detail.command : null,
    status: Number.isInteger(detail.status) ? detail.status : null,
    systemCode: typeof detail.systemCode === 'string' ? detail.systemCode : null,
    signal: typeof detail.signal === 'string' ? detail.signal : null,
    killed: detail.killed === true,
    attempts: Number.isInteger(detail.attempts) ? detail.attempts : 1,
    stderr: typeof detail.stderr === 'string' ? detail.stderr.slice(0, 2000) : '',
  };
}

function exactArtifact(result, artifactId) {
  const matches = (Array.isArray(result && result.artifacts) ? result.artifacts : [])
    .filter((artifact) => artifact && artifact.id === artifactId);
  return matches.length === 1 ? matches[0] : null;
}

function projectRelativeOutput(workspaceRoot, artifact) {
  const physical = artifact && artifact.path;
  if (!physical || !path.isAbsolute(physical)) {
    throw new ResultChangeSetError('candidate_output_outside_project', 'Candidate artifact output is not inside the project workspace.');
  }
  let realWorkspace;
  let realPhysical;
  try {
    realWorkspace = fs.realpathSync(workspaceRoot);
    realPhysical = fs.realpathSync(physical);
  } catch {
    throw new ResultChangeSetError('candidate_output_missing', 'Candidate artifact output is missing.');
  }
  if (!isPathContained(realWorkspace, realPhysical)) {
    throw new ResultChangeSetError('candidate_output_outside_project', 'Candidate artifact output is not inside the project workspace.');
  }
  return path.relative(realWorkspace, realPhysical).split(path.sep).join('/');
}

function resolveExistingProjectFile(workspaceRoot, relativePath, code) {
  try {
    const realWorkspace = fs.realpathSync(workspaceRoot);
    const realFile = fs.realpathSync(path.join(realWorkspace, relativePath));
    if (!isPathContained(realWorkspace, realFile)) throw new Error('outside');
    return realFile;
  } catch {
    throw new ResultChangeSetError(code, 'Referenced project file is missing or escapes the workspace.');
  }
}

function resultOf(job) {
  if (!job) return {};
  if (job.result && typeof job.result === 'object') return job.result;
  try { return JSON.parse(job.result_json || '{}'); } catch { return {}; }
}

function cloneJsonObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResultChangeSetError(code, 'Persisted execution parameters must be an object.');
  }
  try { return JSON.parse(JSON.stringify(value)); } catch {
    throw new ResultChangeSetError(code, 'Persisted execution parameters are not safely serializable.');
  }
}

module.exports = {
  RESULT_CHANGESET_SERVICE_VERSION,
  MAX_SCRIPT_BYTES,
  MAX_PARAMETERS_BYTES,
  ZERO_OID,
  SENSITIVE_PARAMETER,
  ResultChangeSetError,
  resultChangeSetPrivatePathError,
  sha256,
  hashFile,
  id,
  deterministicId,
  safeSegment,
  resourceNumber,
  boundedResourceProduct,
  trustedFileSize,
  stableJson,
  gitFailureDiagnostic,
  exactArtifact,
  projectRelativeOutput,
  resolveExistingProjectFile,
  resultOf,
  cloneJsonObject,
};
