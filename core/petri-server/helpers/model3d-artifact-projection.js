'use strict';

/**
 * model3d 产物记录投影（UI-638 点开腿）。
 *
 * model3d 导出把产物写在项目工作区 model3d/runs/<runId>/ 下，不在 tool run
 * output 布局内；若只投影 name/path，前端回落 /api/tools/file/<job>/<name>
 * 必然 404。这里给出工作区读面 URL（/api/workspaces/:projectId/file?path=），
 * 并对绝对路径 / 盘符 / 越界段 fail-closed——不给 url 即回落到旧行为。
 */

const path = require('node:path');

function normalizeRelativePath(value) {
  const raw = String(value == null ? '' : value).trim().replace(/\\/g, '/');
  if (!raw) return null;
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return null;
  if (raw.split('/').some((segment) => segment === '..')) return null;
  return raw;
}

function buildWorkspaceArtifactUrl(projectId, relativePath) {
  const pid = String(projectId == null ? '' : projectId).trim();
  const rel = normalizeRelativePath(relativePath);
  if (!pid || !rel) return null;
  return `/api/workspaces/${encodeURIComponent(pid)}/file?path=${encodeURIComponent(rel)}`;
}

function buildModel3dArtifactRecords(projectId, outputs) {
  const list = Array.isArray(outputs) ? outputs : [];
  return list.map((output) => {
    const outputPath = output && typeof output.path === 'string' ? output.path : '';
    const name = path.basename(outputPath.replace(/\\/g, '/')) || '';
    const url = buildWorkspaceArtifactUrl(projectId, outputPath);
    const record = {
      name,
      filename: name,
      path: outputPath,
      sha256: (output && output.sha256) || null,
    };
    if (url) record.url = url;
    return record;
  });
}

module.exports = {
  buildModel3dArtifactRecords,
  buildWorkspaceArtifactUrl,
  normalizeRelativePath,
};
