-- Migration: Add index on users(created_at) for fast retention/analytics queries
BEGIN;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
COMMIT;
