-- Fix BIGSERIAL sequences after SQLite→PG data migration (2026-06-07).
--
-- Symptom: INSERT into feedbacks / ai_usage / page_views / chat_audit / agent_audit
-- fails with "duplicate key value violates unique constraint <tbl>_pkey" because rows
-- were copied with explicit ids but the owning sequence was never advanced, so
-- nextval() returns values that collide with existing ids.
--
-- Fix: setval each id sequence to MAX(id)+1 (is_called=false → next nextval = MAX+1).
-- Idempotent: re-running only re-aligns the sequence to current data. Empty table → next=1.

BEGIN;

SELECT setval(pg_get_serial_sequence('feedbacks',   'id'), COALESCE((SELECT MAX(id) FROM feedbacks),   0) + 1, false);
SELECT setval(pg_get_serial_sequence('ai_usage',     'id'), COALESCE((SELECT MAX(id) FROM ai_usage),     0) + 1, false);
SELECT setval(pg_get_serial_sequence('page_views',   'id'), COALESCE((SELECT MAX(id) FROM page_views),   0) + 1, false);
SELECT setval(pg_get_serial_sequence('chat_audit',   'id'), COALESCE((SELECT MAX(id) FROM chat_audit),   0) + 1, false);
SELECT setval(pg_get_serial_sequence('agent_audit',  'id'), COALESCE((SELECT MAX(id) FROM agent_audit),  0) + 1, false);

COMMIT;
