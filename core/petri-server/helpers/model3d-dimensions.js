'use strict';

/**
 * helpers/model3d-dimensions.js — BLOCK-322 P4-05b 第一刀：特征锚定的尺寸标注（纯逻辑层）。
 *
 * RULING-04 v2 §5 开工序第 1 票。第一刀范围（v2a 语义）：
 *   - 基元节点 dimensions 键引用（feature='height'|'width'|'depth'|'radius' 等）→
 *     解析数值可代数、可对账；
 *   - face/导入件引用 → 如实 unresolved（v2b 范围：特征表 + 内核探针），不冒充解析；
 *   - 数值对账：|解析值 − nominal| 与 [lower, upper] 公差带比对，偏差显式给出，不静默。
 *
 * SVG 标注层：内核无文字 API → 内核外后处理——解析成功的条目在 HLR SVG 尾部
 * 叠加 <g data-gdt-annotations>（尺寸文字 + 公差带），不改内核、不改既有图形。
 */

const DIMENSION_FEATURES_BY_TYPE = {
  box: ['width', 'depth', 'height'],
  cylinder: ['radius', 'height'],
  sphere: ['radius'],
  cone: ['radiusBottom', 'radiusTop', 'height'],
  torus: ['radius', 'tube'],
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 解析 tolerances[].feature 为可对账的解析值。
 * @returns rows: 每条 { ...tolerance, resolved: { source, value, matched, deviation, reason? } }
 *   source: 'dimension'（基元 dimensions 键）| 'unresolved'
 *   matched: |value − nominal| ∈ [lower, upper]（单边缺省按 0 处理）
 *   deviation: value − nominal（带符号，保留 4 位小数）
 */
function resolveToleranceFeatures(scene, tolerances) {
  const nodes = new Map();
  for (const node of (scene && Array.isArray(scene.nodes) ? scene.nodes : [])) {
    if (node && typeof node.id === 'string') nodes.set(node.id, node);
  }
  const list = Array.isArray(tolerances) ? tolerances : [];
  return list.map((row) => {
    const base = { ...row };
    const node = nodes.get(row.nodeId);
    if (!node) {
      return { ...base, resolved: { source: 'unresolved', value: null, matched: false, deviation: null, reason: 'node_not_found' } };
    }
    const dims = node.dimensions && typeof node.dimensions === 'object' ? node.dimensions : null;
    const allowed = DIMENSION_FEATURES_BY_TYPE[node.type] || [];
    if (!dims || !allowed.includes(row.feature)) {
      return { ...base, resolved: { source: 'unresolved', value: null, matched: false, deviation: null, reason: 'feature_not_a_primitive_dimension' } };
    }
    const value = isFiniteNumber(dims[row.feature]) ? dims[row.feature] : null;
    if (value === null) {
      return { ...base, resolved: { source: 'unresolved', value: null, matched: false, deviation: null, reason: 'dimension_value_missing' } };
    }
    const nominal = isFiniteNumber(row.nominal) ? row.nominal : null;
    const deviation = nominal === null ? null : Number((value - nominal).toFixed(4));
    const lower = isFiniteNumber(row.lower) ? row.lower : 0;
    const upper = isFiniteNumber(row.upper) ? row.upper : 0;
    const matched = deviation !== null && deviation >= lower && deviation <= upper;
    return {
      ...base,
      resolved: { source: 'dimension', value, matched, deviation, band: [lower, upper] },
    };
  });
}

/**
 * 在 HLR SVG 尾部叠加标注层。仅叠加 source='dimension' 的条目；
 * 全部 unresolved 时原样返回（不叠空层）。返回仍以 </svg> 收尾。
 */
function buildGdtAnnotationLayer(svg, resolvedRows) {
  const drawable = (Array.isArray(resolvedRows) ? resolvedRows : []).filter(
    (row) => row.resolved && row.resolved.source === 'dimension',
  );
  if (drawable.length === 0 || typeof svg !== 'string' || !svg.endsWith('</svg>')) return svg;
  const lines = [];
  let y = 18;
  for (const row of drawable) {
    const lower = row.resolved.band ? row.resolved.band[0] : 0;
    const upper = row.resolved.band ? row.resolved.band[1] : 0;
    const mark = row.resolved.matched ? '✓' : '✗';
    const band = `${lower >= 0 ? '+' : ''}${lower}/${upper >= 0 ? '+' : ''}${upper}`;
    lines.push(
      `<text x="8" y="${y}" font-family="monospace" font-size="11" ` +
        `fill="${row.resolved.matched ? '#2e7d32' : '#c62828'}" data-gdt-row="${row.nodeId}:${row.feature}">` +
        `${mark} ${row.nodeId}.${row.feature} = ${row.resolved.value} mm（标称 ${row.nominal}，带 ${band}）` +
        `</text>`,
    );
    y += 16;
  }
  const layer = `<g data-gdt-annotations role="list" aria-label="GD&amp;T 尺寸标注">${lines.join('')}</g></svg>`;
  return svg.slice(0, svg.length - '</svg>'.length) + layer;
}

module.exports = { resolveToleranceFeatures, buildGdtAnnotationLayer, DIMENSION_FEATURES_BY_TYPE };
