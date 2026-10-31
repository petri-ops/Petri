/**
 * helpers/model3d-features.js — BLOCK-322 P3-03 v2b 第一票：特征表生成与几何签名（纯逻辑层）。
 *
 * 稳定性探针定案（acceptance/block-322-p3/v2b-stability-probe.json）：
 *   内核 subShapeHashes 同进程两次 import 即漂移 → 特征 id 一律用**几何签名**
 *   （surfaceType + 量化体积 + 量化 bbox 的 sha256）；内核哈希仅作同会话内参考。
 *
 * 范围（v2b）：
 *   - 基元自动派生：box→6 面平面 / cylinder→2 平面+1 圆柱侧 / sphere→1 球面；
 *   - CAD 导入件（face 枚举数组）：plane/cylinder/cone/sphere 可引用，
 *     bspline 等未知类型如实 other 并拒绝贴合（v2c/导入面引用的边界）；
 *   - 特征 id = sha256('feature/v1|' + kind + '|' + 量化几何参数)，跨会话可复现。
 */

import { createHash } from 'node:crypto';

const FEATURE_KINDS = Object.freeze(['plane', 'cylinder', 'cone', 'sphere', 'other']);
const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const MATE_PLANAR_FACES_BY_TYPE = {
  box: ['+x', '-x', '+y', '-y', '+z', '-z'],
  cylinder: ['+z', '-z'],
};

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function quant2(value) {
  return Number(Number(value).toFixed(2));
}

/** 特征 id：kind + 量化几何参数的 sha256（跨会话可复现，与内核哈希解耦）。 */
function featureId(parts) {
  return 'feat:' + sha256('feature/v1|' + parts.join('|')).slice(0, 24);
}

/**
 * 基元节点自动派生特征表。
 * @returns Array<{ id, kind, face, surface, …几何参数 }>
 */
function derivePrimitiveFeatures(node) {
  const dims = node.dimensions && typeof node.dimensions === 'object' ? node.dimensions : {};
  const features = [];
  const push = (feature, kind, extra) => {
    const parts = [node.type, feature, kind, ...(extra || [])];
    features.push({ id: featureId(parts), feature, kind, parts, ...extra });
  };
  const half = {
    x: (Number(dims.width) || 0) / 2,
    y: (Number(dims.depth) || 0) / 2,
    z: (Number(dims.height) || 0) / 2,
  };
  if (node.type === 'box') {
    for (const face of MATE_PLANAR_FACES_BY_TYPE.box) {
      const meta = face.match(/^([+-])([xyz])$/);
      const sign = meta[1] === '+' ? 1 : -1;
      const axis = meta[2];
      const idx = AXIS_INDEX[axis];
      const dimsKey = { x: 'width', y: 'depth', z: 'height' }[axis];
      const center = [0, 0, 0];
      center[idx] = half[axis] * sign;
      push(face, 'plane', [`center:${center.map(quant2).join(',')}`, `dimsKey:${dimsKey}`, `size:${quant2(dims[dimsKey])}`]);
    }
  } else if (node.type === 'cylinder') {
    const radius = quant2(dims.radius);
    for (const face of MATE_PLANAR_FACES_BY_TYPE.cylinder) {
      const sign = face === '+z' ? 1 : -1;
      push(face, 'plane', [`center:0,0,${quant2(half.z * sign)}`, `radius:${radius}`]);
    }
    push('side', 'cylinder', [`radius:${radius}`, `height:${quant2(dims.height)}`]);
  } else if (node.type === 'sphere') {
    push('surface', 'sphere', [`radius:${quant2(dims.radius)}`]);
  }
  return features;
}

/** 基元节点是否有可贴合平面（v2a 白名单继承）。 */
function primitiveHasPlanarFace(node) {
  return Boolean(MATE_PLANAR_FACES_BY_TYPE[node.type]);
}

/**
 * CAD 导入件特征表（face 枚举数组 → 特征表）。
 * @param faces Array<{ type, volumeMm3?, bboxMm? }> —— 内核探针/消费侧枚举出的面
 * @returns 可引用特征表；bspline 等 → kind='other' 且 mateAllowed=false
 */
function deriveImportFeatures(faces) {
  const list = Array.isArray(faces) ? faces : [];
  return list.map((face, index) => {
    const kind = FEATURE_KINDS.includes(face.type) ? face.type : 'other';
    const bb = Array.isArray(face.bboxMm) ? face.bboxMm.map(quant2) : null;
    const vol = isFinite(face.volumeMm3) ? quant2(face.volumeMm3) : null;
    const id = featureId(['import', kind, vol, bb ? bb.join(',') : 'unknown', String(index)]);
    return {
      id,
      index,
      kind,
      mateAllowed: kind === 'plane' || kind === 'cylinder' || kind === 'cone',
      ...(bb ? { bboxMm: bb } : {}),
      ...(vol !== null ? { volumeMm3: vol } : {}),
    };
  });
}

export {
  FEATURE_KINDS,
  derivePrimitiveFeatures,
  deriveImportFeatures,
  featureId,
  primitiveHasPlanarFace,
};
