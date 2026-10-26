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
  RESULT_ANNOTATION_ANCHOR_MIGRATION_VERSION,
  RESULT_ANNOTATION_ENTRY_MIGRATION_VERSION,
  buildAnnotationMigrationSql,
  buildAnnotationAnchorMigrationSql,
  buildAnnotationEntryMigrationSql,
  hasAnnotationAnchorColumn,
  hasAnnotationEntryColumn,
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

test('BLOCK-238/254 — 批注 kind 白名单：ellipse / arrow / text / mosaic / text-selection 被接受，未知 kind 仍拒绝', async () => {
  const { ANNOTATION_KINDS, normalizeAnnotationInput } = require('../core/shared-backend/result-annotation-contracts.js');
  assert.deepEqual([...ANNOTATION_KINDS], ['region', 'ellipse', 'arrow', 'text', 'mosaic', 'text-selection', 'freehand']);

  for (const kind of ['ellipse', 'arrow', 'text', 'mosaic']) {
    const result = normalizeAnnotationInput({
      projectId: 'p1',
      surface: 'result-artifact',
      artifactId: 'a1',
      revisionId: 'r1',
      kind,
      rect: [0.1, 0.2, 0.3, 0.4],
      comment: '形状批注',
    });
    assert.equal(result.ok, true, kind + ' 应被接受：' + JSON.stringify(result.errors || []));
    assert.equal(result.annotation.kind, kind);
  }

  // BLOCK-264（C-43）— 契约 v2：freehand 已是合法 kind（path 点序列几何）。
  // 但混用 rect 仍拒绝（三态互斥），未知 kind 照旧拒绝。
  const mixed = normalizeAnnotationInput({
    projectId: 'p1',
    surface: 'result-artifact',
    artifactId: 'a1',
    revisionId: 'r1',
    kind: 'freehand',
    rect: [0.1, 0.2, 0.3, 0.4],
    comment: '混用 rect',
  });
  assert.equal(mixed.ok, false);
  assert.ok(mixed.errors.some((e) => e.code === 'rect_unexpected'));
});

test('BLOCK-254 A-1 — 文字/马赛克批注经 store 落库并按 kind 回读（零迁移）', async () => {
  const { normalizeAnnotationInput, ANNOTATION_KINDS } = require('../core/shared-backend/result-annotation-contracts.js');
  const { createResultAnnotationStore } = require('../core/shared-backend/result-annotation-store.js');
  const store = createResultAnnotationStore(sqlite);
  const scope = { projectId: 'p1', surface: 'workspace-file', filePath: 'notes/block254-shapes.md' };

  for (const kind of ['text', 'mosaic']) {
    assert.ok(ANNOTATION_KINDS.includes(kind), kind + ' 必须已在白名单内');
    const normalized = normalizeAnnotationInput({
      ...scope,
      kind,
      rect: [0.2, 0.3, 0.25, 0.15],
      comment: kind === 'text' ? '这段结论需要复核' : '遮住患者姓名',
    });
    assert.equal(normalized.ok, true, kind + ' 归一化失败：' + JSON.stringify(normalized.errors || []));
    const saved = store.create(normalized.annotation);
    assert.equal(saved.kind, kind);
    assert.deepEqual(saved.rect, [0.2, 0.3, 0.25, 0.15]);

    const listed = store.listByScope(scope);
    const roundTrip = listed.find((entry) => entry.annotationId === saved.annotationId);
    assert.ok(roundTrip, kind + ' 回读缺失');
    assert.equal(roundTrip.kind, kind);
    assert.equal(roundTrip.comment, normalized.annotation.comment);
  }

  // 同一 scope 两种 kind 共享上限计数，不各算一套。
  assert.equal(store.countByScope(scope), 2);
});

test('BLOCK-254 P5 — 018 迁移与 schema 生成器逐字节一致（只加一列）', () => {
  const file = path.join(REPO_ROOT, 'src', 'migrations', '018_annotation_text_anchor.sql');
  const sql = fs.readFileSync(file, 'utf8');
  assert.equal(sql, buildAnnotationAnchorMigrationSql());
  assert.equal(RESULT_ANNOTATION_ANCHOR_MIGRATION_VERSION, 18);
  assert.match(sql, /ALTER TABLE result_annotations ADD COLUMN anchor_json TEXT;/);
  // 015 的建表语句不得被改动（本列只走 ALTER）。
  assert.ok(!buildAnnotationMigrationSql().includes('anchor_json'), '015 不应包含锚点列');
  // 迁移目录里的真实库已由 runMigrations 应用，列必须就位。
  assert.equal(hasAnnotationAnchorColumn(sqlite), true);
});

