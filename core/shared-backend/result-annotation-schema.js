'use strict';

/**
 * shared-backend/result-annotation-schema.js
 *
 * BLOCK-219 Q6 — 产物批注（annotation）旁路元数据的**唯一** DDL 来源。
 *
 * 与 result-studio-schema.js（001）/ result-workflow-graph（002）/
 * result-ref-transaction-schema（003）同形态：DDL 写在 JS，`src/migrations/NNN_*.sql`
 * 由 build 函数生成并与之逐字节一致（test/block219-result-annotations.test.mjs 强制）。
 *
 * 不变量：
 * - 只新增表与索引，不修改任何现有表（001 已应用的库靠 015 增量迁移补齐）。
 * - 批注是**旁路元数据**：不写回原始产物文件，也不改 artifact_revisions。
 * - 不使用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT；不含 BEGIN/COMMIT。
 * - 坐标一律归一化（0..1），像素/缩放不进库——跨缩放可复现是契约不是实现细节。
 */

const RESULT_ANNOTATION_MIGRATION_VERSION = 15;
/**
 * BLOCK-254 P5 — 文本锚点列（018）。015 的建表语句**保持逐字节不变**（既有测试钉住），
 * 新列只经 ALTER 追加：新库由 ensureAnnotationSchema 在建表后补列，旧库由 018 迁移补列。
 */
const RESULT_ANNOTATION_ANCHOR_MIGRATION_VERSION = 18;
/**
 * BLOCK-254 P6 — 速记条目归属列（019）。同样只 ALTER 追加：速记图片批注按 entryId
 * 归属，其它面该列为 NULL。
 */
const RESULT_ANNOTATION_ENTRY_MIGRATION_VERSION = 19;
const RESULT_ANNOTATION_CONTRACT_VERSION = 1;

const RESULT_ANNOTATION_TABLES = Object.freeze(['result_annotations']);

const RESULT_ANNOTATION_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS result_annotations (
  annotation_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  project_id TEXT NOT NULL,
  conversation_id TEXT,
  surface TEXT NOT NULL,
  artifact_id TEXT,
  revision_id TEXT,
  file_path TEXT,
  artifact_name TEXT,
  kind TEXT NOT NULL DEFAULT 'region',
  page INTEGER,
  rect_json TEXT NOT NULL,
  comment TEXT NOT NULL,
  color TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_rs_annotations_project ON result_annotations(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_rs_annotations_artifact ON result_annotations(project_id, artifact_id, revision_id)',
  'CREATE INDEX IF NOT EXISTS idx_rs_annotations_file ON result_annotations(project_id, file_path)',
]);

const RESULT_ANNOTATION_MIGRATION_HEADER = `-- BLOCK-219 Q6 — artifact annotations (migration 015)
--
-- This file is generated from core/shared-backend/result-annotation-schema.js.
-- Annotations are sidecar metadata: they never write back into the original
-- artifact file, and coordinates are always normalized to 0..1 so the same
-- annotation survives zoom/scale changes.
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - No INSERT OR REPLACE / PRAGMA / AUTOINCREMENT.
-- - Additive only: new table + indexes, no changes to existing tables.`;

function buildAnnotationMigrationSql() {
  const body = RESULT_ANNOTATION_SCHEMA_STATEMENTS.map((statement) => `${statement};`).join('\n\n');
  return `${RESULT_ANNOTATION_MIGRATION_HEADER}\n\n${body}\n`;
}

/** 018 — 文本锚点列（可空；区域批注该列为 NULL）。 */
const RESULT_ANNOTATION_ANCHOR_STATEMENTS = Object.freeze([
  'ALTER TABLE result_annotations ADD COLUMN anchor_json TEXT',
]);

const RESULT_ANNOTATION_ANCHOR_HEADER = `-- BLOCK-254 P5 — text anchor for annotations (migration 018)
--
-- This file is generated from core/shared-backend/result-annotation-schema.js.
-- Text-selection annotations anchor on (file, line range) instead of a normalized
-- rect; the two locators are mutually exclusive by contract, so area annotations
-- keep anchor_json NULL and text annotations keep rect_json as '[]'.
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - Additive only: one nullable column, no rewrite of existing rows.`;

function buildAnnotationAnchorMigrationSql() {
  const body = RESULT_ANNOTATION_ANCHOR_STATEMENTS.map((statement) => `${statement};`).join('\n\n');
  return `${RESULT_ANNOTATION_ANCHOR_HEADER}\n\n${body}\n`;
}

