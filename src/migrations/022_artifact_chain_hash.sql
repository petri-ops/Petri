-- BLOCK-372（NSO Batch-1）— artifact revision 链哈希列。
-- prev_chain_hash: 前一版本的 chain_hash（首版为 NULL）。
-- chain_hash: sha256(canonical(prev_chain_hash) || canonical(本版本业务列))，写入时计算；
--   父版本元数据改动不再无痕（评估 F-20）。存量行由写入路径惰性回填（首次再写同族时链入），
--   独立校验器 scripts/verify-artifact-chain.mjs 可复算全链。
ALTER TABLE artifact_revisions ADD COLUMN prev_chain_hash TEXT;
ALTER TABLE artifact_revisions ADD COLUMN chain_hash TEXT;