test('BLOCK-254 P5 — 文本锚点：合法形态、行号校验、与 rect 互斥', () => {
  const { normalizeAnnotationInput, MAX_ANCHOR_QUOTE_CHARS } = require('../core/shared-backend/result-annotation-contracts.js');

  const base = {
    projectId: 'p1',
    surface: 'workspace-file',
    filePath: 'notes/plan.md',
    kind: 'text-selection',
    comment: '这段结论需要复核',
    anchor: { startLine: 12, endLine: 14, startColumn: 3, endColumn: 20, quote: '结论：差异基因数目偏低', language: 'md' },
  };
  const ok = normalizeAnnotationInput(base);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors || []));
  assert.deepEqual(ok.annotation.rect, []);
  assert.equal(ok.annotation.anchor.kind, 'text-range');
  assert.equal(ok.annotation.anchor.startLine, 12);
  assert.equal(ok.annotation.anchor.endLine, 14);
  assert.equal(ok.annotation.anchor.language, 'md');
  assert.equal(ok.annotation.page, null);

  // 只带 startLine（单行选区）也合法，列可省略。
  const singleLine = normalizeAnnotationInput({
    ...base,
    anchor: { startLine: 7, endLine: 7, quote: '单行片段' },
  });
  assert.equal(singleLine.ok, true);
  assert.equal(singleLine.annotation.anchor.startColumn, null);

  // 缺原文 → 锚点无法校验。
  const noQuote = normalizeAnnotationInput({ ...base, anchor: { startLine: 1, endLine: 1 } });
  assert.equal(noQuote.ok, false);
  assert.ok(noQuote.errors.some((error) => error.code === 'anchor_quote_required'));

  // 行号倒置 / 非法行号。
  const inverted = normalizeAnnotationInput({ ...base, anchor: { startLine: 9, endLine: 3, quote: 'x' } });
  assert.equal(inverted.ok, false);
  assert.ok(inverted.errors.some((error) => error.code === 'anchor_range_inverted'));

  const badLine = normalizeAnnotationInput({ ...base, anchor: { startLine: 0, endLine: 2, quote: 'x' } });
  assert.equal(badLine.ok, false);
  assert.ok(badLine.errors.some((error) => error.code === 'anchor_line_invalid'));

  // 原文有界。
  const tooLong = normalizeAnnotationInput({ ...base, anchor: { startLine: 1, endLine: 1, quote: 'x'.repeat(MAX_ANCHOR_QUOTE_CHARS + 1) } });
  assert.equal(tooLong.ok, false);
  assert.ok(tooLong.errors.some((error) => error.code === 'anchor_quote_too_long'));

  // 两种定位方式互斥：文本锚点不收 rect，区域批注不收 anchor。
  const withRect = normalizeAnnotationInput({ ...base, rect: [0.1, 0.1, 0.2, 0.2] });
  assert.equal(withRect.ok, false);
  assert.ok(withRect.errors.some((error) => error.code === 'rect_unexpected'));

  const areaWithAnchor = normalizeAnnotationInput({
    projectId: 'p1',
    surface: 'workspace-file',
    filePath: 'notes/plan.md',
    kind: 'region',
    rect: [0.1, 0.1, 0.2, 0.2],
    comment: '区域批注',
    anchor: { startLine: 1, endLine: 1, quote: 'x' },
  });
  assert.equal(areaWithAnchor.ok, false);
  assert.ok(areaWithAnchor.errors.some((error) => error.code === 'anchor_unexpected'));

  // 结果产物没有文本行，锚点批注必须拒绝。
  const onArtifact = normalizeAnnotationInput({
    projectId: 'p1',
    surface: 'result-artifact',
    artifactId: 'a1',
    kind: 'text-selection',
    comment: '错面',
    anchor: { startLine: 1, endLine: 1, quote: 'x' },
  });
  assert.equal(onArtifact.ok, false);
  assert.ok(onArtifact.errors.some((error) => error.code === 'anchor_surface_invalid'));

  // PDF 的页号对文本锚点无意义。
  const withPage = normalizeAnnotationInput({ ...base, page: 3 });
  assert.equal(withPage.ok, false);
  assert.ok(withPage.errors.some((error) => error.code === 'page_unexpected'));
});

