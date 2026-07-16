/**
 * P2 smoke: ensurePgAuxSchema + getSqliteForLegacyModules when DATABASE_URL set.
 * Run: cd r-server && npm install && DATABASE_URL=... node --test ../test/db-pg-p2.mjs
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'module';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const skip = !process.env.DATABASE_URL;

test('db P2 startup + aux sqlite handle', {skip}, () => {
  const db = require(path.join(__dirname, '../r-server/db.js'));
  assert.equal(db.isPg(), true);
  db.runPgStartupChecks();
  const sqlite = db.getSqliteForLegacyModules();
  assert.ok(sqlite && typeof sqlite.exec === 'function');
  sqlite.exec('SELECT 1');
});