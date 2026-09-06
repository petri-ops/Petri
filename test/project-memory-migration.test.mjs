import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { bootstrapTestDb } from './helpers/bootstrap-db.mjs';

const require = createRequire(import.meta.url);
const tempRoot = mkdtempSync(join(tmpdir(), 'biof3-project-memory-migration-'));
process.env.BIOF3_DB_PATH = join(tempRoot, 'memory.db');


bootstrapTestDb();
const dbMod = require('../core/biof3-server/db.js');
const sqlite = dbMod.getDatabase();
const now = new Date().toISOString();

sqlite.exec(`
  CREATE TABLE copilot_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    project_id TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE memory_vectors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref_id TEXT,
    page TEXT,
    page_title TEXT,
    content TEXT NOT NULL,
    embedding BLOB NOT NULL,
    ts TEXT NOT NULL,
    created_at TEXT NOT NULL,
    conversation_id TEXT
  );
`);
sqlite.prepare('INSERT INTO copilot_conversations(id,user_id,title,status,project_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
  .run('conv-a', 'user-a', '旧会话', 'active', 'project-a', now, now);
sqlite.prepare('INSERT INTO memory_vectors(id,user_id,kind,content,embedding,ts,created_at,conversation_id) VALUES (?,?,?,?,?,?,?,?)')
  .run('mem-a', 'user-a', 'chat_turn', '可安全迁移的旧记忆', Buffer.from(new Float32Array([1, 0]).buffer), now, now, 'conv-a');

require('../core/biof3-server/helpers/memory-vectors.js');

test.after(() => {
  try { sqlite.close(); } catch {}
  rmSync(tempRoot, { recursive: true, force: true });
});

test('legacy vectors inherit project scope from their linked conversation', () => {
  const row = sqlite.prepare('SELECT project_id FROM memory_vectors WHERE id=?').get('mem-a');
  assert.equal(row.project_id, 'project-a');
});
