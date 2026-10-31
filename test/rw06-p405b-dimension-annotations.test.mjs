/**
 * RW-06 → BLOCK-322 P4-05b 第一刀 — 特征锚定的尺寸标注契约（红绿先行）。
 *
 * RULING-04 v2 §5 开工序第 1 票：`tolerances[].feature` 变可解析引用 + HLR SVG 上
 * 出尺寸线与文字。判据=契约测 + 实机 SVG 数值对账 + UI 腿。
 *
 * 第一刀范围（v2a 语义，D4 推荐口径）：
 *   ① 基元 dimensions 键引用：feature='height'|'width'|'depth'|'radius' 等 →
 *      从 SceneSpec 节点 dimensions 解析出**解析数值**（可代数对账）；
 *   ② 数值对账：|解析值 − nominal| 落在 [lower, upper] 公差带 → matched=true，
 *      超带 → matched=false + 明确偏差值（不静默取值）；
 *   ③ face/导入件引用 → 第一刀如实 unresolved（v2b 范围），不冒充解析；
 *   ④ SVG 标注层：解析成功的条目在 HLR SVG 尾部叠加
 *      `<g data-gdt-annotations>` 尺寸线+文字（内核外后处理，不改内核）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveToleranceFeatures,
  buildGdtAnnotationLayer,
} = require('../core/petri-server/helpers/model3d-dimensions');

const SCENE = {
  nodes: [
    { id: 'base', type: 'box', name: 'Base', dimensions: { width: 120, depth: 80, height: 30 } },
    { id: 'boss', type: 'cylinder', name: 'Boss', dimensions: { radius: 40, height: 25 } },
  ],
};

function tolerance(nodeId, feature, nominal, lower = -0.1, upper = 0.1) {
  return { nodeId, feature, nominal, lower, upper, unit: 'mm' };
}

test('P4-05b ①：基元 dimensions 键引用解析出代数数值', () => {
  const rows = resolveToleranceFeatures(
    SCENE,
    [
      tolerance('base', 'height', 30),
      tolerance('base', 'width', 120),
      tolerance('boss', 'radius', 40),
    ],
  );
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.resolved.source, 'dimension', JSON.stringify(row));
    assert.equal(row.resolved.value, row.nominal, `${row.feature} 解析值须与标称一致`);
    assert.equal(row.resolved.matched, true);
  }
});

test('P4-05b ②：数值对账——超带如实标 false 并带偏差，不带内如实标 true', () => {
  const rows = resolveToleranceFeatures(
    SCENE,
    [tolerance('base', 'height', 29.5), tolerance('base', 'width', 120)],
  );
  assert.equal(rows[0].resolved.matched, false);
  assert.equal(rows[0].resolved.deviation, 0.5);  // 解析 30 − 标称 29.5 = +0.5
  assert.equal(rows[1].resolved.matched, true);
});

test('P4-05b ③：face/导入件引用与未知 feature 如实 unresolved（v2b 边界，不冒充解析）', () => {
  const rows = resolveToleranceFeatures(
    SCENE,
    [
      tolerance('base', 'face:cylinder#0', 40),
      tolerance('base', '总高', 30),
      tolerance('nonexistent-node', 'height', 30),
    ],
  );
  for (const row of rows) {
    assert.equal(row.resolved.source, 'unresolved', JSON.stringify(row.resolved));
    assert.equal(row.resolved.value, null);
  }
  assert.equal(rows[2].resolved.reason, 'node_not_found');
});

test('P4-05b ④：SVG 标注层——解析成功条目叠加 data-gdt-annotations 文字层', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g id="views"></g></svg>';
  const rows = resolveToleranceFeatures(SCENE, [tolerance('base', 'height', 30), tolerance('base', 'width', 120.5)]);
  const annotated = buildGdtAnnotationLayer(svg, rows);
  assert.ok(annotated.includes('data-gdt-annotations'), '必须含标注层');
  assert.ok(annotated.includes('30'), '必须含解析值文字');
  assert.ok(annotated.endsWith('</svg>'), '仍以 </svg> 收尾');
  assert.ok(annotated.indexOf('data-gdt-annotations') > annotated.indexOf('<svg'), '叠加层在原图之后');
});

test('P4-05b ④b：全部 unresolved 时 SVG 原样返回（不叠空层）', () => {
  const svg = '<svg></svg>';
  const rows = resolveToleranceFeatures(SCENE, [tolerance('base', 'face:cylinder#0', 40)]);
  const out = buildGdtAnnotationLayer(svg, rows);
  assert.equal(out, svg);
});
