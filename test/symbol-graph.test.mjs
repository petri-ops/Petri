// HK-03 P1 契约测试 — symbol-graph 两查询（红绿先行：本文件先于实现落盘）
// 契约锚点：docs/hk03-symbol-graph-selection.md §1 需求规格 / §4 P1 落地要点
// 夹具自包含（临时目录），覆盖 .ts/.tsx/.js/.cjs 四形态 + 「导入但未使用」+ 变量 require 盲区。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root;

test.before(() => {
  root = mkdtempSync(join(tmpdir(), 'symbol-graph-fx-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'comp'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'lib.ts'),
    `export function usedFn() { return 1; }\nexport function deadFn() { return 2; }\n`,
  );
  writeFileSync(
    join(root, 'src', 'esm-user.ts'),
    `import { usedFn, deadImport } from './lib.js';\nexport const v = usedFn() + 1;\n`,
  );
  writeFileSync(
    join(root, 'src', 'cjs-lib.cjs'),
    `exports.cjsA = () => 1;\nexports.cjsDead = () => 2;\n`,
  );
  writeFileSync(
    join(root, 'src', 'cjs-user.cjs'),
    `const { cjsA } = require('./cjs-lib.cjs');\nmodule.exports.out = () => cjsA();\n`,
  );
  writeFileSync(
    join(root, 'comp', 'Widget.tsx'),
    `export function Widget() { return null; }\n`,
  );
  writeFileSync(
    join(root, 'comp', 'comp-user.tsx'),
    `import { Widget } from './Widget';\nexport const w = <Widget />;\n`,
  );
  writeFileSync(
    join(root, 'src', 'dyn.ts'),
    `export async function lazy() { const m = await import('./lib.js'); return m.usedFn(); }\n`,
  );
  writeFileSync(
    join(root, 'src', 'variable-require.cjs'),
    `const name = './unknown';\nconst h = require(name);\nmodule.exports.h = h;\n`,
  );
  writeFileSync(
    join(root, 'src', 'ns-lib.ts'),
    `export function nsOnlyFn() { return 3; }\n`,
  );
  writeFileSync(
    join(root, 'src', 'ns-user.ts'),
    `import * as f from './ns-lib.js';\nexport const z = f.nsOnlyFn();\n`,
  );
  writeFileSync(
    join(root, 'src', 'concat-user.cjs'),
    `const { catA } = require('./cjs-lib' + '.cjs');\nmodule.exports.q = catA;\n`,
  );
});

test.after(() => {
  rmSync(root, { recursive: true, force: true });
});

async function loadModule() {
  return import('../scripts/symbol-graph.mjs');
}

test('who-imports：ESM 具名导入且使用 → used=true（prod）', async () => {
  const m = await loadModule();
  const graph = await m.buildGraph(root);
  const hits = m.whoImports(graph, 'usedFn');
  const esm = hits.filter((h) => h.file.endsWith('esm-user.ts'));
  assert.equal(esm.length, 1);
  assert.equal(esm[0].used, true);
  assert.equal(esm[0].kind, 'USED_PROD');
});

test('who-imports：导入但未使用 → used=false（导入边在、符号死）', async () => {
  const m = await loadModule();
  const graph = await m.buildGraph(root);
  const hits = m.whoImports(graph, 'deadImport');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].used, false);
});

test('who-imports：CJS require 解构（AST 级，非词法）→ 使用识别', async () => {
  const m = await loadModule();
  const graph = await m.buildGraph(root);
  const hits = m.whoImports(graph, 'cjsA');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file.endsWith('cjs-user.cjs'), true);
  assert.equal(hits[0].used, true);
  assert.equal(hits[0].kind, 'USED_PROD');
});

test('who-imports：.tsx 扩展名省略导入可解析', async () => {
  const m = await loadModule();
  const graph = await m.buildGraph(root);
  const hits = m.whoImports(graph, 'Widget');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].used, true);
  assert.equal(hits[0].target.endsWith('Widget.tsx'), true);
});

test('who-imports：未知符号 → 空集（不编造）', async () => {
  const m = await loadModule();
  const graph = await m.buildGraph(root);
  assert.deepEqual(m.whoImports(graph, 'nope_not_there'), []);
});

test('classify-edges：入边导出三态（USED_PROD / DEAD）+ 出边', async () => {
  const m = await loadModule();
  const graph = await m.buildGraph(root);
  const lib = m.classifyEdges(graph, join(root, 'src', 'lib.ts'));
  const byName = Object.fromEntries(lib.exports.map((e) => [e.name, e]));
  assert.equal(byName.usedFn.status, 'USED_PROD');
  assert.equal(byName.deadFn.status, 'DEAD');
  const cjs = m.classifyEdges(graph, join(root, 'src', 'cjs-lib.cjs'));
  const cjsByName = Object.fromEntries(cjs.exports.map((e) => [e.name, e]));
  assert.equal(cjsByName.cjsA.status, 'USED_PROD');
  assert.equal(cjsByName.cjsDead.status, 'DEAD');
});

test('诚实盲区：变量形式 require 报 UNRESOLVED，不猜测目标', async () => {
  const m = await loadModule();
  const graph = await m.buildGraph(root);
  const vr = graph.edges.filter((e) => e.file.endsWith('variable-require.cjs'));
  assert.equal(vr.length, 1);
  assert.equal(vr[0].resolved, false);
  assert.equal(vr[0].specifier, null);
});

test('动态 import() 记为命名空间边（不带具体符号名）', async () => {
  const m = await loadModule();
  const graph = await m.buildGraph(root);
  const dyn = graph.edges.filter((e) => e.file.endsWith('dyn.ts'));
  assert.equal(dyn.length, 1);
  assert.equal(dyn[0].namespace, true);
  assert.equal(dyn[0].resolved, true);
});

test('命名空间属性访问（ns.sym）可判定符号使用（CK-11 消费形态）', async () => {
  const m = await loadModule();
  const graph = await m.buildGraph(root);
  const hits = m.whoImports(graph, 'nsOnlyFn');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].used, true);
  assert.equal(hits[0].via, 'namespace');
  assert.equal(hits[0].kind, 'USED_PROD');
  const cls = m.classifyEdges(graph, join(root, 'src', 'ns-lib.ts'));
  assert.equal(cls.exports[0].status, 'USED_PROD');
});

test('require 字面量拼接参数可折叠（确定性，非猜测）', async () => {
  const m = await loadModule();
  const graph = await m.buildGraph(root);
  const hits = m.whoImports(graph, 'catA');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].used, true);
  assert.equal(hits[0].resolved, true);
  assert.equal(hits[0].target.endsWith('cjs-lib.cjs'), true);
});
