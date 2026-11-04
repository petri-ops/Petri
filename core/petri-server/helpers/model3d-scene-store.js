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

// UI-653 — 导出 run 目录的 scene.json 快照允许**只读**打开（聊天产物卡一键进 3D
// 工作面）；写面（apply/revision/restore）仍只认 .scene3d.json，避免编辑历史作业。
const RUN_SNAPSHOT_RE = /^model3d\/runs\/[^/]+\/scene\.json$/i;

function normalizeSnapshotPath(relativePath) {
  const text = String(relativePath || '').trim().replace(/\\/g, '/');
  return RUN_SNAPSHOT_RE.test(text) ? text : null;
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
    // BLOCK-344 P1 — source 不列入 diff 字段：update_node 白名单不含 source（外部引用变更
    // 属独立语义），显示侧过滤以保持「diff 列得出 = op 改得了」的对齐契约。
    const fields = ['type', 'transform', 'dimensions', 'material', 'label', 'modifiers']
      .filter((field) => JSON.stringify(prev[field] ?? null) !== JSON.stringify(next[field] ?? null));
    if (fields.length > 0) {
      const changesBefore = {};
      const changesAfter = {};
      for (const field of fields) {
        changesBefore[field] = prev[field] ?? null;
        changesAfter[field] = next[field] ?? null;
      }
      nodeChanges.push({ id, status: 'changed', fields, changesBefore, changesAfter });
    }
  }

  // BLOCK-344 P1 — 约束按 id 对齐：双侧在场的变更出 changed（此前只出 added+removed 对，
  // 「改一条约束」无法表达）；无 id 的历史约束维持 added/removed 口径。
  const keyOf = (constraint) => JSON.stringify(constraint);
  const beforeConstraints = new Map((before.constraints || []).map((item) => [item && item.id ? `id:${item.id}` : `raw:${keyOf(item)}`, item]));
  const afterConstraints = new Map((after.constraints || []).map((item) => [item && item.id ? `id:${item.id}` : `raw:${keyOf(item)}`, item]));
  const constraints = {
    added: [...afterConstraints.entries()].filter(([key]) => !beforeConstraints.has(key)).map(([, item]) => item),
    removed: [...beforeConstraints.entries()].filter(([key]) => !afterConstraints.has(key)).map(([, item]) => item),
    changed: [],
  };
  for (const [key, afterItem] of afterConstraints.entries()) {
    const beforeItem = beforeConstraints.get(key);
    if (beforeItem && keyOf(beforeItem) !== keyOf(afterItem)) {
      constraints.changed.push({ id: afterItem.id, before: beforeItem, after: afterItem });
    }
  }

  return {
    beforeHash: scene3d.hashSceneSpec(before),
    afterHash: scene3d.hashSceneSpec(after),
    parameters: parameterChanges,
    nodes: nodeChanges,
    constraints,
    changed: parameterChanges.length + nodeChanges.length + constraints.added.length + constraints.removed.length + constraints.changed.length > 0,
  };
}

/**
 * BLOCK-344 P1 — diff → 白名单 op 序列（纯函数）：逐项取舍/提案回显的语义 patch 源。
 * 顺序设计：set_parameter → add_node → update_node → remove_constraint → update_constraint
 * → add_constraint → remove_node（约束引用节点先建后连；删节点收尾防约束悬空）。
 */
function diffToOperations(before, after) {
  const diff = diffScenes(before, after);
  const ops = [];
  for (const p of diff.parameters) {
    if (p.status === 'removed') continue; // 参数删除不在 op 白名单（schema 只收 number 值），如实跳过
    ops.push({ op: 'set_parameter', name: p.name, value: p.after });
  }
  for (const n of diff.nodes) {
    if (n.status === 'added') {
      const node = afterNodesOf(after).get(n.id);
      if (node) ops.push({ op: 'add_node', node: JSON.parse(JSON.stringify(node)) });
    } else if (n.status === 'changed') {
      ops.push({ op: 'update_node', id: n.id, changes: n.changesAfter });
    }
  }
  for (const c of diff.constraints.removed) {
    if (c && c.id) ops.push({ op: 'remove_constraint', id: c.id });
  }
  for (const c of diff.constraints.changed) {
    ops.push({ op: 'update_constraint', id: c.id, changes: diffPlain(c.after, c.before) });
  }
  for (const c of diff.constraints.added) {
    if (c && c.id) ops.push({ op: 'add_constraint', constraint: c });
  }
  for (const n of diff.nodes) {
    if (n.status === 'removed') ops.push({ op: 'remove_node', id: n.id });
  }
  return ops;
}

function afterNodesOf(scene) {
  return new Map((scene.nodes || []).map((node) => [node.id, node]));
}

/** 逐字段拆 after 相对 before 的变更（浅层；数组/对象整体替换）。 */
function diffPlain(after, before) {
  const changes = {};
  const keys = new Set([...Object.keys(after || {}), ...Object.keys(before || {})]);
  for (const key of keys) {
    if (key === 'id') continue;
    if (JSON.stringify((after || {})[key] ?? null) !== JSON.stringify((before || {})[key] ?? null)) {
      changes[key] = (after || {})[key] ?? null;
    }
  }
  return changes;
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
  const normalized = normalizeRelativePath(relativePath) || normalizeSnapshotPath(relativePath);
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
  diffToOperations,
  HISTORY_SCHEMA,
  MAX_REVISIONS,
  normalizeRelativePath,
  normalizeSnapshotPath,
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
