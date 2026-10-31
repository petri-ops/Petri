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

module.exports = { resolveToleranceFeatures, buildGdtAnnotationLayer, DIMENSION_FEATURES_BY_TYPE, resolveToleranceEndpoints, buildGdtDimensionLines, FEATURE_AXIS };
