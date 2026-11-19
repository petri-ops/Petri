/**
 * BLOCK-322 P3-03 v2b — D2/D1 契约测（HK-01 红绿先行 · BLOCK-494 落骨架 → BLOCK-498 激活落地）。
 *
 * 历史：BLOCK-494 以 skip 形态承载（deferred_user_ruling）；2026-11-19 用户发令 A 组 #2 开工
 * （BLOCK-498），本文件去掉 skip 包装纳入常规定向集（红证据=acceptance/block498-v2b-d2-contract/hk01-red.txt）。
 *
 * 断言来源（严格从已裁决形态导出，不发明新契约）：
 *   - D2（RULING-04 §4）：mate 约束白名单新增可选 aFeature/bFeature 键；旧约束零迁移可解；
 *     明确不采用 nodeId#featureId 字符串改法（校验须拒绝）。
 *   - D1（RULING-04 §4）：features[] 只能是以 sourceSha256（导入件）/ dimensions 指纹（基元）
 *     为版本键的派生缓存；与源不一致 fail-closed（错误码 features_stale_version_mismatch，
 *     执法口径沿 mesh_source_hash_required 族）；特征 id=几何签名（feat:+sha256 前 24 位，
 *     v2b-stability-probe 定案：内核 subShapeHashes 同进程两次 import 即漂移，禁作跨会话 id）。
 *   - D3（RULING-04 §4）：特征派生链禁 OCCT 建模 API（静态负测）。
 *   - D1③（BLOCK-498 划界）：本票=后端契约票——基元派生接线进 scene3d（deriveNodeFeatureTable
 *     消费 derivePrimitiveFeatures）；CAD 导入链抽特征（deriveImportFeatures 消费）=第二票，
 *     本票只钉接口在册。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const scene3dSource = readFileSync(new URL('../core/petri-server/helpers/scene3d.js', import.meta.url), 'utf8');
const featuresSource = readFileSync(new URL('../core/petri-server/helpers/model3d-features.js', import.meta.url), 'utf8');

const { validateSceneSpec, resolveSceneSpec } = require('../core/petri-server/helpers/scene3d.js');
const { derivePrimitiveFeatures, deriveImportFeatures, featureId } = require('../core/petri-server/helpers/model3d-features.js');

const boxNode = (id, position, dims) => ({
  id,
  type: 'box',
  position,
  dimensions: dims,
});

// 骨架自检（永绿）：保证断言集与契约锚不被静默掏空（掏空=契约骨架腐朽）。
test('v2b D2/D1 骨架自检：断言集与契约锚在场', () => {
  const self = readFileSync(new URL('./block322-p3-03-v2b-d2-contract.test.mjs', import.meta.url), 'utf8');
  for (const anchor of [
    'features_stale_version_mismatch',
    'mesh_source_hash_required',
    "includes('makeBox')",
    'feat:[0-9a-f]{24}',
  ]) {
    assert.ok(self.includes(anchor), `骨架断言锚丢失：${anchor}`);
  }
});

// D3 静态负测（对已实现面同样生效，永绿）：特征派生库禁 OCCT 建模 API。
test('v2b D3：特征派生链禁 OCCT 建模 API（静态负测，已实现面受检）', () => {
  const banned = ['makeBox', 'makeCylinder', 'makeCone', 'makeSphere', 'extrude', 'revolve', 'loft', 'sweep', 'fillet', 'chamfer', 'booleanOp'];
  const hits = banned.filter((api) => featuresSource.includes(api));
  assert.deepEqual(hits, [], `model3d-features.js 出现禁用建模 API：${hits.join(',')}`);
});

test('v2b D2①：mate 白名单收 aFeature/bFeature 可选键', () => {
  const base = {
    version: 'scene3d/v1',
    parameters: {},
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    nodes: [
      boxNode('a', [0, 0, 0], { width: 120, depth: 80, height: 30 }),
      boxNode('b', [0, 0, 40], { width: 120, depth: 80, height: 20 }),
    ],
    constraints: [{
      kind: 'mate', a: 'a', b: 'b', aFace: '+z', bFace: '-z',
      aFeature: 'feat:0123456789abcdef01234567', bFeature: 'feat:89abcdef0123456789abcdef',
    }],
  };
  const result = validateSceneSpec(base);
  assert.equal(result.ok, true, `aFeature/bFeature 应在 mate 白名单且可解析：${JSON.stringify(result.errors || [])}`);
});

test('v2b D2②：无新键的旧 mate 约束零迁移可解（兼容锚）', () => {
  const legacy = {
    version: 'scene3d/v1',
    parameters: {},
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    nodes: [
      boxNode('a', [0, 0, 0], { width: 120, depth: 80, height: 30 }),
      boxNode('b', [0, 0, 40], { width: 120, depth: 80, height: 20 }),
    ],
    constraints: [{ kind: 'mate', a: 'a', b: 'b', aFace: '+z', bFace: '-z' }],
  };
  const legacyResult = validateSceneSpec(legacy);
  assert.equal(legacyResult.ok, true, `旧约束（无 aFeature/bFeature）必须零迁移继续合法：${JSON.stringify(legacyResult.errors || [])}`);
});

test('v2b D2③：禁 nodeId#featureId 字符串改法（D2 负向裁决锚）', () => {
  const mixed = {
    version: 'scene3d/v1',
    parameters: {},
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    nodes: [
      boxNode('a', [0, 0, 0], { width: 120, depth: 80, height: 30 }),
      boxNode('b', [0, 0, 40], { width: 120, depth: 80, height: 20 }),
    ],
    constraints: [{ kind: 'mate', a: 'a', b: 'nodeB#face:-z', aFace: '+z', bFace: '-z' }],
  };
  const result = validateSceneSpec(mixed);
  assert.ok(result.ok === false || (result.errors || []).length > 0, 'nodeId#featureId 字符串语法必须被拒绝（D2 负向裁决）');
});

test('v2b D2④：引用特征未解析（节点带 features 表但引用不在册）fail-closed', () => {
  const nodes = [
    {
      id: 'a', type: 'box', position: [0, 0, 0],
      dimensions: { width: 120, depth: 80, height: 30 },
      featuresVersionKey: 'a'.repeat(64),
      features: [{ id: 'feat:0123456789abcdef01234567', kind: 'plane', feature: '+z' }],
    },
    boxNode('b', [0, 0, 40], { width: 120, depth: 80, height: 20 }),
  ];
  const unresolved = {
    version: 'scene3d/v1',
    parameters: {},
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    nodes,
    constraints: [{ kind: 'mate', a: 'a', b: 'b', aFace: '+z', bFace: '-z', aFeature: 'feat:ffffffffffffffffffffffff' }],
  };
  const result = validateSceneSpec(unresolved);
  assert.ok((result.errors || []).some((e) => String(e).includes('constraint_feature_unresolved')),
    `节点带特征表时引用必须可解析：${JSON.stringify(result.errors || [])}`);
});

test('v2b D1①：features[] 派生缓存与源不一致 fail-closed（版本键=sha/dimensions 指纹）', () => {
  const stale = {
    version: 'scene3d/v1',
    parameters: {},
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    nodes: [{
      id: 'imported', type: 'mesh-reference', position: [0, 0, 0],
      source: { path: 'model3d/runs/x/model.glb', sourceSha256: 'a'.repeat(64) },
      featuresVersionKey: 'b'.repeat(64),
      features: [{ id: 'feat:0123456789abcdef01234567', kind: 'plane' }],
    }],
    constraints: [],
  };
  const result = resolveSceneSpec(stale);
  const flat = JSON.stringify(result.errors || result.error || result);
  assert.ok(flat.includes('features_stale_version_mismatch'),
    `features 与源版本键不一致必须以 features_stale_version_mismatch fail-closed，实际：${flat}`);
});

test('v2b D1②：特征 id=几何签名（禁内核哈希作跨会话 id）', () => {
  const node = { id: 'p', type: 'box', dimensions: { width: 120, depth: 80, height: 30 } };
  const first = derivePrimitiveFeatures(node);
  const second = derivePrimitiveFeatures(node);
  assert.deepEqual(first.map((f) => f.id), second.map((f) => f.id), '同输入两次派生 id 必须全等（几何签名可复现）');
  assert.ok(first.every((f) => /^feat:[0-9a-f]{24}$/.test(f.id)), '特征 id 必须是几何签名（feat: + sha256 前 24 位，探针定案形态）');
  assert.equal(featureId(['probe', 'x']), featureId(['probe', 'x']), 'featureId 纯函数可复现');
});

test('v2b D1③：派生消费接线——derivePrimitiveFeatures 进 scene3d（基元自动派生）；deriveImportFeatures 接口在册（导入链抽取=第二票）', () => {
  // 本票（BLOCK-498 后端契约票）：scene3d 必须消费基元派生（自动特征表导出）；
  // CAD 导入链抽特征=第二票，本票只钉 deriveImportFeatures 接口在册（不悬空）。
  assert.ok(scene3dSource.includes("require('./model3d-features')"), 'scene3d 必须接线特征库单源');
  assert.ok(scene3dSource.includes('derivePrimitiveFeatures'), 'scene3d 必须消费基元派生');
  assert.equal(typeof deriveImportFeatures, 'function', 'deriveImportFeatures 接口必须在册（导入链第二票的接缝）');
});
