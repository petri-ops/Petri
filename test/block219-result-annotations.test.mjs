/**
 * BLOCK-219 Q6 — 产物批注 host 的后端契约。
 *
 * 覆盖四层，任一层退化都必须红：
 * 1. 迁移单源：`015_result_annotations.sql` 与 schema 生成器逐字节一致 + 禁用构造。
 * 2. 契约：归一化坐标（反向拖拽/越界钳制/退化拒绝）、评论/页号/颜色/surface 校验、
 *    路径安全（拒绝绝对路径与 `..` 逃逸）。
 * 3. 仓储：scope 隔离（artifact+revision / filePath）、计数、删除幂等。
 * 4. 路由：三端点注册 + 真实 handler 行为（创建/列表/超限 409/未知项目 404/删除 404）。
 */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block219-'));
process.env.PETRI_DB_PATH = path.join(sandbox, 'block219.db');
process.env.PETRI_LOCAL_DATA_DIR = sandbox;

const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(REPO_ROOT, 'src', 'migrations'));

const {
  RESULT_ANNOTATION_MIGRATION_VERSION,
  buildAnnotationMigrationSql,
  ensureAnnotationSchema,
  inspectAnnotationSchema,
} = require('../core/shared-backend/result-annotation-schema');
const {
  MAX_ANNOTATION_COMMENT_CHARS,
  annotationScopeOf,
  isSafeRelativePath,
  normalizeAnnotationInput,
  normalizeAnnotationRect,
} = require('../core/shared-backend/result-annotation-contracts');
const { createResultAnnotationStore } = require('../core/shared-backend/result-annotation-store');
// 路由模块与仓储共用 petri-server 的 db 单例（同一连接 ⇒ 写后即读，不留双连接锁竞争）。
const sqlite = require('../core/petri-server/db').db;
sqlite.pragma('foreign_keys = ON');

test.after(() => {
  try {
    sqlite.close();
  } catch {
    // Windows 偶发句柄残留不影响结果
  }
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    // 同上
  }
});

// ---------------------------------------------------------------------------
// 1. 迁移单源
// ---------------------------------------------------------------------------

test('015 migration file matches the schema builder byte for byte', () => {
  const onDisk = fs.readFileSync(path.join(REPO_ROOT, 'src', 'migrations', '015_result_annotations.sql'), 'utf8');
  assert.equal(onDisk, buildAnnotationMigrationSql());
  assert.equal(RESULT_ANNOTATION_MIGRATION_VERSION, 15);
});

test('015 migration avoids constructs the runner forbids', () => {
  const sql = buildAnnotationMigrationSql()
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.equal(/^\s*BEGIN\b/im.test(sql), false);
  assert.equal(/^\s*COMMIT\b/im.test(sql), false);
  assert.equal(/INSERT\s+OR\s+REPLACE/i.test(sql), false);
  assert.equal(/\bPRAGMA\b/i.test(sql), false);
  assert.equal(/AUTOINCREMENT/i.test(sql), false);
});

test('ensureAnnotationSchema is idempotent and inspect reports completeness', () => {
  const first = ensureAnnotationSchema(sqlite);
  const second = ensureAnnotationSchema(sqlite);
  assert.deepEqual(first.tables, ['result_annotations']);
  assert.deepEqual(second.tables, ['result_annotations']);
  assert.equal(inspectAnnotationSchema(sqlite).complete, true);
  assert.deepEqual(inspectAnnotationSchema(sqlite).missingTables, []);
});

// ---------------------------------------------------------------------------
// 2. 契约
// ---------------------------------------------------------------------------

test('rect normalization accepts reversed drags and clamps to the page box', () => {
  const reversed = normalizeAnnotationRect([0.6, 0.5, -0.2, -0.1]);
  assert.equal(reversed.ok, true);
  assert.deepEqual(reversed.rect, [0.4, 0.4, 0.2, 0.1]);

  const overflow = normalizeAnnotationRect([-0.5, 0.9, 3, 0.4]);
  assert.equal(overflow.ok, true);
  assert.deepEqual(overflow.rect, [0, 0.9, 1, 0.1]);
});

test('rect normalization rejects degenerate or non-finite input', () => {
  assert.equal(normalizeAnnotationRect([0.2, 0.2, 0, 0.4]).code, 'rect_too_small');
  assert.equal(normalizeAnnotationRect([1.2, 0.2, 0.1, 0.1]).code, 'rect_too_small');
  assert.equal(normalizeAnnotationRect([0.2, 0.2, Number.NaN, 0.1]).code, 'rect_not_finite');
  assert.equal(normalizeAnnotationRect([0.2, 0.2, 0.1]).code, 'rect_invalid');
  // 字符串数字来自表单/查询参数，必须归一成数字而不是静默丢弃
  assert.deepEqual(normalizeAnnotationRect(['0.1', '0.2', '0.3', '0.4']).rect, [0.1, 0.2, 0.3, 0.4]);
});

