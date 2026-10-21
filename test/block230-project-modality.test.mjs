/**
 * BLOCK-230 — Q-DOMAIN P4 切片：modality 默认 general + pack 声明扩展值。
 * 纯函数 / pack 贡献装载 / createProject 默认值三层。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');

const {
  BASE_MODALITIES,
  normalizeModalities,
  resolveProjectModality,
} = require(path.join(ROOT, 'core/shared-backend/project-modality.js'));

test('normalizeModalities：小写归一/去重/拒绝基础值与非法 id/上限', () => {
  assert.deepEqual(normalizeModalities(['proteomics', 'Proteomics', 'bad id', 'general', 'spatial']), ['proteomics']);
  assert.equal(normalizeModalities(Array.from({ length: 30 }, (_, i) => `m${i}`)).length, 20);
  assert.deepEqual(normalizeModalities('proteomics'), []);
  assert.deepEqual(BASE_MODALITIES, ['general', 'single-cell', 'spatial', 'bulk']);
});

test('resolveProjectModality：未知值回落 general；pack 扩展值可放行', () => {
  assert.equal(resolveProjectModality(undefined), 'general');
  assert.equal(resolveProjectModality('nope'), 'general');
  assert.equal(resolveProjectModality('single-cell'), 'single-cell');
  assert.equal(resolveProjectModality('proteomics', ['proteomics']), 'proteomics');
  assert.equal(resolveProjectModality('proteomics'), 'general');
});

test('pack.json provides.modalities → 贡献投影（仅 modality 的包也保留）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-p4-modality-'));
  try {
    const packRoot = path.join(root, 'pack-bio');
    fs.mkdirSync(path.join(root, 'packs'), { recursive: true });
    fs.mkdirSync(packRoot, { recursive: true });
    fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
      name: 'Bio Pack',
      version: '1.0.0',
      provides: { modalities: ['proteomics', 'Proteomics', 'bad id', 'general'] },
    }));
    fs.writeFileSync(path.join(root, 'packs', 'installed.json'), JSON.stringify([
      { packId: 'bio', packRoot, enabled: true, version: '1.0.0' },
    ]));
    const { loadPackContributions } = require(path.join(ROOT, 'core/petri-server/helpers/pack-contributions.js'));
    const { packs, diagnostics } = loadPackContributions({ dataDir: root });
    assert.equal(packs.length, 1, '只有 modality 的包不得被丢弃');
    assert.deepEqual(packs[0].modalities, ['proteomics']);
    assert.deepEqual(diagnostics, []);
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

test('createProject 未指定 modality → general（不再默认 single-cell）', () => {
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-p4-db-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-p4-ws-'));
  try {
    const Database = require('better-sqlite3');
    const dbFile = path.join(tempDbDir, 'petri.db');
    const bootstrap = new Database(dbFile);
    const migrationsDir = path.join(ROOT, 'src/migrations');
    for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
      bootstrap.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    }
    bootstrap.close();
    process.env.PETRI_DB_PATH = dbFile;
    const db = require(path.join(ROOT, 'core/petri-server/db.js'));
    const project = db.createProject({ name: 'p4-default', workspacePath: workspace });
    assert.equal(project.modality, 'general');
    assert.equal(db.getProject(project.id).modality, 'general');
  } finally {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
  }
});
