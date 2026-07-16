/**
 * Smoke test: db.js P0 (users + site_settings) against PostgreSQL.
 * Run: cd r-server && npm install && DATABASE_URL=... node --test ../test/db-pg-p0.mjs
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'module';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const skip = !process.env.DATABASE_URL;

test('db P0 PostgreSQL', {skip}, () => {
  const db = require(path.join(__dirname, '../r-server/db.js'));
  assert.equal(db.isPgUsers(), true, 'isPgUsers');

  const key = '__p0_test_' + Date.now();
  db.setSiteSetting(key, '{"ok":true}');
  const row = db.getSiteSetting(key);
  assert.equal(row.value, '{"ok":true}');

  const uname = '__p0_u_' + Date.now();
  const u = db.createUser({
    id: 'u_p0test',
    username: uname,
    passwordHash: 'x',
    role: 'user',
  });
  assert.equal(u.username, uname);
  assert.ok(db.getUserByUsername(uname));
  db.deleteUser('u_p0test');
});