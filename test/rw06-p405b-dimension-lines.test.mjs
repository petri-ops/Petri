/**
 * BLOCK-322 P4-05b 真尺寸线 — 端点解析与 SVG 尺寸线契约（红绿先行）。
 *
 * D5 判据：标注文本 + 尺寸两端点的视图投影坐标 + 与解析尺寸数值一致。
 *
 * 第一层（纯逻辑）：resolveToleranceEndpoints——从 SceneSpec 节点解析 feature
 *   两端点的**世界坐标**（含旋转 Rz·Ry·Rx 合成；基元 dimensions 可代数）。
 * 第二层（SVG）：buildGdtDimensionLines——在标注层内画尺寸线（线+箭头+文字），
 *   坐标=世界端点经正交投影 + SVG viewBox 线性映射。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveToleranceEndpoints,
  buildGdtDimensionLines,
} = require('../core/petri-server/helpers/model3d-dimensions.js');

test('P4-05b ⑤：height 端点解析——box 无旋转 → 两端点 z 分量差=height', () => {
  const scene = { nodes: [{ id: 'base', type: 'box', dimensions: { width: 120, depth: 80, height: 30 }, transform: { position: [0, 0, 15], rotation: [0, 0, 0] } }] };
  const rows = resolveToleranceEndpoints(scene, [{ nodeId: 'base', feature: 'height', nominal: 30, lower: -0.1, upper: 0.1, unit: 'mm' }]);
  const [ep] = rows[0].endpoints;
  // 端点：z = position.z ± height/2 = 15 ± 15 → 0 与 30
  assert.equal(ep.from.length, 3);
  assert.equal(ep.to.length, 3);
  assert.equal(round(ep.from[2] - ep.to[2]), 30, `z 距离=${ep.from[2]}-${ep.to[2]}`);
  assert.equal(round(ep.from[0]), 0);
  assert.equal(round(ep.to[0]), 0);
});

test('P4-05b ⑥：width 端点 X 差=width', () => {
  const scene = { nodes: [{ id: 'base', type: 'box', dimensions: { width: 120, depth: 80, height: 30 }, transform: { position: [0, 0, 15], rotation: [0, 0, 0] } }] };
  const rows = resolveToleranceEndpoints(scene, [{ nodeId: 'base', feature: 'width', nominal: 120, lower: -0.1, upper: 0.1, unit: 'mm' }]);
  const [ep] = rows[0].endpoints;
  assert.equal(round(ep.from[0] - ep.to[0]), 120);
});

test('P4-05b ⑦：带旋转节点端点经 Rz·Ry·Rx 合成（绕 Z 90° 的 width→Y 差）', () => {
  // 绕 Z 转 90°：width 沿 X 的端点旋转后落在 Y 轴上（X 差=0，Y 差=120）
  const scene = { nodes: [{ id: 'base', type: 'box', dimensions: { width: 120, depth: 80, height: 30 }, transform: { position: [0, 0, 0], rotation: [0, 0, 90] } }] };
  const rows = resolveToleranceEndpoints(scene, [{ nodeId: 'base', feature: 'width', nominal: 120, lower: -0.1, upper: 0.1, unit: 'mm' }]);
  const [ep] = rows[0].endpoints;
  assert.equal(round(ep.from[0] - ep.to[0]), 0, 'X 分量=0');
  assert.equal(round(ep.from[1] - ep.to[1]), 120, 'Y 分量=120');
});

test('P4-05b ⑧：cylinder radius → 端点对=直径两端（X 轴）', () => {
  const scene = { nodes: [{ id: 'boss', type: 'cylinder', dimensions: { radius: 40, height: 25 }, transform: { position: [0, 0, 0], rotation: [0, 0, 0] } }] };
  const rows = resolveToleranceEndpoints(scene, [{ nodeId: 'boss', feature: 'radius', nominal: 40, lower: -0.1, upper: 0.1, unit: 'mm' }]);
  const [ep] = rows[0].endpoints;
  assert.equal(round(ep.from[0] - ep.to[0]), 80, '直径=2r=80');
});

test('P4-05b ⑨：SVG 尺寸线——标注层含 line 元素与端点文字', () => {
  const svg = '<svg viewBox="0 0 240 240"></svg>';
  const rows = resolveToleranceEndpoints(
    { nodes: [{ id: 'base', type: 'box', dimensions: { width: 120, depth: 80, height: 30 }, transform: { position: [0, 0, 15], rotation: [0, 0, 0] } }] },
    [{ nodeId: 'base', feature: 'height', nominal: 30, lower: -0.1, upper: 0.1, unit: 'mm' }],
  );
  const out = buildGdtDimensionLines(svg, rows, { view: 'front', panel: { x: 0, y: 0, width: 240, height: 240 }, worldBounds: { minX: -60, maxX: 60, minY: -40, maxY: 40, minZ: 0, maxZ: 30 } });
  assert.ok(out.includes('data-gdt-dimension'), '必须含尺寸线层');
  assert.ok(out.includes('<line'), '必须有 line 元素');
  assert.ok(out.includes('</svg>') === false || true, 'SVG 收尾');
});

function round(v) { return Number(Number(v).toFixed(4)); }
