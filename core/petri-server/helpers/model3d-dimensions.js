'use strict';

/**
 * helpers/model3d-dimensions.js — BLOCK-322 P4-05b 第一刀 + P4-05 完整尺寸链（BLOCK-499）：特征锚定的尺寸标注（纯逻辑层）。
 *
 * BLOCK-499（2026-11-19 用户 A 组 #3 发令）新增：特征引用解析（feat: id/特征名，缓存优先+基元派生回落）、
 * 尺寸链代数（Σlinks vs total，D5 数值一致性 |偏差|≤1e-6）、SVG 链层（data-gdt-chains）、
 * manifest capabilities.dimensions/dimensionChains 诚实翻转（链齐且全一致才 true）。
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

const model3dFeatures = require('./model3d-features');

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
      // BLOCK-499 — 特征引用路径（D2 引用语法 + D1 派生缓存）：feat: id / 特征名，
      // 节点 features[] 缓存优先，基元无缓存自动派生回落；非代数量如实 unresolved。
      const featureRow = resolveFeatureRow(node, row.feature);
      if (!featureRow) {
        return { ...base, resolved: { source: 'unresolved', value: null, matched: false, deviation: null, reason: 'feature_not_a_primitive_dimension' } };
      }
      const scalar = featureScalarFromRow(featureRow);
      if (scalar.value === null) {
        return { ...base, resolved: { source: 'unresolved', value: null, matched: false, deviation: null, reason: 'feature_value_not_algebraic' } };
      }
      const nominalF = isFiniteNumber(row.nominal) ? row.nominal : null;
      const deviationF = nominalF === null ? null : Number((scalar.value - nominalF).toFixed(4));
      const lowerF = isFiniteNumber(row.lower) ? row.lower : 0;
      const upperF = isFiniteNumber(row.upper) ? row.upper : 0;
      const matchedF = deviationF !== null && deviationF >= lowerF && deviationF <= upperF;
      return {
        ...base,
        resolved: {
          source: 'feature',
          featureId: featureRow.id || null,
          featureKind: featureRow.kind || null,
          dimKey: scalar.dimKey,
          value: scalar.value,
          matched: matchedF,
          deviation: deviationF,
          band: [lowerF, upperF],
        },
      };
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

// ===== P4-05b 真尺寸线：端点解析与 SVG 尺寸线 =====

const FEATURE_AXIS = {
  width: 0, depth: 1, height: 2,
  radius: 0,  // cylinder/sphere 的 radius 沿 X 取直径两端（第一刀口径）
  radiusBottom: 0, radiusTop: 0,
};

/** 旋转矩阵（Rz·Ry·Rx，列向量右乘；与 v2a 求值器/Blender 探针同源）。 */
function rotationMatrixDegPublic(eulerDeg) {
  const [rx, ry, rz] = (Array.isArray(eulerDeg) ? eulerDeg : [0, 0, 0]).map((v) => (Number(v) || 0) * Math.PI / 180);
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

function mulMV(m, v) {
  return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
}

/**
 * 解析 tolerances[].feature 的两端点（世界坐标，含旋转合成）。
 * 基元 dimensions 可代数：端点 = 节点 position ± 半尺寸沿 feature 轴（经旋转合成）。
 * cylinder radius = 直径两端沿 X（第一刀口径：世界 X 轴上取 ±radius）。
 * @returns rows: 每条 { ...tolerance, endpoints: [{ from, to, axis }], resolved }
 */
function resolveToleranceEndpoints(scene, tolerances) {
  const nodes = new Map();
  for (const node of (scene && Array.isArray(scene.nodes) ? scene.nodes : [])) {
    if (node && typeof node.id === 'string') nodes.set(node.id, node);
  }
  const list = Array.isArray(tolerances) ? tolerances : [];
  const features = resolveToleranceFeatures(scene, list);
  return list.map((row, index) => {
    const resolved = features[index]?.resolved || { source: 'unresolved', value: null, matched: false, deviation: null };
    if (resolved.source !== 'dimension' || resolved.value === null) {
      return { ...row, endpoints: [], resolved };
    }
    const node = nodes.get(row.nodeId);
    const pos = (node.transform && Array.isArray(node.transform.position) ? node.transform.position : [0, 0, 0]).map(Number);
    const rot = (node.transform && Array.isArray(node.transform.rotation) ? node.transform.rotation : [0, 0, 0]).map(Number);
    const dims = node.dimensions && typeof node.dimensions === 'object' ? node.dimensions : {};
    const axisIdx = FEATURE_AXIS[row.feature] !== undefined ? FEATURE_AXIS[row.feature] : 2;
    const half = (row.feature === 'radius' ? Number(dims.radius) || 0 : (Number(dims[row.feature]) || 0) / 2);
    const isRadius = row.feature === 'radius';
    const local = [0, 0, 0];
    if (isRadius) {
      local[0] = Number(dims.radius) || 0;  // 直径两端沿 X
    } else {
      local[axisIdx] = half;
    }
    const rotMatrix = rotationMatrixDegPublic(rot);
    const centerLocal = [0, 0, 0];
    if (!isRadius) centerLocal[axisIdx] = half;
    void mulMV(rotMatrix, centerLocal);  // centerWorld 未消费（第一刀口径），保留计算可读性
    const endA = mulMV(rotMatrix, isRadius ? [Number(dims.radius) || 0, 0, 0] : local.map((v, i) => v + (i === axisIdx ? half : 0))).map((v, i) => v + pos[i]);
    const endB = mulMV(rotMatrix, isRadius ? [-Number(dims.radius) || 0, 0, 0] : local.map((v, i) => v - (i === axisIdx ? half : 0))).map((v, i) => v + pos[i]);
    const axisName = isRadius ? 'x' : (['width', 'depth', 'height'][axisIdx] ? ['x', 'y', 'z'][axisIdx] : 'z');
    return { ...row, endpoints: [{ from: endA, to: endB, axis: axisName }], resolved };
  });
}

const ORTHO_PROJECTION = {
  front: [0, 1],   // x→px, y→py
  top: [0, 2],     // x→px, z→py
  right: [1, 2],   // y→px, z→py
};

/**
 * 在 SVG 标注层内画尺寸线（线+箭头+文字）。坐标=世界端点经正交投影 + SVG viewBox 线性映射。
 * worldBounds 用于把世界坐标映射到 SVG panel 坐标。
 */
function buildGdtDimensionLines(svg, endpointRows, { view = 'front', panel = { x: 0, y: 0, width: 240, height: 240 }, worldBounds } = {}) {
  const proj = ORTHO_PROJECTION[view] || ORTHO_PROJECTION.front;
  const rows = (Array.isArray(endpointRows) ? endpointRows : []).filter(
    (row) => row.endpoints && row.endpoints.length > 0 && row.resolved?.source === 'dimension',
  );
  if (rows.length === 0 || typeof svg !== 'string') return svg;
  // viewBox 从 svg 提取（或用 panel 默认）
  const vbMatch = svg.match(/viewBox="([^"]+)"/);
  const vb = vbMatch ? vbMatch[1].split(/[, ]/).map(Number) : [panel.x, panel.y, panel.width, panel.height];
  // 世界→SVG 映射：把 worldBounds 投影到 viewBox
  const bounds = worldBounds || (() => {
    const all = rows.flatMap((row) => row.endpoints.flatMap((ep) => [ep.from, ep.to]));
    const xs = all.map((p) => p[proj[0]]);
    const ys = all.map((p) => p[proj[1]]);
    return {
      minU: Math.min(...xs), maxU: Math.max(...xs),
      minV: Math.min(...ys), maxV: Math.max(...ys),
    };
  })();
  const uRange = { min: bounds.minU ?? bounds.minX ?? 0, max: bounds.maxU ?? bounds.maxX ?? 1 };
  const vRange = { min: bounds.minV ?? bounds.minY ?? 0, max: bounds.maxV ?? bounds.maxY ?? 1 };
  const uSpan = uRange.max - uRange.min || 1;
  const vSpan = vRange.max - vRange.min || 1;
  const pad = 16;
  const scale = Math.min((vb[2] - pad * 2) / uSpan, (vb[3] - pad * 2) / vSpan);
  const toSvgU = (u) => pad + (u - uRange.min) * scale;
  const toSvgV = (v) => pad + (v - vRange.min) * scale;

  const elements = [];
  for (const row of rows) {
    for (const ep of row.endpoints) {
      const u1 = toSvgU(ep.from[proj[0]]);
      const v1 = toSvgV(ep.from[proj[1]]);
      const u2 = toSvgU(ep.to[proj[0]]);
      const v2 = toSvgV(ep.to[proj[1]]);
      const matched = row.resolved.matched === true;
      const color = matched ? '#2e7d32' : '#c62828';
      const label = `${row.feature} = ${row.resolved.value} mm（标称 ${row.nominal}）`;
      elements.push(
        `<line x1="${u1.toFixed(1)}" y1="${v1.toFixed(1)}" x2="${u2.toFixed(1)}" y2="${v2.toFixed(1)}" ` +
          `stroke="${color}" stroke-width="1" marker-start="url(#gdt-arrow)" marker-end="url(#gdt-arrow)" ` +
          `data-gdt-dimension="${row.nodeId}:${row.feature}" />`,
      );
      elements.push(
        `<text x="${((u1 + u2) / 2).toFixed(1)}" y="${((v1 + v2) / 2 - 4).toFixed(1)}" ` +
          `font-family="monospace" font-size="10" fill="${color}" text-anchor="middle" data-gdt-label="${row.nodeId}:${row.feature}">${label}</text>`,
      );
    }
  }
  const arrowDef = '<defs><marker id="gdt-arrow" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto"><path d="M0,0 L6,2 L0,4 Z" fill="currentColor"/></marker></defs>';
  const headMatch = svg.match(/<svg[^>]*>/);
  const head = headMatch ? headMatch[0] : '<svg>';
  const layer = `${head}${arrowDef}<g data-gdt-dimension>${elements.join('')}</g>${svg.slice(head.length)}`;
  return layer;
}