test('BLOCK-254 P5 — 文本锚点经 store 往返：rect 为空数组、anchor 完整、与区域批注共存同一 scope', () => {
  const { normalizeAnnotationInput } = require('../core/shared-backend/result-annotation-contracts.js');
  const { createResultAnnotationStore } = require('../core/shared-backend/result-annotation-store.js');
  const store = createResultAnnotationStore(sqlite);
  const scope = { projectId: 'p1', surface: 'workspace-file', filePath: 'notes/anchor-round-trip.md' };

  const text = normalizeAnnotationInput({
    ...scope,
    kind: 'text-selection',
    comment: '这段要复核',
    anchor: { startLine: 5, endLine: 6, quote: '原句片段', language: 'md' },
  });
  assert.equal(text.ok, true);
  const savedText = store.create(text.annotation);
  assert.deepEqual(savedText.rect, []);
  assert.equal(savedText.anchor.startLine, 5);
  assert.equal(savedText.anchor.quote, '原句片段');

  const area = normalizeAnnotationInput({ ...scope, kind: 'region', rect: [0.2, 0.2, 0.1, 0.1], comment: '区域' });
  assert.equal(area.ok, true);
  const savedArea = store.create(area.annotation);
  assert.equal(savedArea.anchor, null, '区域批注不得带锚点');

  const listed = store.listByScope(scope);
  assert.equal(listed.length, 2);
  const textRow = listed.find((entry) => entry.annotationId === savedText.annotationId);
  const areaRow = listed.find((entry) => entry.annotationId === savedArea.annotationId);
  assert.equal(textRow.kind, 'text-selection');
  assert.deepEqual(textRow.rect, []);
  assert.equal(textRow.anchor.kind, 'text-range');
  assert.equal(areaRow.anchor, null);
  assert.deepEqual(areaRow.rect, [0.2, 0.2, 0.1, 0.1]);
});

test('BLOCK-254 P6 — 019 迁移与 schema 生成器逐字节一致（只加 entry_id）', () => {
  const file = path.join(REPO_ROOT, 'src', 'migrations', '019_annotation_entry_owner.sql');
  const sql = fs.readFileSync(file, 'utf8');
  assert.equal(sql, buildAnnotationEntryMigrationSql());
  assert.equal(RESULT_ANNOTATION_ENTRY_MIGRATION_VERSION, 19);
  assert.match(sql, /ALTER TABLE result_annotations ADD COLUMN entry_id TEXT;/);
  assert.ok(!buildAnnotationMigrationSql().includes('entry_id'), '015 不应包含条目归属列');
  assert.equal(hasAnnotationEntryColumn(sqlite), true);
});

test('BLOCK-254 P6 — 速记面：entryId 必填，且不接受 filePath / artifactId / revisionId', () => {
  const { normalizeAnnotationInput, annotationScopeOf } = require('../core/shared-backend/result-annotation-contracts.js');
  const base = {
    projectId: 'p1',
    surface: 'scratchpad-entry',
    kind: 'region',
    rect: [0.1, 0.1, 0.2, 0.2],
    comment: '圈出异常点',
  };

  const missing = normalizeAnnotationInput(base);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.code === 'entry_id_required'));

  const ok = normalizeAnnotationInput({ ...base, entryId: 'sp_1' });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors || []));
  assert.equal(ok.annotation.entryId, 'sp_1');
  assert.equal(ok.annotation.filePath, null);
  assert.deepEqual(annotationScopeOf(ok.annotation), {
    projectId: 'p1',
    surface: 'scratchpad-entry',
    artifactId: null,
    revisionId: null,
    filePath: null,
    entryId: 'sp_1',
  });

  const withPath = normalizeAnnotationInput({ ...base, entryId: 'sp_1', filePath: 'result.png' });
  assert.equal(withPath.ok, false);
  assert.ok(withPath.errors.some((error) => error.code === 'file_path_unexpected'));

  const withArtifact = normalizeAnnotationInput({ ...base, entryId: 'sp_1', artifactId: 'a1' });
  assert.equal(withArtifact.ok, false);
  assert.ok(withArtifact.errors.some((error) => error.code === 'artifact_id_unexpected'));

  const withRevision = normalizeAnnotationInput({ ...base, entryId: 'sp_1', revisionId: 'r1' });
  assert.equal(withRevision.ok, false);
  assert.ok(withRevision.errors.some((error) => error.code === 'revision_id_unexpected'));

  // 反向：别的面混入 entryId 一律拒绝，避免一条批注两种归属。
  const fileWithEntry = normalizeAnnotationInput({
    projectId: 'p1',
    surface: 'workspace-file',
    filePath: 'notes/a.md',
    kind: 'region',
    rect: [0.1, 0.1, 0.2, 0.2],
    comment: 'x',
    entryId: 'sp_1',
  });
  assert.equal(fileWithEntry.ok, false);
  assert.ok(fileWithEntry.errors.some((error) => error.code === 'entry_id_unexpected'));
});

