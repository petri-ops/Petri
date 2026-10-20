'use strict';

/**
 * BLOCK-216 Q5 — 领域包工作面贡献投影（只读）。
 *
 * 包作者在 pack.json `provides` 里声明 views / resultSurfaces / uiActions；
 * 核心只把**已安装且启用**的包投影成 host 可消费的描述符。这里不维护第二套
 * 安装注册表（安装记录仍归 pack-registry），也不执行包内代码。
 *
 * 安全边界：
 * - entry 必须是 packRoot 内真实存在的相对文件；绝对路径/`..`/盘符/协议/符号
 *   链接逃逸一律丢弃（diagnostic 回传，不 500）。
 * - 数量/字符串长度有上限；未知字段忽略；非法条目只丢该条。
 * - pack 停用/卸载 → 投影中消失，根级读取失败返回空 + diagnostic。
 */

const fs = require('node:fs');
const path = require('node:path');
const packRegistry = require('../../shared-backend/pack-registry');
const { resolveDataDir } = require('../../shared-backend/data-paths');
const {
  resolvePackAssetPath,
  mimeForPackAsset,
} = require('../../packages/shared-pack-assets');

const LIMITS = Object.freeze({
  views: 50,
  resultSurfaces: 50,
  uiActions: 200,
  idLength: 64,
  titleLength: 120,
  entryLength: 300,
  artifactTypes: 32,
  emptyStateLength: 500,
});

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function diagnostic(packId, contribution, code, detail) {
  return { packId, contribution, code, ...(detail ? { detail: String(detail).slice(0, 200) } : {}) };
}

function asSmallString(value, limit) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : '';
}

function normalizeId(value) {
  const id = asSmallString(value, LIMITS.idLength);
  return id && ID_PATTERN.test(id) ? id : '';
}

