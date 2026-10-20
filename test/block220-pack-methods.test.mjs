/**
 * BLOCK-220 — Q-DOMAIN P3 垂直切片：pack 提供的 methods 数据面。
 *
 * 钉住四件事：
 * 1. 契约：`pack.json provides.methods = { citations, toolLabels }` 指向两个 JSON；
 * 2. 有界：越界条目截断并留 warning，不无界膨胀；
 * 3. fail-closed：坏 JSON / 路径逃逸 / 非对象形状只丢该包该面，不影响其他包；
 * 4. 诚实降级：包缺失或停用 → 空结果（核心不伪造引文）。
 *
 * 测试用临时数据目录伪造 `packs/installed.json`，不读真实用户数据、不依赖兄弟仓。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'block220-methods-'));
process.env.PETRI_LOCAL_DATA_DIR = TMP;

const require = createRequire(import.meta.url);
const packMethods = require('../core/petri-server/helpers/pack-methods.js');

function writePack(packId, { enabled = true, citations, toolLabels, packJson, extraFiles = {} } = {}) {
  const packRoot = path.join(TMP, 'packs', packId);
  fs.mkdirSync(path.join(packRoot, 'methods'), { recursive: true });
  const manifest = packJson || {
    packId,
    version: '0.0.1',
    provides: { methods: { citations: 'methods/citations.json', toolLabels: 'methods/tool-labels.json' } },
  };
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify(manifest, null, 2), 'utf8');
  if (citations !== undefined) {
    fs.writeFileSync(path.join(packRoot, 'methods', 'citations.json'), citations, 'utf8');
  }
  if (toolLabels !== undefined) {
    fs.writeFileSync(path.join(packRoot, 'methods', 'tool-labels.json'), toolLabels, 'utf8');
  }
  for (const [rel, content] of Object.entries(extraFiles)) {
    const full = path.join(packRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return { packId, packRoot, enabled, installedAt: '2026-10-20T00:00:00.000Z' };
}

function writeInstalled(packs) {
  fs.mkdirSync(path.join(TMP, 'packs'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'packs', 'installed.json'), JSON.stringify(packs, null, 2), 'utf8');
}

function reset() {
  fs.rmSync(path.join(TMP, 'packs'), { recursive: true, force: true });
}

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('BLOCK-220 无安装包 → 空结果（不伪造引文）', () => {
  reset();
  const bundle = packMethods.loadPackMethods();
  assert.deepEqual(bundle.citations, {});
  assert.deepEqual(bundle.toolLabels, {});
  assert.deepEqual(bundle.packs, []);
  assert.deepEqual(packMethods.getCitations('deg', bundle), []);
  assert.equal(packMethods.getToolLabel('deg', bundle), null);
});

test('BLOCK-220 启用包贡献 citations / toolLabels', () => {
  reset();
  const pack = writePack('petri-pack-bio', {
    citations: JSON.stringify({ deg: ['Wilcoxon rank-sum', 'MAST for hurdle modeling'] }),
    toolLabels: JSON.stringify({ deg: 'FindMarkers (Wilcoxon)' }),
  });
  writeInstalled([pack]);
  const bundle = packMethods.loadPackMethods();
  assert.deepEqual(bundle.citations.deg, ['Wilcoxon rank-sum', 'MAST for hurdle modeling']);
  assert.equal(bundle.toolLabels.deg, 'FindMarkers (Wilcoxon)');
  assert.equal(bundle.packs.length, 1);
  assert.deepEqual(packMethods.getCitations('deg', bundle), [
    'Wilcoxon rank-sum',
    'MAST for hurdle modeling',
  ]);
  assert.equal(packMethods.getToolLabel('deg', bundle), 'FindMarkers (Wilcoxon)');
  // 未声明类型 → 空（不回落到类型名）
  assert.deepEqual(packMethods.getCitations('unknown-type', bundle), []);
  assert.equal(packMethods.getToolLabel('unknown-type', bundle), null);
});

test('BLOCK-220 停用包不贡献（enabled:false）', () => {
  reset();
  const pack = writePack('petri-pack-bio', {
    enabled: false,
    citations: JSON.stringify({ deg: ['seurat-free text'] }),
    toolLabels: JSON.stringify({ deg: 'some label' }),
  });
  writeInstalled([pack]);
  const bundle = packMethods.loadPackMethods();
  assert.deepEqual(bundle.citations, {});
  assert.equal(bundle.toolLabels.deg, undefined);
});

test('BLOCK-220 坏 JSON 只丢该面，不影响同包另一面', () => {
  reset();
  const pack = writePack('petri-pack-bio', {
    citations: '{ not json',
    toolLabels: JSON.stringify({ deg: 'ok label' }),
  });
  writeInstalled([pack]);
  const bundle = packMethods.loadPackMethods();
  assert.deepEqual(bundle.citations, {});
  assert.equal(bundle.toolLabels.deg, 'ok label');
  assert.ok(bundle.warnings.some((w) => w.code === 'invalid_json'));
});

test('BLOCK-220 形状错误 fail-closed（citations 不是对象 / 条目不是数组）', () => {
  reset();
  const pack = writePack('petri-pack-bio', {
    citations: JSON.stringify({ deg: 'not-an-array', enrichment: ['ok'] }),
    toolLabels: JSON.stringify({ deg: 42, enrichment: 'label' }),
  });
  writeInstalled([pack]);
  const bundle = packMethods.loadPackMethods();
  assert.equal(bundle.citations.deg, undefined);
  assert.deepEqual(bundle.citations.enrichment, ['ok']);
  assert.equal(bundle.toolLabels.deg, undefined);
  assert.equal(bundle.toolLabels.enrichment, 'label');
  assert.ok(bundle.warnings.some((w) => w.code === 'citations_entry_not_array'));
  assert.ok(bundle.warnings.some((w) => w.code === 'tool_label_not_string'));
});

test('BLOCK-220 有界：单类型条目 ≤40 截断并留 warning', () => {
  reset();
  const many = Array.from({ length: 55 }, (_, i) => `ref-${i}`);
  const pack = writePack('petri-pack-bio', {
    citations: JSON.stringify({ deg: many }),
    toolLabels: JSON.stringify({}),
  });
  writeInstalled([pack]);
  const bundle = packMethods.loadPackMethods();
  assert.equal(bundle.citations.deg.length, packMethods.MAX_ENTRIES_PER_TYPE);
  assert.equal(bundle.citations.deg[0], 'ref-0');
  assert.ok(bundle.warnings.some((w) => w.code === 'citations_entries_truncated'));
});

test('BLOCK-220 有界：超长条目被裁剪到上限', () => {
  reset();
  const long = 'x'.repeat(packMethods.MAX_ENTRY_CHARS + 50);
  const pack = writePack('petri-pack-bio', {
    citations: JSON.stringify({ deg: [long] }),
    toolLabels: JSON.stringify({ deg: long }),
  });
  writeInstalled([pack]);
  const bundle = packMethods.loadPackMethods();
  assert.equal(bundle.citations.deg[0].length, packMethods.MAX_ENTRY_CHARS);
  assert.equal(bundle.toolLabels.deg.length, packMethods.MAX_ENTRY_CHARS);
});

test('BLOCK-220 路径逃逸（../）被拒并留 warning', () => {
  reset();
  const outside = path.join(TMP, 'outside.json');
  fs.writeFileSync(outside, JSON.stringify({ deg: ['leaked'] }), 'utf8');
  const pack = writePack('petri-pack-bio', {
    packJson: {
      packId: 'petri-pack-bio',
      version: '0.0.1',
      provides: { methods: { citations: '../outside.json' } },
    },
    toolLabels: JSON.stringify({}),
  });
  writeInstalled([pack]);
  const bundle = packMethods.loadPackMethods();
  assert.deepEqual(bundle.citations, {});
  assert.ok(bundle.warnings.some((w) => w.code === 'path_outside_pack'));
});

test('BLOCK-220 多包同类型：按 packId 序稳定覆盖并留 warning', () => {
  reset();
  const a = writePack('pack-a', {
    citations: JSON.stringify({ deg: ['from-a'] }),
    toolLabels: JSON.stringify({ deg: 'label-a' }),
  });
  const b = writePack('pack-b', {
    citations: JSON.stringify({ deg: ['from-b'] }),
    toolLabels: JSON.stringify({ deg: 'label-b' }),
  });
  writeInstalled([b, a]);
  const bundle = packMethods.loadPackMethods();
  assert.deepEqual(bundle.citations.deg, ['from-b']);
  assert.equal(bundle.toolLabels.deg, 'label-b');
  assert.ok(bundle.warnings.some((w) => w.code === 'citations_overridden'));
  assert.ok(bundle.warnings.some((w) => w.code === 'tool_label_overridden'));
});

test('BLOCK-220 未声明 provides.methods 的包被跳过', () => {
  reset();
  const pack = writePack('petri-pack-bio', {
    packJson: { packId: 'petri-pack-bio', version: '0.0.1', provides: { plugins: 'plugins/' } },
    citations: JSON.stringify({ deg: ['should-not-load'] }),
  });
  writeInstalled([pack]);
  const bundle = packMethods.loadPackMethods();
  assert.deepEqual(bundle.citations, {});
  assert.deepEqual(bundle.packs, []);
});

test('BLOCK-220 _scriptHeader 无 pack → 只写类型名（不伪造工具标签）', () => {
  reset();
  const { _scriptHeader } = require('../core/petri-server/helpers/methods-export.js');
  const header = _scriptHeader({
    analysis: { type: 'deg', name: 'DEG 分析', params: { group1: 'A' } },
    dataset: { name: 'demo', n_cells: 100, n_genes: 2000 },
    language: 'python',
    generatedAt: '2026-10-20',
    username: 'tester',
  });
  assert.match(header, /# Type {5}: deg\n/);
  assert.equal(/—/.test(header.split('\n').find((l) => l.startsWith('# Type')) || ''), false);
});

test('BLOCK-220 _scriptHeader 有 pack → 写 pack 提供的工具标签', () => {
  reset();
  const pack = writePack('petri-pack-bio', {
    citations: JSON.stringify({}),
    toolLabels: JSON.stringify({ deg: 'FindMarkers (Wilcoxon)' }),
  });
  writeInstalled([pack]);
  const { _scriptHeader } = require('../core/petri-server/helpers/methods-export.js');
  const header = _scriptHeader({
    analysis: { type: 'deg', params: {} },
    dataset: null,
    language: 'r',
    generatedAt: '2026-10-20',
    username: 'tester',
  });
  assert.match(header, /# Type {5}: deg — FindMarkers \(Wilcoxon\)/);
  assert.match(header, /\(R\)/);
});

test('BLOCK-220 核心不再内联 methods 引用表（单源检查）', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'core', 'petri-server', 'helpers', 'methods-export.js'),
    'utf8',
  );
  assert.equal(source.includes('_METHODS_CITATIONS'), false);
  const scriptHeader = source.slice(source.indexOf('function _scriptHeader'));
  assert.equal(/Seurat|scanpy|Squidpy|CellChat/.test(scriptHeader.slice(0, 1600)), false);
});