test('BLOCK-254 P6 — 速记批注经 store 往返，且与工作区/产物 scope 完全隔离', () => {
  const { normalizeAnnotationInput } = require('../core/shared-backend/result-annotation-contracts.js');
  const { createResultAnnotationStore } = require('../core/shared-backend/result-annotation-store.js');
  const store = createResultAnnotationStore(sqlite);
  const scope = { projectId: 'p1', surface: 'scratchpad-entry', entryId: 'sp_roundtrip' };

  const normalized = normalizeAnnotationInput({
    ...scope,
    kind: 'region',
    rect: [0.3, 0.4, 0.2, 0.1],
    comment: '这块需要复核',
    color: 'rose',
  });
  assert.equal(normalized.ok, true);
  const saved = store.create(normalized.annotation);
  assert.equal(saved.entryId, 'sp_roundtrip');
  assert.equal(saved.filePath, null);
  assert.equal(saved.artifactId, null);

  assert.equal(store.listByScope(scope).length, 1);
  // 换条目 / 换面都不可见：scope 判定唯一，不靠前端过滤。
  assert.equal(store.listByScope({ ...scope, entryId: 'sp_other' }).length, 0);
  assert.equal(store.listByScope({ projectId: 'p1', surface: 'workspace-file', filePath: 'a.md' }).length, 0);
  assert.equal(store.countByScope({ projectId: 'p2', surface: 'scratchpad-entry', entryId: 'sp_roundtrip' }), 0);
});

test('BLOCK-254 P6 — GET /annotations?surface=scratchpad-entry 按 entryId 过滤并校验必填', () => {
  const { normalizeAnnotationInput } = require('../core/shared-backend/result-annotation-contracts.js');
  const routes = loadRoutes();
  const list = routes.find((entry) => entry.method === 'GET');
  const store = makeStore();

  const normalized = normalizeAnnotationInput({
    projectId: 'proj-a',
    surface: 'scratchpad-entry',
    entryId: 'sp_route',
    kind: 'region',
    rect: [0.1, 0.1, 0.2, 0.2],
    comment: '路由读写',
  });
  assert.equal(normalized.ok, true);
  store.create(normalized.annotation);

  const listed = invoke(list, {
    query: { projectId: 'proj-a', surface: 'scratchpad-entry', entryId: 'sp_route' },
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.payload.annotations.length, 1);
  assert.equal(listed.payload.annotations[0].entryId, 'sp_route');

  const missing = invoke(list, { query: { projectId: 'proj-a', surface: 'scratchpad-entry' } });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.payload.error, 'entry_id_required');

  const otherEntry = invoke(list, {
    query: { projectId: 'proj-a', surface: 'scratchpad-entry', entryId: 'sp_none' },
  });
  assert.equal(otherEntry.statusCode, 200);
  assert.equal(otherEntry.payload.annotations.length, 0);
});

