-- BLOCK-254 P6 — scratchpad entry ownership for annotations (migration 019)
--
-- This file is generated from core/shared-backend/result-annotation-schema.js.
-- Scratchpad image annotations belong to a scratchpad entry (entryId), not to an
-- artifact or a workspace path; every other surface keeps entry_id NULL.
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - Additive only: one nullable column, no rewrite of existing rows.

ALTER TABLE result_annotations ADD COLUMN entry_id TEXT;
