/**
 * BioF3 biof3-server — chat file reference helpers (pure).
 *
 * These helpers classify and normalize references that come from model output,
 * link extraction, or the frontend fetcher payload. They intentionally do NOT
 * touch `fs`/DB/network.
 */

const path = require('path');

const INTERNAL_URI_RE = /^biof3:\/\/(artifact|workspace)\/(.+)$/i;
const TOOLS_FILE_URL_RE = /^\/api\/(?:[^/]+\/)?tools\/file\/([A-Za-z0-9._-]+)\/(.+)$/i;

const DANGEROUS_PROTOCOLS = new Set(['javascript', 'data', 'vbscript', 'file', 'ftp']);

/**
 * Classify a reference string into one of the accepted shorthands.
 *
 * Returns `{kind, normalized}` or `null` when the reference is dangerous,
 * malformed, or uses an unsupported protocol. Absolute local paths are also
 * rejected because the chat renderer should never surface them.
 */
function classifyReference(reference) {
  const value = String(reference || '').trim();
  if (!value) return null;

  const normalized = normalizeWhitespace(value);
  // Reject genuinely unsafe characters. Backslashes are rejected here on
  // purpose: the chat resolver must never surface raw absolute local paths
  // (e.g. `C:\Users\...\file.csv`), which are contained only via the
  // route-level absolute_path gate on POSIX. See classifyReference contract.
  if (/[<>"|\\\x00-\x1F\x7F]/.test(normalized)) {
    return null;
  }

  const internalMatch = normalized.match(INTERNAL_URI_RE);
  if (internalMatch) {
    const kind = internalMatch[1].toLowerCase() === 'artifact' ? 'artifact' : 'workspace';
    const decoded = decodePathSegments(internalMatch[2]);
    return decoded == null ? null : { kind, normalized: decoded };
  }

  const urlMatch = normalized.match(TOOLS_FILE_URL_RE);
  if (urlMatch) {
    const decoded = decodePathSegments(urlMatch[2]);
    if (decoded == null) return null;
    return {
      kind: 'artifact_tools_url',
      jobId: urlMatch[1],
      normalized: `${urlMatch[1]}/${decoded}`,
    };
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(normalized)) {
    if (DANGEROUS_PROTOCOLS.has(normalized.split(':')[0].toLowerCase())) {
      return null;
    }
    return null;
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) {
    return null;
  }

  if (path.isAbsolute(normalized) || /^[A-Za-z]:[\\/]/.test(normalized)) {
    return { kind: 'absolute_path', normalized };
  }

  const trimmedLeading = normalized.replace(/^\.\/+/, '');
  const cleaned = trimmedLeading.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  const hasPathChars = /[/\\]/.test(cleaned);
  const looksLikeFile = /\.[A-Za-z0-9]+$/.test(cleaned);
  if (looksLikeFile && !hasPathChars) {
    return { kind: 'bare_filename', normalized: cleaned };
  }

  if (hasPathChars || /^\.{1,2}\//.test(normalized)) {
    return { kind: 'project_relative_path', normalized: cleaned };
  }

  return null;
}

/**
 * Normalize a classified reference into a normal form the route can resolve.
 *
 * Contract:
 * - internal URIs: decoded tail.
 * - tools file URLs: converted to `jobId/filename`.
 * - project relative-absolute paths: returned trimmed with forward slashes.
 * - bare filenames: returned as-is (caller must restrict to activeJobId).
 * - dangerous/unsupported references: return `null`.
 */
function normalizeReference(reference) {
  const classification = classifyReference(reference);
  if (!classification) return null;

  if (
    classification.kind === 'artifact' ||
    classification.kind === 'workspace' ||
    classification.kind === 'artifact_tools_url' ||
    classification.kind === 'project_relative_path' ||
    classification.kind === 'absolute_path' ||
    classification.kind === 'bare_filename'
  ) {
    return {
      reference,
      kind: classification.kind,
      normalized: classification.normalized,
      ...(classification.jobId ? { jobId: classification.jobId } : {}),
    };
  }

  return null;
}

/**
 * Return a Markdown-safe internal URI for a resolved artifact or workspace file.
 * Caller should not expose file:// or absolute local paths.
 */
function toInternalUri(resolved) {
  if (!resolved || !resolved.kind) return null;
  if (resolved.kind === 'artifact') {
    const jobId = encodeURIComponent(String(resolved.jobId || '').trim());
    const artifactName = String(resolved.artifactName || resolved.name || '')
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    return `biof3://artifact/${jobId}/${artifactName}`;
  }
  if (resolved.kind === 'workspace') {
    const projectId = encodeURIComponent(String(resolved.projectId || '').trim());
    const relativePath = String(resolved.relativePath || '')
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    return `biof3://workspace/${projectId}/${relativePath}`;
  }
  return null;
}

function decodePathSegments(value) {
  try {
    return String(value || '')
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
}

function hasUsableArtifactTruth(result) {
  const truth = result && typeof result === 'object' ? result.artifactTruth : null;
  if (!truth || truth.blocking === true) return false;
  return truth.status === 'valid' || truth.status === 'degraded';
}

function isRealPathInsideRoot(rootPath, targetPath) {
  if (!rootPath || !targetPath) return false;
  let root = path.resolve(rootPath);
  let target = path.resolve(targetPath);
  // Windows filesystems are case-insensitive but path.resolve / realpathSync
  // can return drive-letter or directory casing that differs from the path the
  // caller created (e.g. os.tmpdir vs the on-disk entry) — compare insensitively.
  if (process.platform === 'win32') {
    root = root.toLowerCase();
    target = target.toLowerCase();
  }
  if (target === root) return false;
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return target.startsWith(rootWithSep);
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/[\t\r\n ]+/g, ' ')
    .trim();
}

module.exports = {
  classifyReference,
  normalizeReference,
  toInternalUri,
  hasUsableArtifactTruth,
  isRealPathInsideRoot,
};
