-- Add source_dataset_ids to datasets for merged-dataset lineage.
--
-- Frontend already declares this field in
--   frontend/src/lib/project-types.ts:43
--   frontend/src/pages/single-cell/_types.ts:50
-- The legacy _ProjectView.tsx merge flow used to embed this in the
-- description text (the long-standing TODO at line 300). This migration
-- promotes it to a first-class column.
--
-- JSONB (not TEXT[]):
--   - Matches the rest of the schema's JSON usage for free-form
--     structured payloads.
--   - Lets the API return it as an array without a cast at read time.
--   - Allows GIN indexing later if we want to query "which merged
--     dataset contains X".

BEGIN;

ALTER TABLE datasets
  ADD COLUMN IF NOT EXISTS source_dataset_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