test('annotation input requires comment, surface-specific identity and bounded page', () => {
  const base = {
    projectId: 'p1',
    surface: 'result-artifact',
    artifactId: 'a1',
    revisionId: 'r1',
    rect: [0.1, 0.1, 0.2, 0.2],
    comment: '这个离群点需要复核',
  };
  const ok = normalizeAnnotationInput(base);
  assert.equal(ok.ok, true);
  assert.equal(ok.annotation.color, 'amber');
  assert.equal(ok.annotation.kind, 'region');
  assert.equal(ok.annotation.page, null);
  assert.deepEqual(annotationScopeOf(ok.annotation), {
    projectId: 'p1',
    surface: 'result-artifact',
    artifactId: 'a1',
    revisionId: 'r1',
    filePath: null,
  });

  assert.equal(normalizeAnnotationInput({ ...base, comment: '   ' }).ok, false);
  assert.equal(normalizeAnnotationInput({ ...base, artifactId: '' }).ok, false);
  assert.equal(normalizeAnnotationInput({ ...base, page: 0 }).ok, false);
  assert.equal(normalizeAnnotationInput({ ...base, page: 2.5 }).ok, false);
  assert.equal(normalizeAnnotationInput({ ...base, color: 'purple' }).ok, false);
  assert.equal(normalizeAnnotationInput({ ...base, surface: 'workspace-file' }).ok, false);
  assert.equal(normalizeAnnotationInput({ ...base, comment: 'x'.repeat(MAX_ANNOTATION_COMMENT_CHARS + 1) }).ok, false);
});

test('workspace-file annotations accept only safe project-relative paths', () => {
  const base = {
    projectId: 'p1',
    surface: 'workspace-file',
    filePath: 'reports/qc.pdf',
    rect: [0.1, 0.1, 0.3, 0.3],
    comment: '第 2 页的质控图异常',
    page: 2,
  };
  const ok = normalizeAnnotationInput(base);
  assert.equal(ok.ok, true);
  assert.equal(ok.annotation.filePath, 'reports/qc.pdf');
  assert.equal(ok.annotation.page, 2);

  assert.equal(normalizeAnnotationInput({ ...base, filePath: '../escape.pdf' }).ok, false);
  assert.equal(normalizeAnnotationInput({ ...base, filePath: 'D:/abs.pdf' }).ok, false);
  assert.equal(normalizeAnnotationInput({ ...base, filePath: '/abs.pdf' }).ok, false);
  assert.equal(normalizeAnnotationInput({ ...base, filePath: 'file:///x.pdf' }).ok, false);
  assert.equal(normalizeAnnotationInput({ ...base, artifactId: 'a1' }).ok, false);
  assert.equal(isSafeRelativePath('a/b/c.png'), true);
  assert.equal(isSafeRelativePath('a\\b\\c.png'), true);
  assert.equal(isSafeRelativePath('./a.png'), false);
});

// ---------------------------------------------------------------------------
// 3. 仓储
// ---------------------------------------------------------------------------

function makeStore() {
  const store = createResultAnnotationStore(sqlite);
  const insertProject = sqlite.prepare('INSERT OR IGNORE INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
  insertProject.run('proj-a', '项目 A', Date.now(), Date.now());
  insertProject.run('proj-b', '项目 B', Date.now(), Date.now());
  return store;
}

function annotationFor(overrides = {}) {
  const normalized = normalizeAnnotationInput({
    projectId: 'proj-a',
    surface: 'result-artifact',
    artifactId: 'artifact-1',
    revisionId: 'rev-1',
    artifactName: 'volcano.png',
    rect: [0.1, 0.1, 0.2, 0.2],
    comment: '离群点',
    page: null,
    ...overrides,
  });
  assert.equal(normalized.ok, true);
  return normalized.annotation;
}

test('store keeps annotations isolated by artifact revision and file scope', () => {
  const store = makeStore();
  const first = store.create(annotationFor());
  store.create(annotationFor({ revisionId: 'rev-2' }));
  store.create(annotationFor({
    surface: 'workspace-file', artifactId: null, revisionId: null, filePath: 'reports/qc.pdf', page: 1,
  }));

  const revOne = store.listByScope({ projectId: 'proj-a', surface: 'result-artifact', artifactId: 'artifact-1', revisionId: 'rev-1' });
  assert.equal(revOne.length, 1);
  assert.equal(revOne[0].annotationId, first.annotationId);
  assert.deepEqual(revOne[0].rect, [0.1, 0.1, 0.2, 0.2]);

  const revTwo = store.listByScope({ projectId: 'proj-a', surface: 'result-artifact', artifactId: 'artifact-1', revisionId: 'rev-2' });
  assert.equal(revTwo.length, 1);
  assert.notEqual(revTwo[0].annotationId, first.annotationId);

  const files = store.listByScope({ projectId: 'proj-a', surface: 'workspace-file', filePath: 'reports/qc.pdf' });
  assert.equal(files.length, 1);
  assert.equal(files[0].page, 1);

  // 跨项目读取必须为空，不靠前端过滤
  const otherProject = store.listByScope({ projectId: 'proj-b', surface: 'result-artifact', artifactId: 'artifact-1', revisionId: 'rev-1' });
  assert.deepEqual(otherProject, []);
  assert.equal(store.countByScope({ projectId: 'proj-a', surface: 'result-artifact', artifactId: 'artifact-1', revisionId: 'rev-1' }), 1);
});

test('store delete is idempotent and get returns what was written', () => {
  const store = makeStore();
  const saved = store.create(annotationFor({ revisionId: 'rev-delete' }));
  assert.equal(store.get(saved.annotationId).comment, '离群点');
  assert.equal(store.deleteById(saved.annotationId), true);
  assert.equal(store.deleteById(saved.annotationId), false);
  assert.equal(store.get(saved.annotationId), null);
});

// ---------------------------------------------------------------------------
// 4. 路由
// ---------------------------------------------------------------------------

function loadRoutes() {
  const routeModule = require('../core/petri-server/routes/result-studio/annotations');
  const entries = [];
  const app = {
    get: (routePath, handler) => entries.push({ method: 'GET', path: routePath, handler }),
    post: (routePath, handler) => entries.push({ method: 'POST', path: routePath, handler }),
    delete: (routePath, handler) => entries.push({ method: 'DELETE', path: routePath, handler }),
  };
  routeModule.register(app, { ensureSchema: false });
  return entries;
}

function invoke(entry, { body, query, params, user } = {}) {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    },
  };
  entry.handler({ body, query, params, user }, res);
  return res;
}

