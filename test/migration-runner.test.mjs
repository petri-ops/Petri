import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const coreServerRoot = join(root, 'core', 'biof3-server');
const coreRequire = createRequire(join(coreServerRoot, 'package.json'));

test('migration CLI uses the Core native dependency boundary and records schema version', (t) => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'biof3-migration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const migrationsDir = join(dir, 'migrations');
  const dbPath = join(dir, 'biof3.db');
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(
    join(migrationsDir, '001_create_test.sql'),
    'CREATE TABLE migration_probe (id INTEGER PRIMARY KEY, value TEXT);',
  );

  const child = spawnSync(
    process.execPath,
    [join(root, 'src', 'migration-runner.js'), dbPath, migrationsDir],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        BIOF3_BETTER_SQLITE3_ROOT: coreServerRoot,
      },
    },
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.match(child.stdout, /migrations applied, version = 1/);

  const Database = coreRequire('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  try {
    const version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migration_probe'").get();
    assert.equal(version.version, 1);
    assert.equal(table.name, 'migration_probe');
  } finally {
    db.close();
  }
});
