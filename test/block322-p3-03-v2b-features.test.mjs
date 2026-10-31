/**
 * BLOCK-322 P3-03 v2b 第一票 — 特征表生成与几何签名契约（红绿先行）。
 *
 * 稳定性探针定案（acceptance/block-322-p3/v2b-stability-probe.json）：
 *   内核 subShapeHashes 同进程两次 import 即漂移 → 特征 id 一律用几何签名（sha256）。
 *
 * 契约：
 *   ① derivePrimitiveFeatures：box 6 面平面 / cylinder 2 平面+1 圆柱侧 / sphere 1 球面；
 *      特征 id 跨调用可复现（同输入两次生成 id 全等）；
 *   ② deriveImportFeatures：plane/cylinder/cone 可引用，bspline 等 → kind='other' + mateAllowed=false；
 *   ③ face 引用可解析：featureId 在表中可反查（引用不悬空）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  derivePrimitiveFeatures,
  deriveImportFeatures,
  featureId,
  primitiveHasPlanarFace,
} = require('../core/petri-server/helpers/model3d-features.js');

test('P3-03 v2b ①：基元特征表派生——box 6 平面/cylinder 2 平面+1 圆柱侧', () => {
  const boxFeatures = derivePrimitiveFeatures({ id: 'base', type: 'box', dimensions: { width: 120, depth: 80, height: 30 } });
  assert.equal(boxFeatures.length, 6);
  assert.ok(boxFeatures.every((f) => f.kind === 'plane'));
  const cylFeatures = derivePrimitiveFeatures({ id: 'boss', type: 'cylinder', dimensions: { radius: 40, height: 25 } });
  assert.equal(cylFeatures.filter((f) => f.kind === 'plane').length, 2);
  assert.equal(cylFeatures.filter((f) => f.kind === 'cylinder').length, 1);
  assert.ok(cylFeatures.some((f) => f.feature === 'side'));
});

test('P3-03 v2b ②：特征 id 跨调用可复现（几何签名稳定性的契约锚）', () => {
  const node = { id: 'a', type: 'box', dimensions: { width: 120, depth: 80, height: 30 } };
  const first = derivePrimitiveFeatures(node);
  const second = derivePrimitiveFeatures(node);
  assert.deepEqual(first.map((f) => f.id), second.map((f) => f.id));
  // 尺寸变化 → id 变化（几何签名敏感）
  const changed = derivePrimitiveFeatures({ id: 'a', type: 'box', dimensions: { width: 121, depth: 80, height: 30 } });
  assert.notDeepEqual(first.map((f) => f.id), changed.map((f) => f.id));
});

test('P3-03 v2b ③：导入件特征——bspline 如实 other 且拒绝贴合', () => {
  const features = deriveImportFeatures([
    { type: 'plane', volumeMm3: 0, bboxMm: [0, 10, 0, 10, 0, 0.5] },
    { type: 'bspline', volumeMm3: 12.5, bboxMm: [0, 10, 0, 10, 0, 2] },
  ]);
  assert.equal(features[0].kind, 'plane');
  assert.equal(features[0].mateAllowed, true);
  assert.equal(features[1].kind, 'other');
  assert.equal(features[1].mateAllowed, false);
  assert.ok(features.every((f) => f.id.startsWith('feat:')));
});

test('P3-03 v2b ④：face 引用不悬空——featureId 可在表中反查', () => {
  const node = { id: 'a', type: 'box', dimensions: { width: 120, depth: 80, height: 30 } };
  const features = derivePrimitiveFeatures(node);
  const first = features[0];
  // 反查：行携带签名 parts（审计可逆），同 parts 再生成必命中表中 id
  const regenerated = featureId(first.parts);
  assert.ok(features.some((f) => f.id === regenerated), `parts 反查失败：${regenerated}`);
  assert.equal(primitiveHasPlanarFace(node), true);
});
