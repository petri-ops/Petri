// BLOCK-124 P1 契约测试 — codegraph 双工具（红绿先行：本文件先于实现落盘）
// 契约锚点：docs/block-124-harness-productization-plan.md §3.1（C-13；D1-D5 裁决）
// 覆盖：七面注册恒等（defs/contracts/metadata/动词/fixture）+ handler 行为
// （根解析走 withWorkspace 双闸 / 输出有界截断 / too_many_files 诚实拒绝 / 缺参 fail-closed）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'biof3-server');

// 自举临时 DB（agent-tool-registry.test.mjs 同款）：registry 链路 require query-tools →
// db.js 在缺最新 schema 时抛 no such table: projects；BIOF3_DB_PATH 须在 require 前生效。
{
  const fs = require_('fs');
  const os = require_('os');
  const nodePath = require_('path');
  const Database = require_(R_SERVER + '/node_modules/better-sqlite3');
  const tempDbDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'b124-codegraph-db-'));
  const boot = new Database(nodePath.join(tempDbDir, 'biof3.db'));
  const migrationsDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(nodePath.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = nodePath.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

function seedProject() {
  const root = mkdtempSync(join(tmpdir(), 'codegraph-tools-fx-'));
  mkdirSync(join(root, 'lib'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'lib', 'util.js'), 'exports.safeDivide = (a, b) => (b === 0 ? null : a / b);\nexports.legacyRound = (x) => x;\n');
  writeFileSync(join(root, 'app.js'), "const { safeDivide } = require('./lib/util');\nconsole.log(safeDivide(1, 2));\n");
  writeFileSync(join(root, 'ui.mjs'), "import { legacyRound } from './lib/util.js';\nconsole.log('imports but never calls');\n");
  writeFileSync(join(root, 'test', 'util.test.js'), "const { safeDivide } = require('../lib/util');\nif (safeDivide(1, 0) !== null) throw new Error('x');\n");
  return root;
}

function makeCtx(root, overrides = {}) {
  return {
    projectId: 'p_test_1',
    userId: 'u1',
    ...overrides,
  };
}

function makeTools(root) {
  const { createCodegraphTools } = require_('../core/biof3-server/agent-tools/codegraph-tools.js');
  return createCodegraphTools({
    dbProvider: () => ({
      getProject: (id) => (id === 'p_test_1' ? { id, user_id: 'u1', status: 'active', workspace_path: root } : null),
    }),
  });
}

test('七面注册恒等：defs / contracts(sideEffect=none) / metadata(只读) / 后端动词 / fixture 标签与图标', () => {
  const { TOOL_DEFS } = require_('../core/biof3-server/agent-tools/tool-defs.js');
  const names = new Set(TOOL_DEFS.map((t) => t.function && t.function.name));
  assert.ok(names.has('codegraph_who_imports'), 'codegraph_who_imports def 在场');
  assert.ok(names.has('codegraph_classify_edges'), 'codegraph_classify_edges def 在场');

  const { getToolContract } = require_('../core/biof3-server/agent-tools/registry.js');
  for (const name of ['codegraph_who_imports', 'codegraph_classify_edges']) {
    const c = getToolContract(name);
    assert.ok(c, `${name} contract 在场`);
    assert.equal(c.sideEffect, 'none', `${name} 只读`);
    assert.equal(c.category, 'workspace');
  }

  const { getToolMetadata } = require_('../core/biof3-server/agent-tools/tool-metadata.js');
  for (const name of ['codegraph_who_imports', 'codegraph_classify_edges']) {
    const m = getToolMetadata(name);
    assert.ok(m, `${name} metadata 在场`);
    assert.equal(m.readOnly, true);
    assert.equal(m.destructive, false);
  }

  const { TOOL_ACTIVITY_VERBS } = require_('../core/biof3-server/agent-tools/tool-events.js');
  assert.ok(TOOL_ACTIVITY_VERBS['codegraph_who_imports'], '后端动词在场');
  assert.ok(TOOL_ACTIVITY_VERBS['codegraph_classify_edges'], '后端动词在场');

  const fixture = JSON.parse(readFileSync(join('test', 'fixtures', 'tool-activity-labels.json'), 'utf8'));
  assert.ok(fixture['codegraph_who_imports'] && fixture['codegraph_who_imports'].label, 'fixture 标签在场');
  assert.ok(fixture['codegraph_classify_edges'] && fixture['codegraph_classify_edges'].icon, 'fixture 图标在场');

  // 前端 VERBS/ICONS 与 fixture 同步（源文本锚点；行为级由 toolActivity.test.ts 经 fixture 钉住）
  const ts = readFileSync(join('frontend', 'src', 'components', 'copilot', 'toolActivity.ts'), 'utf8');
  assert.ok(ts.includes('"codegraph_who_imports"'), '前端 VERBS 在场');
  assert.ok(ts.includes('git-branch'), '前端 ICONS 在场');
});

test('who_imports：真实临时项目 → 生产/测试/导入未用三态分类 + USED_TEST 反向测试面', async () => {
  const root = seedProject();
  try {
    const tools = makeTools(root);
    const r = await tools.whoImports({ symbol: 'safeDivide' }, makeCtx(root));
    assert.equal(r.ok, true);
    assert.equal(r.available, true);
    assert.equal(r.totalHits, 2, 'app.js + util.test.js 两处');
    assert.deepEqual(r.kindCounts, { USED_PROD: 1, USED_TEST: 1, UNUSED: 0 });
    const files = r.hits.map((h) => h.file).sort();
    assert.deepEqual(files, ['app.js', 'test/util.test.js']);
    assert.match(r.message, /safeDivide/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('who_imports：输出有界——命中超上限截断 + truncated 标记 + 总数保真', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codegraph-cap-fx-'));
  try {
    writeFileSync(join(root, 'lib.js'), 'exports.shared = 1;\n');
    for (let i = 0; i < 60; i += 1) {
      writeFileSync(join(root, `c${i}.js`), "const { shared } = require('./lib');\nconsole.log(shared);\n");
    }
    const tools = makeTools(root);
    const r = await tools.whoImports({ symbol: 'shared' }, makeCtx(root));
    assert.equal(r.ok, true);
    assert.equal(r.totalHits, 60);
    assert.equal(r.hits.length, 50, '截 50');
    assert.equal(r.truncated, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('who_imports：项目文件数超上限 → available:false 诚实拒绝（fileCount/maxFiles 如实回传）', async () => {
  const root = seedProject();
  try {
    const { createCodegraphTools } = require_('../core/biof3-server/agent-tools/codegraph-tools.js');
    const tools = createCodegraphTools({
      maxFiles: 2,
      dbProvider: () => ({
        getProject: () => ({ id: 'p_test_1', user_id: 'u1', status: 'active', workspace_path: root }),
      }),
    });
    const r = await tools.whoImports({ symbol: 'safeDivide' }, makeCtx(root));
    assert.equal(r.ok, true);
    assert.equal(r.available, false);
    assert.equal(r.maxFiles, 2);
    assert.ok(r.fileCount > 2);
    assert.match(r.message, /超过/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('who_imports：缺参 fail-closed；无项目 ctx → project_required', async () => {
  const root = seedProject();
  try {
    const tools = makeTools(root);
    const missing = await tools.whoImports({}, makeCtx(root));
    assert.equal(missing.ok, false);
    assert.equal(missing.error, 'missing_symbol');

    const noProject = await tools.whoImports({ symbol: 'x' }, { userId: 'u1' });
    assert.equal(noProject.ok, false);
    assert.equal(noProject.error, 'project_required');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('classify_edges：相对路径入参 + 导出三态（DEAD）+ 出边在场 + 截断标记', async () => {
  const root = seedProject();
  try {
    const tools = makeTools(root);
    const r = await tools.classifyEdges({ file: 'lib/util.js' }, makeCtx(root));
    assert.equal(r.ok, true);
    assert.equal(r.available, true);
    assert.equal(r.file, 'lib/util.js');
    const byName = Object.fromEntries(r.exports.map((e) => [e.name, e]));
    assert.equal(byName.safeDivide.status, 'USED_TEST', 'safeDivide 仅测试消费');
    // status 词表三态（USED_PROD/USED_TEST/DEAD）——「导入但未用」落在 unusedImportCount
    assert.equal(byName.legacyRound.status, 'DEAD', 'legacyRound 无已解析使用');
    assert.equal(byName.legacyRound.unusedImportCount, 1, 'ui.mjs 导入未用如实点名');
    assert.ok(Array.isArray(r.outbound));
    assert.equal(typeof r.exportsTruncated, 'boolean');
    assert.match(r.message, /DEAD≠可删|静态盲区/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('classify_edges：路径逃逸拒绝（.. 出项目根）', async () => {
  const root = seedProject();
  try {
    const tools = makeTools(root);
    const r = await tools.classifyEdges({ file: '../outside.js' }, makeCtx(root));
    assert.equal(r.ok, false);
    assert.equal(r.error, 'invalid_path');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