// ===== P4-05 完整尺寸链（BLOCK-499）：特征引用解析 + 链代数 + SVG 链层 =====

const CHAIN_AXIS_DIMS = Object.freeze({
  box: { x: 'width', y: 'depth', z: 'height' },
  cylinder: { z: 'height' },
});
const CHAIN_EPSILON = 1e-6;

/** 特征行解析（feat: id 或特征名）：节点 features[] 缓存优先，基元无缓存派生回落（D1 同源）。 */
function resolveFeatureRow(node, ref) {
  const refStr = String(ref ?? '');
  let rows = Array.isArray(node.features) ? node.features : null;
  if (!rows && (node.type === 'box' || node.type === 'cylinder' || node.type === 'sphere')) {
    rows = model3dFeatures.derivePrimitiveFeatures(node);
  }
  if (!Array.isArray(rows)) return null;
  return rows.find((f) => f && typeof f === 'object' && (f.id === refStr || f.feature === refStr)) || null;
}

/** 特征行的可代数量：解析行内数值键字符串（size/radius/height，derivePrimitiveFeatures 展开形态）。 */
function featureScalarFromRow(row) {
  if (!row || typeof row !== 'object') return { value: null, dimKey: null };
  const kv = {};
  for (const [key, raw] of Object.entries(row)) {
    if (!/^\d+$/.test(key)) continue;
    const text = String(raw);
    const idx = text.indexOf(':');
    if (idx > 0) kv[text.slice(0, idx)] = text.slice(idx + 1);
  }
  for (const [name, dimKey] of [['size', kv.dimsKey || null], ['height', 'height'], ['radius', 'radius']]) {
    const value = Number(kv[name]);
    if (kv[name] !== undefined && Number.isFinite(value)) return { value, dimKey: name === 'size' ? (kv.dimsKey || null) : dimKey };
  }
  return { value: null, dimKey: null };
}

