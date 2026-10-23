'use strict';

/**
 * shared-backend/scratchpad-store.js
 *
 * BLOCK-246 C13 —— 速记板旁路存储（单一读写入口）。
 *
 * 为什么独立成文件而不塞进 routes/scratchpad.js：路由只做 HTTP 形状（参数解析、
 * 状态码、错误文案），上限与清洗必须与测试共享同一份实现——否则"路由校验 8000 字
 * 但 store 允许 10 万字"这类双真相会在第二次改动时出现。
 *
 * 不变量：
 * - 只写 `scratchpad_entries`；不触碰会话/消息/产物任何表。
 * - 上限只有一份：正文 8000 字符（图片按 data URL 字符数 2,000,000 ≈ 1.5MB 原始字节）、
 *   标题 120 字符、列表单页 ≤ 100。超限返回可读原因，不静默截断。
 * - 列表按 created_at DESC（同毫秒用 entry_id 兜底），搜索对正文与标题做 LIKE，
 *   用户输入的 `%`/`_` 按字面量转义（否则 `%` 会变成"全表命中"的隐式通配）。
 */

const crypto = require('crypto');
const {
  SCRATCHPAD_CONTRACT_VERSION,
  ensureScratchpadSchema,
} = require('./scratchpad-schema');

const MAX_SCRATCHPAD_TEXT_CHARS = 8000;
const MAX_SCRATCHPAD_TITLE_CHARS = 120;
const MAX_SCRATCHPAD_IMAGE_DATA_URL_CHARS = 2_000_000;
const MAX_SCRATCHPAD_LIST_LIMIT = 100;
const SCRATCHPAD_KINDS = Object.freeze(['text', 'image']);
const SCRATCHPAD_SOURCE_KINDS = Object.freeze(['manual', 'conversation', 'file', 'selection']);

function nowIso() {
  return new Date().toISOString();
}

function newEntryId() {
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  return `scr_${random}`;
}

function charLength(value) {
  // 用 Array.from 数"码点"而不是 UTF-16 单元：中文/emoji 不该按两三个字符计上限。
  return Array.from(value).length;
}

function fail(error) {
  return { ok: false, error };
}

/**
 * 清洗 + 校验一条速记输入。返回 `{ ok: true, value }` 或 `{ ok: false, error }`。
 * 错误文案直接给用户看（前端原样展示），因此写中文且说明边界。
 */
function normalizeScratchpadInput(raw) {
  if (!raw || typeof raw !== 'object') return fail('速记内容缺失');
  const kind = typeof raw.kind === 'string' && raw.kind ? raw.kind : 'text';
  if (!SCRATCHPAD_KINDS.includes(kind)) return fail(`速记类型不支持：${kind}`);

  const body = typeof raw.body === 'string' ? raw.body : '';
  if (!body.trim()) return fail('速记内容为空');

  if (kind === 'image') {
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(body) && !/^https?:\/\//i.test(body)) {
      return fail('图片速记必须是 data URL 或 http(s) 地址');
    }
    if (body.length > MAX_SCRATCHPAD_IMAGE_DATA_URL_CHARS) {
      return fail(`图片过大：${Math.round(body.length / 1024)}KB，上限约 ${Math.round(MAX_SCRATCHPAD_IMAGE_DATA_URL_CHARS / 1024)}KB（请压缩后再存）`);
    }
  } else if (charLength(body) > MAX_SCRATCHPAD_TEXT_CHARS) {
    return fail(`速记过长：${charLength(body)} 字，上限 ${MAX_SCRATCHPAD_TEXT_CHARS} 字（请先精简）`);
  }

  const rawTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
  const title = charLength(rawTitle) > MAX_SCRATCHPAD_TITLE_CHARS
    ? `${Array.from(rawTitle).slice(0, MAX_SCRATCHPAD_TITLE_CHARS).join('')}…`
    : rawTitle;

  const sourceKind = typeof raw.sourceKind === 'string' && raw.sourceKind ? raw.sourceKind : 'manual';
  if (!SCRATCHPAD_SOURCE_KINDS.includes(sourceKind)) return fail(`速记来源不支持：${sourceKind}`);

  const sourceRef = typeof raw.sourceRef === 'string' && raw.sourceRef.trim() ? raw.sourceRef.trim() : null;
  const projectId = typeof raw.projectId === 'string' && raw.projectId.trim() ? raw.projectId.trim() : null;

  return {
    ok: true,
    value: { kind, title: title || null, body, sourceKind, sourceRef, projectId },
  };
}

