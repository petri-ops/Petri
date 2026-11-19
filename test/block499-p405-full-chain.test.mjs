/**
 * BLOCK-499 P4-05 完整尺寸链 — 特征引用解析 + 尺寸链代数（HK-01 红绿先行）。
 *
 * 用户 2026-11-19 A 组 #3 发令。第一刀（P4-05b）已落地 dimensions 键引用解析 + 公差带 +
 * SVG 标注层 + 端点投影；本票把引用升级到 v2b 特征级（BLOCK-498 落地的 aFeature 语法/派生缓存）
 * 并补尺寸链代数（D5 数值一致性判据：标注文本 + Σlinks 与 total 一致，禁主观验收）。
 *
 * 契约：
 *   ① 特征引用解析：tolerances[].feature 收 feat: id / 特征名——节点 features[] 缓存优先，
 *      基元无缓存时自动派生（D1 派生缓存同源）；值=行内代数量（size/radius/height）；
 *      kind=other / 非代数量 → 如实 unresolved（feature_value_not_algebraic），不静默近似。
 *   ② 交叉对账：特征路径与 dimensions 键路径同值（D5 数值一致性）。
 *   ③ 尺寸链：links 逐项解析 → Σ 与 total 比对（缺省 total=沿轴 dimension 总量）；
 *      |Σ−total|≤1e-6 → consistent；SVG 叠加 data-gdt-chains 层（数字在文本里，可复核）。
 *   ④ manifest 诚实翻转：链齐且全 consistent → capabilities.dimensions=true + dimensionChains=true
 *      （无链/不一致 → 维持 false，既有 pin 不动）；gdt 恒 false（形位符号不在本票）。
 *   ⑤ 实机腿：真实 STEP（occt-wasm makeBox）→ createCadDrawing 带 chains → manifest+SVG 全链。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { OcctKernel } from 'occt-wasm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  resolveToleranceFeatures,
  buildDimensionChain,
  buildChainAnnotationLayer,
  buildGdtAnnotationLayer,
} = require('../core/petri-server/helpers/model3d-dimensions.js');
const { createCadDrawing } = require('../core/petri-server/helpers/model3d-cad-drawing.js');
const { derivePrimitiveFeatures } = require('../core/petri-server/helpers/model3d-features.js');

const sceneOf = (nodes) => ({ nodes });
const box = (id, dims, extra = {}) => ({ id, type: 'box', dimensions: dims, ...extra });

const boxA = box('a', { width: 120, depth: 80, height: 30 });
const boxB = box('b', { width: 120, depth: 80, height: 20 });
const aFeatures = derivePrimitiveFeatures(boxA);

test('① 特征引用解析：features[] 缓存行 feat: id → 代数量（source=feature）', () => {
  const node = box('a', { width: 120, depth: 80, height: 30 }, {
    featuresVersionKey: 'a'.repeat(64),
    features: aFeatures,
  });
  const minusZ = aFeatures.find((f) => f.feature === '-z');
  const rows = resolveToleranceFeatures(sceneOf([node]), [
    { nodeId: 'a', feature: minusZ.id, nominal: 30, lower: 0, upper: 0.5 },
  ]);
  assert.equal(rows[0].resolved.source, 'feature');
  assert.equal(rows[0].resolved.value, 30);
  assert.equal(rows[0].resolved.matched, true);
  assert.equal(rows[0].resolved.featureId, minusZ.id);
});

test('② 基元无缓存时自动派生回落（D1 派生缓存同源）', () => {
  const rows = resolveToleranceFeatures(sceneOf([boxA]), [
    { nodeId: 'a', feature: '+z', nominal: 30, lower: -0.2, upper: 0.2 },
  ]);
  assert.equal(rows[0].resolved.source, 'feature');
  assert.equal(rows[0].resolved.value, 30);
  assert.equal(rows[0].resolved.matched, true);
});

test('③ 交叉对账：特征路径与 dimensions 键路径同值（D5）', () => {
  const rows = resolveToleranceFeatures(sceneOf([boxA]), [
    { nodeId: 'a', feature: 'height', nominal: 30, lower: 0, upper: 0 },
    { nodeId: 'a', feature: '+z', nominal: 30, lower: 0, upper: 0 },
  ]);
  assert.equal(rows[0].resolved.source, 'dimension');
  assert.equal(rows[1].resolved.source, 'feature');
  assert.equal(rows[0].resolved.value, rows[1].resolved.value, '两路径必须同值（同一代数事实）');
});

test('④ 诚实 unresolved：mesh 无表 → 未解析；other 行 → 非代数量不静默近似', () => {
  const mesh = { id: 'm', type: 'mesh-reference', source: { path: 'x.glb', sourceSha256: 'a'.repeat(64) } };
  const rowsMesh = resolveToleranceFeatures(sceneOf([mesh]), [{ nodeId: 'm', feature: '+z', nominal: 1 }]);
  assert.equal(rowsMesh[0].resolved.source, 'unresolved');
  const otherNode = box('o', { width: 10, depth: 10, height: 10 }, {
    features: [{ id: 'feat:0123456789abcdef01234567', kind: 'other' }],
  });
  const rowsOther = resolveToleranceFeatures(sceneOf([otherNode]), [
    { nodeId: 'o', feature: 'feat:0123456789abcdef01234567', nominal: 1 },
  ]);
  assert.equal(rowsOther[0].resolved.source, 'unresolved');
  assert.equal(rowsOther[0].resolved.reason, 'feature_value_not_algebraic');
});

test('⑤ 尺寸链一致：Σlinks==total（30+20=50）→ consistent；SVG 链层带数字', () => {
  const chains = buildDimensionChain(sceneOf([boxA, boxB]), [
    { id: 'stack-z', nodeId: 'a', links: ['+z', { nodeId: 'b', ref: 'height' }], total: 50 },
  ]);
  assert.equal(chains[0].resolved, true);
  assert.equal(chains[0].consistent, true);
  assert.equal(chains[0].sum, 50);
  const svg = buildChainAnnotationLayer('<svg>...</svg>', chains);
  assert.match(svg, /data-gdt-chains/);
  assert.match(svg, /Σ=50/);
  assert.match(svg, /✓/);
});

test('⑥ 尺寸链不一致：total=49 → deviation=1 → consistent=false 显式 ✗（不静默）', () => {
  const chains = buildDimensionChain(sceneOf([boxA, boxB]), [
    { id: 'stack-bad', nodeId: 'a', links: ['+z', { nodeId: 'b', ref: 'height' }], total: 49 },
  ]);
  assert.equal(chains[0].consistent, false);
  assert.equal(chains[0].deviation, 1);
  const svg = buildChainAnnotationLayer('<svg>...</svg>', chains);
  assert.match(svg, /✗/);
});

test('⑦ 缺省 total=沿轴 dimension 总量；cylinder 轴映射；无法派生 → total_unavailable', () => {
  const defaultTotal = buildDimensionChain(sceneOf([boxA]), [{ id: 'c1', nodeId: 'a', links: ['+z'] }]);
  assert.equal(defaultTotal[0].total, 30);
  assert.equal(defaultTotal[0].consistent, true);
  const cyl = { id: 'c', type: 'cylinder', dimensions: { radius: 40, height: 25 } };
  const cylChain = buildDimensionChain(sceneOf([cyl]), [{ id: 'c2', nodeId: 'c', links: ['+z'] }]);
  assert.equal(cylChain[0].total, 25);
  const cone = { id: 'g', type: 'cone', dimensions: { radiusBottom: 20, radiusTop: 10, height: 15 } };
  const gChain = buildDimensionChain(sceneOf([cone]), [{ id: 'c3', nodeId: 'g', links: ['height'] }]);
  assert.equal(gChain[0].resolved, false);
  assert.equal(gChain[0].reason, 'total_unavailable', 'plane 无轴向映射 → 缺省 total 不可派生（如实拒绝）');
});

test('⑧ 标注层与链层共存（同 SVG 两组 data-gdt-*）', () => {
  const rows = resolveToleranceFeatures(sceneOf([boxA]), [{ nodeId: 'a', feature: 'height', nominal: 30 }]);
  const withAnnotations = buildGdtAnnotationLayer('<svg>x</svg>', rows);
  const chains = buildDimensionChain(sceneOf([boxA]), [{ id: 'c1', nodeId: 'a', links: ['+z'] }]);
  const both = buildChainAnnotationLayer(withAnnotations, chains);
  assert.match(both, /data-gdt-annotations/);
  assert.match(both, /data-gdt-chains/);
  assert.ok(both.endsWith('</svg>'));
});

test('⑨ 实机腿：真实 STEP（occt-wasm makeBox 10×20×30）→ createCadDrawing 带 chains → manifest 诚实翻转', async () => {
  const kernel = await OcctKernel.init();
  let stepBytes;
  try {
    const solid = kernel.makeBox(10, 20, 30);
    stepBytes = Buffer.from(kernel.exportStep(solid, { schema: 'AP214' }));
  } finally {
    kernel[Symbol.dispose]();
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block499-live-'));
  try {
    fs.mkdirSync(path.join(root, 'model3d'), { recursive: true });
    fs.writeFileSync(path.join(root, 'model3d', 'part.step'), stepBytes);
    // 链引用的 scene 节点（代数事实与 STEP 几何同尺寸口径：10/20/30）
    const scene = { nodes: [box('part', { width: 10, depth: 20, height: 30 })] };
    const drawing = await createCadDrawing({
      workspaceRoot: root,
      sourcePath: 'model3d/part.step',
      scene,
      tolerances: [{ nodeId: 'part', feature: 'height', nominal: 30 }],
      chains: [{ id: 'z-chain', nodeId: 'part', links: ['+z'] }],
    });
    assert.equal(drawing.ok, true, JSON.stringify(drawing).slice(0, 300));
    assert.equal(drawing.manifest.capabilities.hiddenLineRemoval, true);
    assert.equal(drawing.manifest.capabilities.dimensionChains, true, '链齐且一致 → dimensionChains 诚实翻转为 true');
    assert.equal(drawing.manifest.capabilities.dimensions, true, 'D5 数值一致 → dimensions 诚实翻转为 true');
    assert.equal(drawing.manifest.capabilities.gdt, false, '形位符号不在本票，gdt 保持 false');
    assert.equal(drawing.manifest.dimensionChainSummary.count, 1);
    assert.equal(drawing.manifest.dimensionChainSummary.consistentCount, 1);
    const svgText = fs.readFileSync(path.join(root, drawing.svgPath), 'utf8');
    assert.match(svgText, /data-gdt-chains/);
    // 无链对照：capabilities 维持 false（既有 pin 语义不破）
    const plain = await createCadDrawing({ workspaceRoot: root, sourcePath: 'model3d/part.step' });
    assert.equal(plain.ok, true);
    assert.equal(plain.manifest.capabilities.dimensions, false);
    assert.equal(plain.manifest.capabilities.dimensionChains, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