test('BLOCK-254 P7 — 锚点单位：缺省 line，段落/表格行透传，非法值拒绝', () => {
  const { normalizeAnnotationInput, ANCHOR_UNITS } = require('../core/shared-backend/result-annotation-contracts.js');
  assert.deepEqual([...ANCHOR_UNITS], ['line', 'paragraph', 'row']);

  const base = {
    projectId: 'p1',
    surface: 'workspace-file',
    filePath: 'docs/report.docx',
    kind: 'text-selection',
    comment: '这段需要复核',
  };

  const implicit = normalizeAnnotationInput({ ...base, anchor: { startLine: 3, endLine: 3, quote: 'x' } });
  assert.equal(implicit.ok, true, JSON.stringify(implicit.errors || []));
  assert.equal(implicit.annotation.anchor.unit, 'line', '缺省必须是 line，保持 P5 行为');

  const paragraph = normalizeAnnotationInput({
    ...base,
    anchor: { unit: 'paragraph', startLine: 5, endLine: 5, quote: 'Methods 段落原文' },
  });
  assert.equal(paragraph.ok, true);
  assert.equal(paragraph.annotation.anchor.unit, 'paragraph');

  const row = normalizeAnnotationInput({
    ...base,
    anchor: { unit: 'row', startLine: 4, endLine: 4, quote: 'TP53 | 0.001' },
  });
  assert.equal(row.ok, true);
  assert.equal(row.annotation.anchor.unit, 'row');

  const bad = normalizeAnnotationInput({
    ...base,
    anchor: { unit: 'slide', startLine: 1, endLine: 1, quote: 'x' },
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((error) => error.code === 'anchor_unit_invalid'));
});

test('BLOCK-254 P7 — 段落/表格行锚点经 store 往返保单位（同一 scope 可与源码行批注共存）', () => {
  const { normalizeAnnotationInput } = require('../core/shared-backend/result-annotation-contracts.js');
  const { createResultAnnotationStore } = require('../core/shared-backend/result-annotation-store.js');
  const store = createResultAnnotationStore(sqlite);
  const scope = { projectId: 'p1', surface: 'workspace-file', filePath: 'docs/block254-office.docx' };

  const paragraph = normalizeAnnotationInput({
    ...scope,
    kind: 'text-selection',
    comment: '这一段结论要复核',
    anchor: { unit: 'paragraph', startLine: 5, endLine: 5, quote: 'Methods 段落原文' },
  });
  assert.equal(paragraph.ok, true);
  const savedParagraph = store.create(paragraph.annotation);
  assert.equal(savedParagraph.anchor.unit, 'paragraph');
  assert.equal(savedParagraph.anchor.startLine, 5);

  const row = normalizeAnnotationInput({
    ...scope,
    kind: 'text-selection',
    comment: '这一行数值异常',
    anchor: { unit: 'row', startLine: 4, endLine: 4, quote: 'TP53 | 0.001' },
  });
  assert.equal(row.ok, true);
  const savedRow = store.create(row.annotation);

  const listed = store.listByScope(scope);
  assert.equal(listed.length, 2);
  const paragraphRow = listed.find((entry) => entry.annotationId === savedParagraph.annotationId);
  const tableRow = listed.find((entry) => entry.annotationId === savedRow.annotationId);
  assert.equal(paragraphRow.anchor.unit, 'paragraph');
  assert.equal(tableRow.anchor.unit, 'row');
  assert.deepEqual([...paragraphRow.rect], [], '锚点批注不带区域坐标');
});

// ---------- BLOCK-264（C-43）契约 v2：freehand 画笔 ----------

test('BLOCK-264 C-43 — freehand：path 归一化/抽稀/三态互斥/store 往返', async () => {
  const { normalizeAnnotationInput, MAX_FREEHAND_POINTS } = require('../core/shared-backend/result-annotation-contracts.js');
  const { createResultAnnotationStore } = require('../core/shared-backend/result-annotation-store.js');

  // 合法路径
  const ok = normalizeAnnotationInput({
    projectId: 'p1', surface: 'workspace-file', filePath: 'plot.png',
    kind: 'freehand', path: [[0.1, 0.1], [0.5, 0.2], [0.8, 0.5]], comment: '圈出趋势',
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors || []));
  assert.equal(ok.annotation.contractVersion, 2);
  assert.deepEqual(ok.annotation.rect, []);
  assert.equal(ok.annotation.path.length, 3);

  // 单点拒绝；点数超限等距抽稀保留首尾
  const single = normalizeAnnotationInput({ projectId: 'p1', surface: 'workspace-file', filePath: 'p.png', kind: 'freehand', path: [[0, 0]], comment: 'x' });
  assert.equal(single.ok, false);
  assert.equal(single.errors[0].code, 'path_invalid');
  const long = normalizeAnnotationInput({ projectId: 'p1', surface: 'workspace-file', filePath: 'p.png', kind: 'freehand', path: Array.from({ length: MAX_FREEHAND_POINTS + 100 }, (_, i) => [i / 700, 0.4]), comment: '长笔迹' });
  assert.equal(long.ok, true);
  assert.equal(long.annotation.path.length, MAX_FREEHAND_POINTS);
  assert.deepEqual(long.annotation.path[0], long.annotation.path.length > 0 ? [0, 0.4] : []);

  // 非 finite 点拒绝
  const nan = normalizeAnnotationInput({ projectId: 'p1', surface: 'workspace-file', filePath: 'p.png', kind: 'freehand', path: [[0, 0], ['x', 0.5]], comment: 'x' });
  assert.equal(nan.ok, false);

  // store 往返（真实 SQLite）
  const { getDatabase } = require('better-sqlite3');
  const store = createResultAnnotationStore(sqlite);
  const scope = { projectId: 'p1', surface: 'workspace-file', filePath: 'plot.png' };
  const created = (() => { try { return { ok: true, annotation: store.create({ ...ok.annotation, author: 'tester' }) } } catch (e) { return { ok: false, errors: [{ message: e.message }] } } })();
  assert.equal(created.ok, true, JSON.stringify(created.errors || []));
  const list = store.listByScope(scope);
  const free = list.find((row) => row.kind === 'freehand');
  assert.ok(free, 'freehand 应入库');
  assert.equal(free.path.length, 3);
  assert.deepEqual(free.path[0], [0.1, 0.1]);
});