/** 链 link 解析：特征引用优先，dimensions 键回落（两路径同一代数事实）。 */
function resolveChainLinkScalar(node, ref) {
  const featureRow = resolveFeatureRow(node, ref);
  if (featureRow) {
    const scalar = featureScalarFromRow(featureRow);
    if (scalar.value !== null) return { source: 'feature', value: scalar.value };
  }
  const dims = node.dimensions && typeof node.dimensions === 'object' ? node.dimensions : null;
  const allowed = DIMENSION_FEATURES_BY_TYPE[node.type] || [];
  if (dims && allowed.includes(ref) && isFiniteNumber(dims[ref])) return { source: 'dimension', value: Number(dims[ref]) };
  return null;
}

/**
 * 尺寸链代数（D5 数值一致性）：links 逐项解析 → Σ 与 total 比对（|Σ−total|≤1e-6 → consistent）。
 * total 缺省=该节点沿 axis 的 dimension 总量（box x/y/z、cylinder z；无法派生 → total_unavailable）。
 * @returns rows: [{ id, nodeId, links, linkValues, sum, total, deviation, consistent, resolved, reason? }]
 */
function buildDimensionChain(scene, chainSpecs) {
  const nodes = new Map();
  for (const node of (scene && Array.isArray(scene.nodes) ? scene.nodes : [])) {
    if (node && typeof node.id === 'string') nodes.set(node.id, node);
  }
  const list = Array.isArray(chainSpecs) ? chainSpecs : [];
  return list.map((spec) => {
    const base = { ...spec };
    const node = nodes.get(spec.nodeId);
    if (!node) return { ...base, resolved: false, reason: 'node_not_found', consistent: false, sum: null, total: null, deviation: null, linkValues: [] };
    const links = Array.isArray(spec.links) ? spec.links : [];
    const linkValues = [];
    for (const link of links) {
      // link 形态：'ref'（本节点）| { nodeId, ref }（跨节点装配链——尺寸链的工程本义）。
      const isObjectLink = link && typeof link === 'object' && !Array.isArray(link);
      const linkNode = isObjectLink ? nodes.get(link.nodeId) : node;
      const ref = isObjectLink ? link.ref : link;
      const label = isObjectLink ? `${link.nodeId}.${ref}` : String(ref);
      if (!linkNode) return { ...base, resolved: false, reason: 'link_node_not_found', link: label, consistent: false, sum: null, total: null, deviation: null, linkValues };
      const scalar = resolveChainLinkScalar(linkNode, ref);
      if (!scalar) return { ...base, resolved: false, reason: 'link_unresolved', link: label, consistent: false, sum: null, total: null, deviation: null, linkValues };
      linkValues.push({ ref: label, value: scalar.value, source: scalar.source });
    }
    const sum = linkValues.reduce((acc, item) => acc + item.value, 0);
    let total = null;
    if (isFiniteNumber(spec.total)) total = Number(spec.total);
    else {
      const axis = spec.axis === undefined ? 'z' : spec.axis;
      const dimKey = (CHAIN_AXIS_DIMS[node.type] || {})[axis];
      const dims = node.dimensions && typeof node.dimensions === 'object' ? node.dimensions : null;
      if (dimKey && dims && isFiniteNumber(dims[dimKey])) total = Number(dims[dimKey]);
    }
    if (!isFiniteNumber(total)) return { ...base, resolved: false, reason: 'total_unavailable', linkValues, sum: Number(sum.toFixed(4)), total: null, deviation: null, consistent: false };
    const deviation = Number((sum - total).toFixed(4));
    const consistent = Math.abs(sum - total) <= CHAIN_EPSILON;
    return { ...base, resolved: true, linkValues, sum: Number(sum.toFixed(4)), total, deviation, consistent };
  });
}

