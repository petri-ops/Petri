/**
 * BLOCK-254 A-2 — `result_annotations_list` 批注只读工具契约。
 *
 * 覆盖四层，任一层退化都必须红：
 * 1. fail-closed：projectId 缺失即拒绝（批注按项目隔离，不做跨项目猜测）。
 * 2. scope 校验：surface 合法值、result-artifact 需 artifactId、workspace-file 需安全相对路径。
 * 3. 有界与诚实：最近优先、limit 上限、评论截断、空 scope 回 available:false 并禁止编造。
 * 4. 注册面：schema 在 tool-defs 里、元数据 readOnly、执行契约 sideEffect=none。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);

const {
  tool_result_annotations_list,
  toReadableAnnotation,
  describeAnchor,
  formatPercentRect,
  MAX_ANNOTATIONS,
  MAX_ANNOTATIONS_HARD_CAP,
  MAX_COMMENT_CHARS,
} = require('../core/petri-server/agent-tools/result-annotation-tools.js');

function row(overrides = {}) {
  return {
    annotationId: 'ann-1',
    projectId: 'proj-a',
    surface: 'result-artifact',
    artifactId: 'art-1',
    revisionId: 'rev-1',
    filePath: null,
    kind: 'region',
    page: 2,
    rect: [0.1, 0.2, 0.3, 0.1],
    comment: '离群点需要复核',
    color: 'amber',
    author: 'user',
    createdAt: '2026-10-24T00:00:00.000Z',
    ...overrides,
  };
}

test('BLOCK-254 A-2 — 缺 projectId 直接拒绝（项目隔离 fail-closed）', async () => {
  const result = await tool_result_annotations_list({ artifactId: 'art-1' }, { listByScope: () => { throw new Error('不应被调用'); } });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'missing_projectId');
  assert.match(result.message, /项目隔离/);
});

test('BLOCK-254 A-2 — scope 校验：surface / artifactId / filePath 安全', async () => {
  const noSurface = await tool_result_annotations_list({ projectId: 'proj-a' }, { listByScope: () => [] });
  assert.equal(noSurface.error, 'surface_invalid');

  const badSurface = await tool_result_annotations_list({ projectId: 'proj-a', surface: 'annotation' }, { listByScope: () => [] });
  assert.equal(badSurface.error, 'surface_invalid');

  const noArtifact = await tool_result_annotations_list({ projectId: 'proj-a', surface: 'result-artifact' }, { listByScope: () => [] });
  assert.equal(noArtifact.error, 'missing_artifactId');

  const escape = await tool_result_annotations_list(
    { projectId: 'proj-a', surface: 'workspace-file', filePath: '../secrets.txt' },
    { listByScope: () => [] },
  );
  assert.equal(escape.error, 'file_path_invalid');
});

test('BLOCK-254 A-2 — 最近优先 + limit + 截断标注 + 评论有界', async () => {
  const rows = Array.from({ length: 7 }, (_, index) => row({
    annotationId: `ann-${index + 1}`,
    comment: index === 6 ? '长'.repeat(MAX_COMMENT_CHARS + 50) : `批注 ${index + 1}`,
  }));
  const result = await tool_result_annotations_list(
    { projectId: 'proj-a', artifactId: 'art-1', revisionId: 'rev-1', limit: 3 },
    { listByScope: () => rows },
  );

  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.total, 7);
  assert.equal(result.returned, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.order, 'recent-first');
  // 最近的是第 7 条（含超长评论），forward 顺序应为 7 → 6 → 5
  assert.equal(result.annotations[0].index, 1);
  assert.ok(result.annotations[0].comment.length <= MAX_COMMENT_CHARS + 1, '评论必须被截断');
  assert.match(result.annotations[0].comment, /…$/);
  assert.match(result.message, /共 7 条/);
  assert.match(result.message, /原始产物文件未被修改/);
});

test('BLOCK-254 A-2 — limit 硬顶与非法值收敛', async () => {
  const rows = Array.from({ length: 60 }, (_, index) => row({ annotationId: `ann-${index}` }));
  const over = await tool_result_annotations_list(
    { projectId: 'proj-a', artifactId: 'art-1', limit: 999 },
    { listByScope: () => rows },
  );
  assert.ok(over.returned <= MAX_ANNOTATIONS_HARD_CAP, `limit 应被硬顶到 ${MAX_ANNOTATIONS_HARD_CAP}`);

  const bad = await tool_result_annotations_list(
    { projectId: 'proj-a', artifactId: 'art-1', limit: -5 },
    { listByScope: () => rows },
  );
  assert.ok(bad.returned <= MAX_ANNOTATIONS, `非法 limit 应回落默认 ${MAX_ANNOTATIONS}`);
});

test('BLOCK-254 A-2 — 空 scope 如实 available:false 并禁止编造', async () => {
  const result = await tool_result_annotations_list(
    { projectId: 'proj-a', surface: 'workspace-file', filePath: 'notes/a.md' },
    { listByScope: () => [] },
  );
  assert.equal(result.ok, true);
  assert.equal(result.available, false);
  assert.deepEqual(result.annotations, []);
  assert.match(result.message, /不要凭空描述批注内容/);
});

test('BLOCK-254 A-2 — 锚点/坐标渲染：页优先、百分比四元', () => {
  assert.equal(describeAnchor({ page: 3, surface: 'result-artifact' }), '第 3 页');
  assert.equal(describeAnchor({ page: null, surface: 'result-artifact' }), '图像区域');
  assert.equal(describeAnchor({ page: null, surface: 'workspace-file' }), '文件区域');
  assert.equal(formatPercentRect([0.1, 0.2, 0.3, 0.4]), '(10%, 20%, 30%×40%)');

  const readable = toReadableAnnotation(row({ kind: 'mosaic', comment: '遮住姓名' }), 0);
  assert.equal(readable.kindLabel, '马赛克');
  assert.equal(readable.anchor, '第 2 页');
  assert.equal(readable.index, 1);
});

test('BLOCK-254 A-2 — 真实 store 读取：scope 隔离（同 artifact 不同 project 互不可见）', async () => {
  const Database = require('better-sqlite3');
  const { createResultAnnotationStore } = require('../core/shared-backend/result-annotation-store.js');
  const db = new Database(':memory:');
  const store = createResultAnnotationStore(db);

  const base = {
    contractVersion: 1,
    projectId: 'proj-a',
    conversationId: null,
    surface: 'result-artifact',
    artifactId: 'art-1',
    revisionId: 'rev-1',
    filePath: null,
    artifactName: 'volcano.png',
    kind: 'text',
    page: null,
    rect: [0.2, 0.2, 0.2, 0.1],
    comment: '这段结论要复核',
    color: 'sky',
    author: 'user',
  };
  store.create({ ...base });
  store.create({ ...base, kind: 'mosaic', comment: '遮住姓名', color: 'rose' });

  const mine = await tool_result_annotations_list(
    { projectId: 'proj-a', artifactId: 'art-1', revisionId: 'rev-1' },
    { store },
  );
  assert.equal(mine.ok, true);
  assert.equal(mine.total, 2);
  assert.deepEqual(mine.annotations.map((entry) => entry.kindLabel).sort(), ['文本', '马赛克']);

  const otherProject = await tool_result_annotations_list(
    { projectId: 'proj-b', artifactId: 'art-1', revisionId: 'rev-1' },
    { store },
  );
  assert.equal(otherProject.available, false);
  assert.equal(otherProject.total, 0);

  const otherRevision = await tool_result_annotations_list(
    { projectId: 'proj-a', artifactId: 'art-1', revisionId: 'rev-2' },
    { store },
  );
  assert.equal(otherRevision.total, 0, '坐标不可跨版本复用，revision 必须逐字匹配');

  db.close();
});

test('BLOCK-254 A-2 — 注册面：schema / 只读元数据 / 只读执行契约', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block254-registry-'));
  process.env.PETRI_DB_PATH = path.join(sandbox, 'block254.db');
  process.env.PETRI_LOCAL_DATA_DIR = sandbox;
  const { runMigrations } = require('../src/migration-runner');
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  await runMigrations(process.env.PETRI_DB_PATH, path.join(repoRoot, 'src', 'migrations'));

  const registry = require('../core/petri-server/agent-tools/registry.js');
  const entry = registry.getToolEntry('result_annotations_list');
  assert.ok(entry, '工具必须已注册到 registry');
  assert.equal(entry.definition.function.name, 'result_annotations_list');
  assert.ok(entry.definition.function.parameters.required.includes('projectId'), 'projectId 必须是必填参数');

  const contract = registry.getToolContract('result_annotations_list');
  assert.equal(contract.sideEffect, 'none');
  assert.equal(contract.riskTier, 'R1');

  const { getToolMetadata } = require('../core/petri-server/agent-tools/tool-metadata.js');
  const metadata = getToolMetadata('result_annotations_list');
  assert.ok(metadata, '必须在 TOOL_METADATA 里登记');
  assert.equal(metadata.readOnly, true);
  assert.equal(metadata.needsApproval, false);
  assert.equal(metadata.riskLevel, 'low');

  const handler = registry.getToolHandler('result_annotations_list');
  assert.equal(typeof handler, 'function');
});
