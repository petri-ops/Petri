'use strict';

/**
 * shared-backend/result-annotation-store.js
 *
 * BLOCK-219 Q6 — 批注旁路存储（单一读写入口）。
 *
 * 为什么独立成文件而不塞进 result-studio-repository.js（1752 行）：
 * 批注的读写面只有三个动作（create / listByScope / delete），与 ChangeSet /
 * Revision / Selection 的状态机毫无交集；塞进巨型工厂只会让 code-size 预算与
 * 评审面同时变差。
 *
 * 不变量：
 * - 只写 `result_annotations`；不触碰 artifact_revisions / 原始产物文件。
 * - scope 判定唯一来源 = contracts.annotationScopeOf（结果产物按 artifact+revision，
 *   工作区文件按 filePath）——上限计数与列表读取必须同 scope，不各自拼 WHERE。
 * - 所有输入必须已经过 contracts.normalizeAnnotationInput（本层不重复校验语义，
 *   但仍会用参数化 SQL 防注入）。
 */

const crypto = require('crypto');
const { ensureAnnotationSchema } = require('./result-annotation-schema');
const {
  ANNOTATION_CONTRACT_VERSION,
  annotationScopeOf,
} = require('./result-annotation-contracts');

function nowIso() {
  return new Date().toISOString();
}

function newAnnotationId() {
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  return `ann_${random}`;
}

function parseRect(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [0, 0, 0, 0];
    // 文本锚点批注没有区域坐标，存 '[]' 而不是伪造一个 0×0 的框。
    if (parsed.length === 0) return [];
    if (parsed.length !== 4) return [0, 0, 0, 0];
    return parsed.map((value) => (Number.isFinite(value) ? value : 0));
  } catch {
    return [0, 0, 0, 0];
  }
}

/** anchor_json → 对象（坏数据按「无锚点」处理，不让一条脏行毁掉整页列表）。 */
function parseAnchor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function rowToAnnotation(row) {
  if (!row) return null;
  return {
    annotationId: row.annotation_id,
    contractVersion: Number(row.contract_version) || ANNOTATION_CONTRACT_VERSION,
    projectId: row.project_id,
    conversationId: row.conversation_id || null,
    surface: row.surface,
    artifactId: row.artifact_id || null,
    revisionId: row.revision_id || null,
    filePath: row.file_path || null,
    entryId: row.entry_id || null,
    artifactName: row.artifact_name || null,
    kind: row.kind || 'region',
    page: row.page === null || row.page === undefined ? null : Number(row.page),
    rect: parseRect(row.rect_json),
    anchor: parseAnchor(row.anchor_json),
    comment: row.comment,
    color: row.color,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scopeWhere(scope) {
  const clauses = ['project_id = ?', 'surface = ?'];
  const params = [scope.projectId, scope.surface];
  if (scope.surface === 'result-artifact') {
    clauses.push(scope.artifactId === null ? 'artifact_id IS NULL' : 'artifact_id = ?');
    if (scope.artifactId !== null) params.push(scope.artifactId);
    // revision 必须逐字匹配：不同 revision 的图/页布局不同，坐标不可跨版本复用。
    clauses.push(scope.revisionId === null ? 'revision_id IS NULL' : 'revision_id = ?');
    if (scope.revisionId !== null) params.push(scope.revisionId);
  } else if (scope.surface === 'scratchpad-entry') {
    // 速记图片批注按条目归属：与工作区路径、产物身份都无关。
    clauses.push(scope.entryId === null || scope.entryId === undefined ? 'entry_id IS NULL' : 'entry_id = ?');
    if (scope.entryId !== null && scope.entryId !== undefined) params.push(scope.entryId);
  } else {
    clauses.push(scope.filePath === null ? 'file_path IS NULL' : 'file_path = ?');
    if (scope.filePath !== null) params.push(scope.filePath);
  }
  return { sql: clauses.join(' AND '), params };
}

/**
 * @param {object} db better-sqlite3 实例
 * @param {{ ensureSchema?: boolean }} [options]
 */
function createResultAnnotationStore(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('[result-annotation-store] db instance with prepare() is required');
  }
  if (options.ensureSchema !== false) ensureAnnotationSchema(db);

  const insertStatement = db.prepare(`
    INSERT INTO result_annotations (
      annotation_id, contract_version, project_id, conversation_id, surface,
      artifact_id, revision_id, file_path, entry_id, artifact_name, kind, page,
      rect_json, anchor_json, comment, color, author, created_at, updated_at
    ) VALUES (
      @annotation_id, @contract_version, @project_id, @conversation_id, @surface,
      @artifact_id, @revision_id, @file_path, @entry_id, @artifact_name, @kind, @page,
      @rect_json, @anchor_json, @comment, @color, @author, @created_at, @updated_at
    )
  `);
  const getStatement = db.prepare('SELECT * FROM result_annotations WHERE annotation_id = ?');
  const deleteStatement = db.prepare('DELETE FROM result_annotations WHERE annotation_id = ?');

  function create(annotation) {
    const scope = annotationScopeOf(annotation);
    const timestamp = nowIso();
    const row = {
      annotation_id: newAnnotationId(),
      contract_version: ANNOTATION_CONTRACT_VERSION,
      project_id: scope.projectId,
      conversation_id: annotation.conversationId || null,
      surface: scope.surface,
      artifact_id: scope.artifactId,
      revision_id: scope.revisionId,
      file_path: scope.filePath,
      entry_id: scope.entryId || null,
      artifact_name: annotation.artifactName || null,
      kind: annotation.kind || 'region',
      page: annotation.page === undefined ? null : annotation.page,
      rect_json: JSON.stringify(Array.isArray(annotation.rect) ? annotation.rect : []),
      anchor_json: annotation.anchor ? JSON.stringify(annotation.anchor) : null,
      comment: annotation.comment,
      color: annotation.color,
      author: annotation.author || 'user',
      created_at: timestamp,
      updated_at: timestamp,
    };
    insertStatement.run(row);
    return rowToAnnotation(getStatement.get(row.annotation_id));
  }

  function listByScope(rawScope) {
    const scope = annotationScopeOf(rawScope);
    const where = scopeWhere(scope);
    const rows = db
      .prepare(`SELECT * FROM result_annotations WHERE ${where.sql} ORDER BY created_at ASC, annotation_id ASC`)
      .all(...where.params);
    return rows.map(rowToAnnotation);
  }

  function countByScope(rawScope) {
    const scope = annotationScopeOf(rawScope);
    const where = scopeWhere(scope);
    const row = db.prepare(`SELECT COUNT(*) AS count FROM result_annotations WHERE ${where.sql}`).get(...where.params);
    return Number(row && row.count) || 0;
  }

  function get(annotationId) {
    if (typeof annotationId !== 'string' || !annotationId) return null;
    return rowToAnnotation(getStatement.get(annotationId));
  }

  /** @returns {boolean} 是否真的删掉了一行（删除幂等：不存在返回 false）。 */
  function deleteById(annotationId) {
    if (typeof annotationId !== 'string' || !annotationId) return false;
    const info = deleteStatement.run(annotationId);
    return Boolean(info && info.changes > 0);
  }

  return { create, listByScope, countByScope, get, deleteById };
}

module.exports = { createResultAnnotationStore, rowToAnnotation, newAnnotationId };
