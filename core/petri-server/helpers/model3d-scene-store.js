'use strict';

/**
 * helpers/model3d-scene-store.js — NEXT-05 SceneSpec 编辑、修订与语义 diff。
 *
 * SceneSpec 文件仍是源真相；本模块只提供：
 *   - 白名单 operations 应用（复用 scene3d.applySceneOperations）
 *   - 写入前的本地修订快照（可列出/恢复，恢复本身也产生新修订）
 *   - 语义 diff（参数/节点/约束），不写任何第二份“真理”。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const scene3d = require('./scene3d');
const { resolveWorkspaceTarget } = require('../agent-tools/workspace-tools/internals');

const HISTORY_SCHEMA = 'model3d-scene-history/v1';
const MAX_REVISIONS = 50;
const MAX_REASON_CHARS = 120;

function normalizeRelativePath(relativePath) {
  const text = String(relativePath || '').trim().replace(/\\/g, '/');
  if (!text.toLowerCase().endsWith('.scene3d.json')) return null;
  return text;
}

function historyDirFor(target) {
  const dir = path.dirname(target);
  const base = path.basename(target).replace(/\.scene3d\.json$/i, '');
  const slug = `${base.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48)}-${crypto.createHash('sha256').update(path.resolve(target)).digest('hex').slice(0, 8)}`;
  return path.join(dir, '.history', slug);
}

function readIndex(indexPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (parsed && parsed.schema === HISTORY_SCHEMA && Array.isArray(parsed.revisions)) return parsed;
  } catch { /* missing or corrupt index is an empty history */ }
  return { schema: HISTORY_SCHEMA, revisions: [] };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function writeIndex(indexPath, index) {
  writeJson(indexPath, index);
}

function prune(indexPath, index, dir) {
  while (index.revisions.length > MAX_REVISIONS) {
    const removed = index.revisions.shift();
    if (removed && removed.file) {
      try { fs.rmSync(path.join(dir, removed.file), { force: true }); } catch { /* keep going */ }
    }
  }
}

function recordRevision(target, scene, { reason = 'edit' } = {}) {
  const dir = historyDirFor(target);
  const indexPath = path.join(dir, 'index.json');
  const index = readIndex(indexPath);
  const ordinal = (index.revisions.reduce((max, item) => Math.max(max, Number(item.ordinal) || 0), 0)) + 1;
  const revisionId = `rev-${String(ordinal).padStart(6, '0')}`;
  const file = `${revisionId}.json`;
  writeJson(path.join(dir, file), scene);
  index.schema = HISTORY_SCHEMA;
  index.revisions.push({
    revisionId,
    ordinal,
    hash: scene3d.hashSceneSpec(scene),
    reason: String(reason || 'edit').slice(0, MAX_REASON_CHARS),
    createdAt: new Date().toISOString(),
    file,
  });
  prune(indexPath, index, dir);
  writeIndex(indexPath, index);
  return index.revisions[index.revisions.length - 1];
}

function listRevisions(target) {
  const indexPath = path.join(historyDirFor(target), 'index.json');
  return readIndex(indexPath).revisions;
}

async function listRevisionsForProject({ workspaceRoot, relativePath } = {}) {
  if (!workspaceRoot) return [];
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return [];
  try {
    const target = await resolveWorkspaceTarget(workspaceRoot, normalized, { createRoot: true });
    return listRevisions(target.target);
  } catch {
    return [];
  }
}

function readCurrent(target, relativePath) {
  if (!fs.existsSync(target)) return { ok: false, error: 'scene_not_found', path: relativePath };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return { ok: false, error: 'scene_unreadable', path: relativePath };
  }
  const validated = scene3d.validateSceneSpec(parsed);
  if (!validated.ok) return { ok: false, error: 'scene_invalid', errors: validated.errors };
  return { ok: true, scene: parsed, hash: scene3d.hashSceneSpec(parsed) };
}

function diffScenes(before, after) {
  const params = new Map();
  for (const [name, value] of Object.entries(before.parameters || {})) params.set(name, { name, before: value, after: undefined });
  for (const [name, value] of Object.entries(after.parameters || {})) {
    const current = params.get(name) || { name, before: undefined };
    current.after = value;
    params.set(name, current);
  }
  const parameterChanges = [...params.values()]
    .filter((item) => item.before !== item.after)
    .map((item) => ({ ...item, status: item.before === undefined ? 'added' : item.after === undefined ? 'removed' : 'changed' }));

  const beforeNodes = new Map((before.nodes || []).map((node) => [node.id, node]));
  const afterNodes = new Map((after.nodes || []).map((node) => [node.id, node]));
  const nodeChanges = [];
  for (const id of new Set([...beforeNodes.keys(), ...afterNodes.keys()])) {
    const prev = beforeNodes.get(id);
    const next = afterNodes.get(id);
    if (!prev) { nodeChanges.push({ id, status: 'added', fields: [] }); continue; }
    if (!next) { nodeChanges.push({ id, status: 'removed', fields: [] }); continue; }
    const fields = ['type', 'transform', 'dimensions', 'material', 'label', 'source']
      .filter((field) => JSON.stringify(prev[field] ?? null) !== JSON.stringify(next[field] ?? null));
    if (fields.length > 0) nodeChanges.push({ id, status: 'changed', fields });
  }

  const keyOf = (constraint) => JSON.stringify(constraint);
  const beforeConstraints = new Set((before.constraints || []).map(keyOf));
  const afterConstraints = new Set((after.constraints || []).map(keyOf));
  const constraints = {
    added: [...afterConstraints].filter((item) => !beforeConstraints.has(item)).map((item) => JSON.parse(item)),
    removed: [...beforeConstraints].filter((item) => !afterConstraints.has(item)).map((item) => JSON.parse(item)),
  };

  return {
    beforeHash: scene3d.hashSceneSpec(before),
    afterHash: scene3d.hashSceneSpec(after),
    parameters: parameterChanges,
    nodes: nodeChanges,
    constraints,
    changed: parameterChanges.length + nodeChanges.length + constraints.added.length + constraints.removed.length > 0,
  };
}