/** 锚点列是否就位（旧库升级前为 false）。 */
function hasAnnotationAnchorColumn(db) {
  if (!db || typeof db.prepare !== 'function') return false;
  try {
    const rows = db.prepare('PRAGMA table_info(result_annotations)').all();
    return rows.some((row) => row && row.name === 'anchor_json');
  } catch {
    return false;
  }
}

/** 019 — 速记条目归属列（可空；其它面该列为 NULL）。 */
const RESULT_ANNOTATION_ENTRY_STATEMENTS = Object.freeze([
  'ALTER TABLE result_annotations ADD COLUMN entry_id TEXT',
]);

const RESULT_ANNOTATION_ENTRY_HEADER = `-- BLOCK-254 P6 — scratchpad entry ownership for annotations (migration 019)
--
-- This file is generated from core/shared-backend/result-annotation-schema.js.
-- Scratchpad image annotations belong to a scratchpad entry (entryId), not to an
-- artifact or a workspace path; every other surface keeps entry_id NULL.
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - Additive only: one nullable column, no rewrite of existing rows.`;

function buildAnnotationEntryMigrationSql() {
  const body = RESULT_ANNOTATION_ENTRY_STATEMENTS.map((statement) => `${statement};`).join('\n\n');
  return `${RESULT_ANNOTATION_ENTRY_HEADER}\n\n${body}\n`;
}

/** 条目归属列是否就位（旧库升级前为 false）。 */
function hasAnnotationEntryColumn(db) {
  if (!db || typeof db.prepare !== 'function') return false;
  try {
    const rows = db.prepare('PRAGMA table_info(result_annotations)').all();
    return rows.some((row) => row && row.name === 'entry_id');
  } catch {
    return false;
  }
}

/**
 * 幂等建表（测试 / 脚本 / 隔离后端用）。
 *
 * 生产升级路径仍是 `src/migrations/015_result_annotations.sql`；本函数执行同一份
 * DDL，不构成第二套 schema。
 */
function ensureAnnotationSchema(db) {
  if (!db || typeof db.exec !== 'function') {
    throw new Error('[result-annotation-schema] db instance with exec() is required');
  }
  for (const statement of RESULT_ANNOTATION_SCHEMA_STATEMENTS) db.exec(statement);
  // 旧库（015 之后、018 之前）补列；已补则跳过，保证幂等。
  if (!hasAnnotationAnchorColumn(db)) {
    for (const statement of RESULT_ANNOTATION_ANCHOR_STATEMENTS) db.exec(statement);
  }
  // 019 同理：速记归属列。
  if (!hasAnnotationEntryColumn(db)) {
    for (const statement of RESULT_ANNOTATION_ENTRY_STATEMENTS) db.exec(statement);
  }
  return { contractVersion: RESULT_ANNOTATION_CONTRACT_VERSION, tables: [...RESULT_ANNOTATION_TABLES] };
}

/** 批注表是否就位（缺表不自动创建）。 */
function inspectAnnotationSchema(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('[result-annotation-schema] db instance with prepare() is required');
  }
  const statement = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?");
  const missingTables = RESULT_ANNOTATION_TABLES.filter((table) => !statement.get(table));
  return {
    complete: missingTables.length === 0,
    missingTables,
    presentTables: RESULT_ANNOTATION_TABLES.filter((table) => !missingTables.includes(table)),
  };
}

module.exports = {
  RESULT_ANNOTATION_MIGRATION_VERSION,
  RESULT_ANNOTATION_ANCHOR_MIGRATION_VERSION,
  RESULT_ANNOTATION_ENTRY_MIGRATION_VERSION,
  RESULT_ANNOTATION_CONTRACT_VERSION,
  RESULT_ANNOTATION_TABLES,
  RESULT_ANNOTATION_SCHEMA_STATEMENTS,
  RESULT_ANNOTATION_ANCHOR_STATEMENTS,
  RESULT_ANNOTATION_ENTRY_STATEMENTS,
  buildAnnotationMigrationSql,
  buildAnnotationAnchorMigrationSql,
  buildAnnotationEntryMigrationSql,
  hasAnnotationAnchorColumn,
  hasAnnotationEntryColumn,
  ensureAnnotationSchema,
  inspectAnnotationSchema,
};
