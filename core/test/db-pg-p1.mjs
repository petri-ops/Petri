/**
 * Smoke test: db.js P1 (projects/datasets/analyses) against PostgreSQL.
 * Run: cd r-server && DATABASE_URL=... node --test ../test/db-pg-p1.mjs
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'module';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const skip = !process.env.DATABASE_URL;

test('db P1 PostgreSQL core CRUD', {skip}, () => {
  const db = require(path.join(__dirname, '../r-server/db.js'));
  assert.equal(db.isPgUsers(), true);

  const p = db.createProject({
    name: '__p1_test_' + Date.now(),
    description: 'pg p1',
    modality: 'single-cell',
    userId: 'u_p1test',
  });
  assert.ok(p.id);
  assert.equal(p.user_id, 'u_p1test');

  const ds = db.createDataset({
    projectId: p.id,
    name: 'ds1',
    ossUrl: 'https://example.com/x.rds',
    size: 1,
  });
  assert.ok(ds.id);

  const a = db.createAnalysis({
    datasetId: ds.id,
    type: 'qc',
    name: 'qc1',
    status: 'pending',
  });
  assert.ok(a.id);

  const stats = db.getProjectStats(p.id);
  assert.equal(stats.datasets, 1);
  assert.equal(stats.analyses, 1);

  db.deleteProject(p.id);
  assert.equal(db.getProject(p.id), null);
});