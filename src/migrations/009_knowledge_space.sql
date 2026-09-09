-- BLOCK-69 — Knowledge Space data model (migration 009)
--
-- 知识空间（第三数据域）持久化 schema：
-- - knowledge_spaces：空间实体（v1 单行 default 空间 =「大脑」的实体化）
-- - knowledge_documents：上传文档清单 + 摄取状态机
-- - knowledge_chunks：分块 + 向量 BLOB（编码沿用 memory-vectors 的 Float32Array BLOB 方案，独立建表）
-- - knowledge_chunks_fts：FTS5 trigram 全文虚表（关键词精确命中通道；chunk_id UNINDEXED 关联回表）
--
-- 语义红线（plan §7）：
-- - 不动 memory_vectors / user_facts（对话记忆域零改动，不合并不互写）
-- - 不混项目工作区数据面（routes/files.js import + data-profiler 真相不动）
--
-- 约束：
-- - 不含 BEGIN/COMMIT：migration-runner 已把本文件包在 db.transaction 内。
-- - 不使用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT。
-- - 只新增表与索引，不修改任何现有表。

-- 知识空间表（v1 单行 default 空间；space 字段留多空间扩展位）
CREATE TABLE IF NOT EXISTS knowledge_spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  embedding_model TEXT NOT NULL DEFAULT 'text-embedding-v3',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- v1 默认空间种子行（首次应用 migration 时插入一次）
INSERT INTO knowledge_spaces (id, name, enabled, embedding_model, created_at, updated_at)
SELECT 'ks_default', '默认知识空间', 0, 'text-embedding-v3', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM knowledge_spaces WHERE id = 'ks_default');

-- 文档表（状态机 uploaded → parsing → chunking → embedding → ready | failed）
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL DEFAULT 'ks_default',
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'uploaded',
  error TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  raw_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (space_id) REFERENCES knowledge_spaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kdocs_space ON knowledge_documents(space_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_kdocs_status ON knowledge_documents(status);

-- 分块表（embedding BLOB = Float32Array 小端字节序，dim/model 冗余存列便于校验）
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  space_id TEXT NOT NULL DEFAULT 'ks_default',
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB,
  dim INTEGER,
  model TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kchunks_doc ON knowledge_chunks(doc_id, seq);
CREATE INDEX IF NOT EXISTS idx_kchunks_space ON knowledge_chunks(space_id);

-- FTS5 全文虚表（trigram 分词：中文子串 ≥3 字可命中；<3 字由查询侧 LIKE 兜底）
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  tokenize='trigram'
);