async function applyOperations({ workspaceRoot, relativePath, operations, scene: baseScene = null, expectedHash = null, reason = 'edit' } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return { ok: false, error: 'scene_path_required' };
  let target;
  try {
    target = await resolveWorkspaceTarget(workspaceRoot, normalized, { createRoot: true });
  } catch (error) {
    return { ok: false, error: error.code || 'path_rejected', message: error.message };
  }
  let base = null;
  const disk = readCurrent(target.target, normalized);
  if (baseScene && typeof baseScene === 'object' && !Array.isArray(baseScene)) {
    const validated = scene3d.validateSceneSpec(baseScene);
    if (!validated.ok) return { ok: false, error: 'scene_invalid', errors: validated.errors };
    base = baseScene;
  } else if (disk.ok) {
    base = disk.scene;
  } else {
    return disk;
  }
  const baseHash = scene3d.hashSceneSpec(base);
  if (expectedHash && expectedHash !== baseHash) {
    return { ok: false, error: 'scene_conflict', currentHash: baseHash, expectedHash };
  }
  const applied = scene3d.applySceneOperations(base, operations);
  if (!applied.ok) return applied;
  const revision = disk.ok ? recordRevision(target.target, disk.scene, { reason }) : null;
  writeJson(target.target, applied.scene);
  return {
    ok: true,
    path: normalized,
    beforeHash: applied.beforeHash,
    afterHash: applied.afterHash,
    revision,
    diff: diffScenes(base, applied.scene),
    scene: applied.scene,
    message: 'SceneSpec 已写入；修订历史可恢复。',
  };
}

async function restoreRevision({ workspaceRoot, relativePath, revisionId } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return { ok: false, error: 'scene_path_required' };
  const requested = String(revisionId || '').trim();
  if (!/^rev-\d{6}$/.test(requested)) return { ok: false, error: 'revision_id_invalid' };
  let target;
  try {
    target = await resolveWorkspaceTarget(workspaceRoot, normalized, { createRoot: true });
  } catch (error) {
    return { ok: false, error: error.code || 'path_rejected', message: error.message };
  }
  const current = readCurrent(target.target, normalized);
  if (!current.ok) return current;
  const dir = historyDirFor(target.target);
  const indexPath = path.join(dir, 'index.json');
  const index = readIndex(indexPath);
  const entry = index.revisions.find((item) => item.revisionId === requested);
  if (!entry) return { ok: false, error: 'revision_not_found' };
  let restored;
  try {
    restored = JSON.parse(fs.readFileSync(path.join(dir, entry.file), 'utf8'));
  } catch {
    return { ok: false, error: 'revision_unreadable' };
  }
  const validated = scene3d.validateSceneSpec(restored);
  if (!validated.ok) return { ok: false, error: 'revision_invalid', errors: validated.errors };
  const snapshot = recordRevision(target.target, current.scene, { reason: `before_restore:${requested}` });
  writeJson(target.target, restored);
  return {
    ok: true,
    path: normalized,
    restoredRevisionId: requested,
    beforeHash: current.hash,
    afterHash: scene3d.hashSceneSpec(restored),
    snapshotRevision: snapshot,
    diff: diffScenes(current.scene, restored),
  };
}

async function writeScene({ workspaceRoot, relativePath, scene, reason = 'write' } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return { ok: false, error: 'scene_path_required' };
  const validated = scene3d.validateSceneSpec(scene);
  if (!validated.ok) return { ok: false, error: 'scene_invalid', errors: validated.errors };
  let target;
  try {
    target = await resolveWorkspaceTarget(workspaceRoot, normalized, { createRoot: true });
  } catch (error) {
    return { ok: false, error: error.code || 'path_rejected', message: error.message };
  }
  const disk = readCurrent(target.target, normalized);
  const revision = disk.ok ? recordRevision(target.target, disk.scene, { reason }) : null;
  writeJson(target.target, scene);
  return {
    ok: true,
    path: normalized,
    beforeHash: disk.ok ? disk.hash : null,
    afterHash: scene3d.hashSceneSpec(scene),
    revision,
    diff: disk.ok ? diffScenes(disk.scene, scene) : null,
  };
}

async function readSceneInput({ workspaceRoot, relativePath } = {}) {  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return { ok: false, error: 'scene_path_required' };
  let target;
  try {
    target = await resolveWorkspaceTarget(workspaceRoot, normalized, { createRoot: true });
  } catch (error) {
    return { ok: false, error: error.code || 'path_rejected', message: error.message };
  }
  return readCurrent(target.target, normalized);
}

module.exports = {
  HISTORY_SCHEMA,
  MAX_REVISIONS,
  normalizeRelativePath,
  diffScenes,
  applyOperations,
  writeScene,
  restoreRevision,
  listRevisions,
  listRevisionsForProject,
  readSceneInput,
  recordRevision,
  historyDirFor,
};