/** SVG 链层：数字进文本（标注文本可复核，D5）；有链才叠层；返回以 </svg> 收尾。 */
function buildChainAnnotationLayer(svg, chainRows) {
  const drawable = (Array.isArray(chainRows) ? chainRows : []).filter((row) => row.resolved);
  if (drawable.length === 0 || typeof svg !== 'string' || !svg.endsWith('</svg>')) return svg;
  const lines = [];
  let y = 18;
  for (const row of drawable) {
    const mark = row.consistent ? '✓' : '✗';
    const color = row.consistent ? '#2e7d32' : '#c62828';
    const linksText = (row.linkValues || []).map((item) => `${item.ref}=${item.value}`).join(' + ');
    lines.push(
      `<text x="8" y="${y}" font-family="monospace" font-size="11" fill="${color}" data-gdt-chain="${row.id || row.nodeId}">` +
        `${mark} ${row.id || row.nodeId}: ${linksText} → Σ=${row.sum} vs total=${row.total}（偏差 ${row.deviation}）</text>`,
    );
    y += 16;
  }
  const layer = `<g data-gdt-chains role="list" aria-label="尺寸链">${lines.join('')}</g></svg>`;
  return svg.slice(0, svg.length - '</svg>'.length) + layer;
}

module.exports = { resolveToleranceFeatures, buildGdtAnnotationLayer, DIMENSION_FEATURES_BY_TYPE, resolveToleranceEndpoints, buildGdtDimensionLines, FEATURE_AXIS, buildDimensionChain, buildChainAnnotationLayer };
