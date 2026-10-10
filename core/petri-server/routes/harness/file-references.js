'use strict';

/**
 * routes/harness/file-references.js — file-references 子域（PHASE 2.2a）
 *
 * 下沉的端点（来自 routes/harness.js 第 968-1206 行）：
 *   POST /api/harness/file-references/resolve  （238 行最复杂端点）
 *
 * 共享 helper：
 *   - _helpers/harness-shared: canAccessProject / canAccessJob
 *   - _helpers/chat-file-references: normalizeReference
 *   - _helpers/workspace-file-index: 路径解析 + buildWorkspaceFileNameIndex +
 *     findUniqueWorkspaceFileByName + combinedUniqueCount / combinedAmbiguousCount +
 *     normalizeRelativePath / dangerousPathSegment / isAbsoluteReference
 *   - file-references 内部 helper（selectArtifactResultDirBestEffort /
 *     collectArtifactNamesFromResult / listJobArtifactNames / buildArtifactInfo /
 *     buildWorkspaceInfo / isPathInsideWorkspace / relativeWorkspacePathForAbsolute
 *     / noResolution）
 *
 * 行为 100% 兼容：try/catch 顺序、status code、response shape 保持不变。
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../../db');
const {
  normalizeReference,
  hasUsableArtifactTruth,
} = require('../../helpers/chat-file-references');
const { isRealPathInsideRoot } = require('../../helpers/chat-file-references');
const { jobsDir, parseJsonMaybe, canAccessProject, canAccessJob } = require('../_helpers/harness-shared');
const {
  normalizeRelativePath,
  dangerousPathSegment,
  relativeWorkspacePathForAbsolute,
  buildWorkspaceFileNameIndex,
  findUniqueWorkspaceFileByName,
  combinedUniqueCount,
  combinedAmbiguousCount,
  DEFAULT_MAX_ENTRIES,
} = require('../_helpers/workspace-file-index');

const INTERNAL_FILES = new Set([
  'params.json',
  'run-script.R',
  'run-script.py',
  '_petri-theme.R',
  'report-template.html',
  'manifest.json',
]);

function selectArtifactResultDirBestEffort(job, result) {
  const jobsRoot = jobsDir();
  const candidates = [
    result && result.resultDir,
    result && result.outputDir,
    jobsRoot && job && path.join(jobsRoot, job.id),
  ]
    .filter(Boolean)
    .flatMap((base) => [path.join(base, 'output'), base])
    .map((value) => path.resolve(value));
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) continue;
      const files = fs.readdirSync(candidate, { withFileTypes: true }).filter((entry) => entry.isFile());
      if (files.length === 0) continue;
      return candidate;
    } catch {
      // ignore this candidate; try next
    }
  }
  return '';
}

function listJobArtifactNames(job) {
  if (!job || !job.id) return [];
  const parsed = parseJsonMaybe(job.result_json);
  if (!hasUsableArtifactTruth(parsed)) return [];
  const resultDir = selectArtifactResultDirBestEffort(job, parsed);
  if (!resultDir) return [];
  try {
    return fs
      .readdirSync(resultDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => !INTERNAL_FILES.has(name));
  } catch {
    return [];
  }
}

function buildArtifactInfo(job, name) {
  const info = { name, jobId: job.id, projectId: job.project_id || null };
  const parsed = parseJsonMaybe(job.result_json);
  if (parsed && typeof parsed === 'object') {
    const match = (parsed.artifacts || parsed.outputs || parsed.files || []).find(
      (item) => item && (item.name === name || item.filename === name),
    );
    if (match && typeof match === 'object') {
      if (match.type || match.kind) info.type = String(match.type || match.kind);
      if (match.label || match.title) info.label = String(match.label || match.title);
    }
  }
  info.url = `/api/tools/file/${encodeURIComponent(job.id)}/${encodeURIComponent(name)}`;
  return info;
}

function buildWorkspaceInfo(project, relativePath) {
  return {
    projectId: project.id,
    relativePath,
    name: path.basename(relativePath),
    url: `/api/workspaces/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(relativePath)}`,
  };
}

function isPathInsideWorkspace(workspacePath, relativePath) {
  if (!workspacePath) return false;
  try {
    const realRoot = fs.realpathSync(workspacePath);
    const target = path.resolve(realRoot, relativePath);
    const realTarget = fs.realpathSync(target);
    if (!isRealPathInsideRoot(realRoot, realTarget)) return false;
    return fs.statSync(realTarget).isFile();
  } catch {
    return false;
  }
}

function noResolution(reference, reason) {
  return { reference, resolved: null, reason };
}

function isAbsoluteReference(value) {
  if (!value) return false;
  return path.isAbsolute(value);
}

module.exports = {
  register(app) {
    app.post('/api/harness/file-references/resolve', express.json({ limit: '128kb' }), async (req, res) => {
      try {
        const projectId = String(req.body?.projectId || req.query.projectId || '').trim();
        if (!projectId) {
          return res.status(400).json({ ok: false, error: 'missing_project_id' });
        }
        const project = db.getProject(projectId);
        if (!project) {
          return res.status(404).json({ ok: false, error: 'project_not_found' });
        }
        if (!canAccessProject(req, project)) {
          return res.status(403).json({ ok: false, error: 'forbidden' });
        }
        const activeJobId = req.body?.activeJobId || req.query.activeJobId || null;
        const references = Array.isArray(req.body?.references)
          ? req.body.references
          : Array.isArray(req.body?.refs)
            ? req.body.refs
            : [];
        if (references.length === 0) {
          return res.json({ ok: true, results: [] });
        }

        const projectWorkspacePath = project.workspace_path || null;
        const activeJob = activeJobId ? db.getToolJob(String(activeJobId)) : null;
        if (activeJobId && !activeJob) {
          return res.status(404).json({ ok: false, error: 'active_job_not_found' });
        }
        if (activeJob && !canAccessJob(req, activeJob)) {
          return res.status(403).json({ ok: false, error: 'forbidden' });
        }

        const activeJobArtifactNames = activeJob ? listJobArtifactNames(activeJob) : [];
        const needsWorkspaceNameIndex = references.some((reference) => {
          if (typeof reference !== 'string') return false;
          return normalizeReference(reference)?.kind === 'bare_filename';
        });
        const workspaceFileNameIndexResult = needsWorkspaceNameIndex
          ? buildWorkspaceFileNameIndex(projectWorkspacePath)
          : { byName: new Map(), byNameBackup: new Map(), visited: 0, skipped: 0, maxEntries: DEFAULT_MAX_ENTRIES };
        const workspaceFileNameIndex = workspaceFileNameIndexResult.byName;
        const workspaceFileNameIndexBackup = workspaceFileNameIndexResult.byNameBackup;
        const workspaceIndexStats = needsWorkspaceNameIndex
          ? workspaceFileNameIndexResult
          : null;
        const workspaceBareFilenameNames = new Set(
          references
            .filter((reference) => typeof reference === 'string')
            .map((reference) => {
              const normalized = normalizeReference(reference);
              if (!normalized || normalized.kind !== 'bare_filename') return null;
              return path.basename(normalized.normalized);
            })
            .filter(Boolean)
        );
        const ambiguousWorkspaceNames = new Set();
        if (workspaceIndexStats) {
          for (const name of workspaceBareFilenameNames) {
            const matches = workspaceFileNameIndex.get(name) || [];
            if (matches.length === 0 || matches.length > 1) ambiguousWorkspaceNames.add(name);
          }
          if (workspaceBareFilenameNames.size > 0) {
            console.log(
              `[file-references] project=${projectId} scanned=${workspaceIndexStats.visited} skipped=${workspaceIndexStats.skipped} maxEntries=${workspaceIndexStats.maxEntries} hits=${[...workspaceBareFilenameNames].filter((name) => (workspaceFileNameIndex.get(name) || []).length === 1).length} missingOrAmbiguous=${[...ambiguousWorkspaceNames].join(',')}`,
            );
          }
        }

        const results = [];
        for (const raw of references) {
          if (typeof raw !== 'string') {
            results.push(noResolution(String(raw || ''), 'invalid_reference_type'));
            continue;
          }
          const reference = raw;
          const normalized = normalizeReference(reference);
          if (!normalized) {
            results.push(noResolution(reference, 'dangerous_or_unsupported'));
            continue;
          }

          if (normalized.kind === 'artifact') {
            const parts = normalized.normalized.split('/');
            const tailJobId = parts.shift();
            if (!tailJobId) {
              results.push(noResolution(reference, 'missing_job_id'));
              continue;
            }
            const tailName = parts.join('/');
            const job = db.getToolJob(tailJobId);
            if (!job) {
              results.push(noResolution(reference, 'job_not_found'));
              continue;
            }
            if (!canAccessJob(req, job)) {
              results.push(noResolution(reference, 'forbidden'));
              continue;
            }
            if (job.project_id !== projectId) {
              results.push(noResolution(reference, 'project_mismatch'));
              continue;
            }
            const baseName = path.basename(tailName);
            const artifactNames = listJobArtifactNames(job);
            if (!baseName || !artifactNames.includes(baseName)) {
              results.push(noResolution(reference, 'artifact_missing'));
              continue;
            }
            const resolved = buildArtifactInfo(job, baseName);
            results.push({ reference, resolved: { kind: 'artifact', ...resolved } });
            continue;
          }

          if (normalized.kind === 'artifact_tools_url') {
            const [tailJobId, ...rest] = normalized.normalized.split('/');
            const tailName = rest.join('/');


            const job = tailJobId ? db.getToolJob(tailJobId) : null;

            if (!job) {
              results.push(noResolution(reference, 'job_not_found'));
              continue;
            }
            if (!canAccessJob(req, job)) {
              results.push(noResolution(reference, 'forbidden'));
              continue;
            }
            if (job.project_id !== projectId) {
              results.push(noResolution(reference, 'project_mismatch'));
              continue;
            }
            const baseName = path.basename(tailName);
            const artifactNames = listJobArtifactNames(job);
            if (!baseName || !artifactNames.includes(baseName)) {
              results.push(noResolution(reference, 'artifact_missing'));
              continue;
            }
            const resolved = buildArtifactInfo(job, baseName);
            results.push({ reference, resolved: { kind: 'artifact', ...resolved } });
            continue;
          }

          if (normalized.kind === 'workspace') {
            const [tailProject, ...rest] = normalized.normalized.split('/');
            if (tailProject !== projectId) {
              results.push(noResolution(reference, 'project_mismatch'));
              continue;
            }
            const relative = rest.join('/');
            if (!projectWorkspacePath || !relative || !isPathInsideWorkspace(projectWorkspacePath, relative)) {
              results.push(noResolution(reference, 'workspace_out_of_root'));
              continue;
            }
            if (dangerousPathSegment(relative)) {
              results.push(noResolution(reference, 'forbidden_path_segment'));
              continue;
            }
            results.push({ reference, resolved: { kind: 'workspace', ...buildWorkspaceInfo(project, relative) } });
            continue;
          }

          if (normalized.kind === 'absolute_path') {
            const relative = relativeWorkspacePathForAbsolute(projectWorkspacePath, normalized.normalized);
            if (!relative) {
              results.push(noResolution(reference, 'absolute_path_out_of_workspace'));
              continue;
            }
            results.push({ reference, resolved: { kind: 'workspace', ...buildWorkspaceInfo(project, relative) } });
            continue;
          }

          if (normalized.kind === 'project_relative_path') {
            if (isAbsoluteReference(reference)) {
              results.push(noResolution(reference, 'absolute_path_not_supported'));
              continue;
            }
            const relative = normalizeRelativePath(normalized.normalized);
            if (!relative) {
              results.push(noResolution(reference, 'empty_path'));
              continue;
            }
            if (!projectWorkspacePath || !isPathInsideWorkspace(projectWorkspacePath, relative)) {
              results.push(noResolution(reference, 'workspace_out_of_root'));
              continue;
            }
            if (dangerousPathSegment(relative)) {
              results.push(noResolution(reference, 'forbidden_path_segment'));
              continue;
            }
            results.push({ reference, resolved: { kind: 'workspace', ...buildWorkspaceInfo(project, relative) } });
            continue;
          }

          if (normalized.kind === 'bare_filename') {
            const baseName = path.basename(normalized.normalized);
            if (
              activeJob &&
              activeJob.project_id === projectId &&
              baseName &&
              activeJobArtifactNames.includes(baseName)
            ) {
              const resolved = buildArtifactInfo(activeJob, baseName);
              results.push({ reference, resolved: { kind: 'artifact', ...resolved } });
              continue;
            }
            const workspaceMatch = findUniqueWorkspaceFileByName(workspaceFileNameIndex, workspaceFileNameIndexBackup, baseName);
            if (workspaceMatch) {
              results.push({
                reference,
                resolved: { kind: 'workspace', ...buildWorkspaceInfo(project, workspaceMatch) },
              });
              continue;
            }
            results.push(noResolution(reference, activeJob ? 'file_not_found_or_ambiguous' : 'workspace_file_not_found_or_ambiguous'));
            continue;
          }

          results.push(noResolution(reference, 'unsupported_reference_kind'));
        }

        return res.json({
          ok: true,
          results,
          ...(workspaceIndexStats
            ? {
                workspaceIndex: {
                  scanned: workspaceIndexStats.visited,
                  skipped: workspaceIndexStats.skipped,
                  overCapDirs: workspaceIndexStats.overCapDirs || 0,
                  uniqueNames: combinedUniqueCount(workspaceFileNameIndex, workspaceFileNameIndexBackup),
                  ambiguousNames: combinedAmbiguousCount(workspaceFileNameIndex, workspaceFileNameIndexBackup),
                  maxEntries: workspaceIndexStats.maxEntries,
                  workspacePath: projectWorkspacePath || null,
                },
              }
            : {}),
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });
  },
};
