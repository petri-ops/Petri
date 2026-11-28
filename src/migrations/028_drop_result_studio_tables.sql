-- item 90 阶段二：Result Studio 物理删除 — 清理 10 张 RS 专属表（forward migration 028）
--
-- 背景：
-- - 历史迁移文件（001/002/003/006/007）严禁修改，保持完整可重放。
-- - 本前向迁移仅 DROP 10 张 RS 专属表；`result_annotations`（015/018/019/020）
--   为 PDF/图片/文本/速记板批注共享能力，显式保留不删除。
--
-- 约束：
-- - 不含 BEGIN/COMMIT：migration-runner 已把本文件包在 db.transaction 内。
-- - 不使用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT。
-- - 按外键依赖先删子表（result_tags / result_versions）再删主表（results）。

DROP TABLE IF EXISTS result_tags;
DROP TABLE IF EXISTS result_versions;
DROP TABLE IF EXISTS results;
DROP TABLE IF EXISTS result_workflow_graphs;
DROP TABLE IF EXISTS result_ref_transactions;
DROP TABLE IF EXISTS git_repository_bindings;
DROP TABLE IF EXISTS scientific_change_sets;
DROP TABLE IF EXISTS artifact_revisions;
DROP TABLE IF EXISTS result_selection_contexts;
DROP TABLE IF EXISTS workspace_revision_checkpoints;