/** LIKE 字面量转义：`%`/`_`/`\` 不该被当成通配符（否则搜索 `%` 会命中全表）。 */
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function rowToEntry(row) {
  if (!row) return null;
  return {
    entryId: row.entry_id,
    contractVersion: Number(row.contract_version) || SCRATCHPAD_CONTRACT_VERSION,
    kind: row.kind,
    title: row.title || null,
    body: row.body,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref || null,
    projectId: row.project_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeListOptions(options = {}) {
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_SCRATCHPAD_LIST_LIMIT)
    : 20;
  const rawOffset = Number(options.offset);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  const query = typeof options.query === 'string' ? options.query.trim() : '';
  return { limit, offset, query };
}

/**
 * @param {object} db better-sqlite3 实例
 * @param {{ ensureSchema?: boolean }} [options]
 */
function createScratchpadStore(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('[scratchpad-store] db instance with prepare() is required');
  }
  if (options.ensureSchema !== false) ensureScratchpadSchema(db);

  const insertStatement = db.prepare(`
    INSERT INTO scratchpad_entries (
      entry_id, contract_version, kind, title, body, source_kind, source_ref,
      project_id, created_at, updated_at
    ) VALUES (
      @entry_id, @contract_version, @kind, @title, @body, @source_kind, @source_ref,
      @project_id, @created_at, @updated_at
    )
  `);
  const getStatement = db.prepare('SELECT * FROM scratchpad_entries WHERE entry_id = ?');
  const deleteStatement = db.prepare('DELETE FROM scratchpad_entries WHERE entry_id = ?');

  function create(raw) {
    const normalized = normalizeScratchpadInput(raw);
    if (normalized.ok === false) return normalized;
    const timestamp = nowIso();
    const value = normalized.value;
    const entryId = newEntryId();
    insertStatement.run({
      entry_id: entryId,
      contract_version: SCRATCHPAD_CONTRACT_VERSION,
      kind: value.kind,
      title: value.title,
      body: value.body,
      source_kind: value.sourceKind,
      source_ref: value.sourceRef,
      project_id: value.projectId,
      created_at: timestamp,
      updated_at: timestamp,
    });
    return { ok: true, entry: rowToEntry(getStatement.get(entryId)) };
  }

  function list(rawOptions = {}) {
    const { limit, offset, query } = normalizeListOptions(rawOptions);
    const clauses = [];
    const params = [];
    if (query) {
      const like = `%${escapeLike(query)}%`;
      clauses.push("(body LIKE ? ESCAPE '\\' OR COALESCE(title, '') LIKE ? ESCAPE '\\')");
      params.push(like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM scratchpad_entries ${where}`)
      .get(...params).n;
    const rows = db
      .prepare(
        `SELECT * FROM scratchpad_entries ${where} ORDER BY created_at DESC, entry_id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);
    return { entries: rows.map(rowToEntry), total, limit, offset };
  }

  function remove(entryId) {
    if (typeof entryId !== 'string' || !entryId) return false;
    const result = deleteStatement.run(entryId);
    return result.changes > 0;
  }

  function get(entryId) {
    if (typeof entryId !== 'string' || !entryId) return null;
    return rowToEntry(getStatement.get(entryId));
  }

  return { create, list, remove, get };
}

module.exports = {
  MAX_SCRATCHPAD_TEXT_CHARS,
  MAX_SCRATCHPAD_TITLE_CHARS,
  MAX_SCRATCHPAD_IMAGE_DATA_URL_CHARS,
  MAX_SCRATCHPAD_LIST_LIMIT,
  SCRATCHPAD_KINDS,
  SCRATCHPAD_SOURCE_KINDS,
  normalizeScratchpadInput,
  escapeLike,
  createScratchpadStore,
};
