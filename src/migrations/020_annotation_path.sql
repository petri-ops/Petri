-- BLOCK-264 C-43 — freehand path column for annotations (migration 020)
--
-- This file is generated from core/shared-backend/result-annotation-schema.js.
-- Freehand pen annotations store a normalized point series in path_json
-- (same 0..1 domain as rect_json); every non-freehand kind keeps it NULL.
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - Additive only: one nullable column, no rewrite of existing rows.

ALTER TABLE result_annotations ADD COLUMN path_json TEXT;
