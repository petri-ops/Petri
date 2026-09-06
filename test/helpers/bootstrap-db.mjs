'use strict';

/**
 * test/helpers/bootstrap-db.mjs — BLOCK-49 加映清债
 *
 * 统一临时 DB 自举 helper：创建 temp DB + 应用全量 migrations + 设
 * BIOF3_DB_PATH。解决「单跑/全量缺 projects 表」的存量测试基建债。
 *
 * 用法（在 require db.js 之前调用）：
 *   import { bootstrapTestDb } from './helpers/bootstrap-db.mjs';
 *   bootstrapTestDb(import.meta.url);
 *   const db = require('../core/biof3-server/db.js');
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export function bootstrapTestDb(prefix = 'biof3-test-') {
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDbDir, 'biof3.db');
  const Database = require(
    path.resolve(__dirname, '..', '..', 'core', 'biof3-server', 'node_modules', 'better-sqlite3')
  );
  const boot = new Database(dbPath);
  const migrationsDir = path.resolve(__dirname, '..', '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = dbPath;
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  return dbPath;
}