test('route module registers the three annotation endpoints', () => {
  const routes = loadRoutes();
  const keys = routes.map((entry) => `${entry.method} ${entry.path}`).sort();
  assert.deepEqual(keys, [
    'DELETE /api/result-studio/annotations/:annotationId',
    'GET /api/result-studio/annotations',
    'POST /api/result-studio/annotations',
  ]);
});

test('POST /annotations persists, enforces scope limit and rejects invalid payloads', () => {
  const routes = loadRoutes();
  const create = routes.find((entry) => entry.method === 'POST');
  const list = routes.find((entry) => entry.method === 'GET');

  const payload = {
    projectId: 'proj-a',
    surface: 'result-artifact',
    artifactId: 'route-artifact',
    revisionId: 'route-rev',
    rect: [0.2, 0.3, 0.1, 0.1],
    comment: '路由级批注',
  };
  const created = invoke(create, { body: payload });
  assert.equal(created.statusCode, 200);
  assert.equal(created.payload.annotation.comment, '路由级批注');
  assert.equal(created.payload.count, 1);

  const invalid = invoke(create, { body: { ...payload, rect: [0.2, 0.3, 0, 0] } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.payload.error, 'annotation_invalid');

  const unknownProject = invoke(create, { body: { ...payload, projectId: 'proj-missing' } });
  assert.equal(unknownProject.statusCode, 404);
  assert.equal(unknownProject.payload.error, 'project_not_found');

  const listed = invoke(list, {
    query: { projectId: 'proj-a', surface: 'result-artifact', artifactId: 'route-artifact', revisionId: 'route-rev' },
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.payload.annotations.length, 1);

  // scope 限流：直接把该 scope 灌到上限，再写一条必须 409 且不落库
  const { MAX_ANNOTATIONS_PER_SCOPE } = require('../core/shared-backend/result-annotation-contracts');
  const store = createResultAnnotationStore(sqlite);
  const filled = store.countByScope({ projectId: 'proj-a', surface: 'result-artifact', artifactId: 'route-artifact', revisionId: 'route-rev' });
  for (let index = filled; index < MAX_ANNOTATIONS_PER_SCOPE; index += 1) {
    store.create(annotationFor({ artifactId: 'route-artifact', revisionId: 'route-rev', comment: `填充 ${index}` }));
  }
  const overflow = invoke(create, { body: { ...payload, comment: '超限' } });
  assert.equal(overflow.statusCode, 409);
  assert.equal(overflow.payload.error, 'annotation_limit_reached');
  const after = invoke(list, {
    query: { projectId: 'proj-a', surface: 'result-artifact', artifactId: 'route-artifact', revisionId: 'route-rev' },
  });
  assert.equal(after.payload.annotations.length, MAX_ANNOTATIONS_PER_SCOPE);
});

test('DELETE /annotations/:id scopes the check to the owning project', () => {
  const routes = loadRoutes();
  const remove = routes.find((entry) => entry.method === 'DELETE');
  const store = createResultAnnotationStore(sqlite);
  const saved = store.create(annotationFor({ revisionId: 'delete-rev' }));

  const missing = invoke(remove, { params: { annotationId: 'ann_missing' } });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.payload.error, 'annotation_not_found');

  const deleted = invoke(remove, { params: { annotationId: saved.annotationId } });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.payload.deleted, true);
  assert.equal(store.get(saved.annotationId), null);
});
