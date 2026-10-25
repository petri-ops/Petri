-- BLOCK-254 P5 — text anchor for annotations (migration 018)
--
-- This file is generated from core/shared-backend/result-annotation-schema.js.
-- Text-selection annotations anchor on (file, line range) instead of a normalized
-- rect; the two locators are mutually exclusive by contract, so area annotations
-- keep anchor_json NULL and text annotations keep rect_json as '[]'.
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - Additive only: one nullable column, no rewrite of existing rows.

ALTER TABLE result_annotations ADD COLUMN anchor_json TEXT;