function readPackManifest(packRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(packRoot, 'pack.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeViews(packId, packRoot, provides, diagnostics) {
  const raw = Array.isArray(provides.views) ? provides.views.slice(0, LIMITS.views) : [];
  if (provides.views !== undefined && !Array.isArray(provides.views)) {
    diagnostics.push(diagnostic(packId, 'views', 'invalid_shape'));
    return [];
  }
  const views = [];
  const seen = new Set();
  for (const item of raw) {
    const id = normalizeId(item && item.id);
    const title = asSmallString(item && item.title, LIMITS.titleLength);
    const entry = asSmallString(item && item.entry, LIMITS.entryLength);
    if (!id || !title || !entry) {
      diagnostics.push(diagnostic(packId, 'views', 'missing_id_title_or_entry'));
      continue;
    }
    if (seen.has(id)) {
      diagnostics.push(diagnostic(packId, `views/${id}`, 'duplicate_id'));
      continue;
    }
    if (!resolvePackAssetPath(packRoot, entry)) {
      diagnostics.push(diagnostic(packId, `views/${id}`, 'entry_missing_or_unsafe', entry));
      continue;
    }
    seen.add(id);
    views.push({
      id,
      title,
      entry: entry.replace(/\\/g, '/'),
      singleton: item.singleton !== false,
      order: Number.isFinite(item.order) ? item.order : 1000,
      ...(typeof item.emptyState === 'string'
        ? { emptyState: item.emptyState.slice(0, LIMITS.emptyStateLength) }
        : {}),
    });
  }
  return views;
}

function normalizeResultSurfaces(packId, packRoot, provides, diagnostics) {
  const raw = Array.isArray(provides.resultSurfaces) ? provides.resultSurfaces.slice(0, LIMITS.resultSurfaces) : [];
  if (provides.resultSurfaces !== undefined && !Array.isArray(provides.resultSurfaces)) {
    diagnostics.push(diagnostic(packId, 'resultSurfaces', 'invalid_shape'));
    return [];
  }
  const surfaces = [];
  const seen = new Set();
  for (const item of raw) {
    const id = normalizeId(item && item.id);
    const artifactTypes = Array.isArray(item && item.artifactTypes)
      ? item.artifactTypes
        .slice(0, LIMITS.artifactTypes)
        .filter((kind) => typeof kind === 'string' && kind.trim())
        .map((kind) => kind.trim().slice(0, 64))
      : [];
    if (!id || artifactTypes.length === 0) {
      diagnostics.push(diagnostic(packId, 'resultSurfaces', 'missing_id_or_artifact_types'));
      continue;
    }
    if (seen.has(id)) {
      diagnostics.push(diagnostic(packId, `resultSurfaces/${id}`, 'duplicate_id'));
      continue;
    }
    if (item.entry !== undefined) {
      if (typeof item.entry !== 'string' || !resolvePackAssetPath(packRoot, item.entry)) {
        diagnostics.push(diagnostic(packId, `resultSurfaces/${id}`, 'entry_missing_or_unsafe'));
        continue;
      }
    }
    seen.add(id);
    surfaces.push({
      id,
      title: asSmallString(item.title, LIMITS.titleLength) || id,
      ...(typeof item.entry === 'string' ? { entry: item.entry.replace(/\\/g, '/') } : {}),
      artifactTypes,
      priority: Number.isFinite(item.priority) ? item.priority : 0,
      ...(typeof item.emptyState === 'string'
        ? { emptyState: item.emptyState.slice(0, LIMITS.emptyStateLength) }
        : {}),
    });
  }
  return surfaces;
}

function normalizeUiActions(packId, provides, diagnostics) {
  const raw = Array.isArray(provides.uiActions) ? provides.uiActions.slice(0, LIMITS.uiActions) : [];
  if (provides.uiActions !== undefined && !Array.isArray(provides.uiActions)) {
    diagnostics.push(diagnostic(packId, 'uiActions', 'invalid_shape'));
    return [];
  }
  const actions = [];
  const seen = new Set();
  for (const item of raw) {
    const id = normalizeId(item && item.id);
    const label = asSmallString(item && item.label, LIMITS.titleLength);
    if (!id || !label) {
      diagnostics.push(diagnostic(packId, 'uiActions', 'missing_id_or_label'));
      continue;
    }
    if (seen.has(id)) {
      diagnostics.push(diagnostic(packId, `uiActions/${id}`, 'duplicate_id'));
      continue;
    }
    seen.add(id);
    actions.push({
      id,
      label,
      ...(typeof item.surfaceId === 'string' && normalizeId(item.surfaceId)
        ? { surfaceId: normalizeId(item.surfaceId) }
        : {}),
    });
  }
  return actions;
}

/**
 * 读取当前安装记录并投影工作面贡献。
 * 根级失败（安装记录不可读等）返回空 packs + diagnostic，不抛错阻断前端。
 */
function loadPackContributions(options = {}) {
  const dataDir = options.dataDir || resolveDataDir();
  const diagnostics = [];
  let installed = [];
  try {
    installed = packRegistry.readInstalledPacks(dataDir);
  } catch (error) {
    return {
      packs: [],
      diagnostics: [diagnostic('unknown', 'packs', 'installed_read_failed', error.message)],
    };
  }

  const packs = [];
  for (const record of installed) {
    if (!record || record.enabled === false) continue;
    const packId = normalizeId(record.packId);
    if (!packId || !record.packRoot) continue;
    const manifest = readPackManifest(record.packRoot);
    if (!manifest) {
      diagnostics.push(diagnostic(packId, 'pack.json', 'manifest_unreadable'));
      continue;
    }
    const provides = manifest.provides;
    if (!provides || typeof provides !== 'object' || Array.isArray(provides)) {
      continue;
    }
    const views = normalizeViews(packId, record.packRoot, provides, diagnostics);
    const resultSurfaces = normalizeResultSurfaces(packId, record.packRoot, provides, diagnostics);
    const uiActions = normalizeUiActions(packId, provides, diagnostics);
    if (views.length === 0 && resultSurfaces.length === 0 && uiActions.length === 0) continue;
    packs.push({
      packId,
      name: asSmallString(manifest.name, LIMITS.titleLength) || packId,
      version: asSmallString(manifest.version, 32) || record.version || '0.0.0',
      views,
      resultSurfaces,
      uiActions,
    });
  }
  return { packs, diagnostics };
}

module.exports = {
  LIMITS,
  loadPackContributions,
  resolvePackAssetPath,
  mimeForPackAsset,
};
