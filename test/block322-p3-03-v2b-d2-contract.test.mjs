/**
 * BLOCK-322 P3-03 v2b — D2/D1 契约测骨架（HK-01 红绿先行 · BLOCK-494 W2 准备批落档）。
 *
 * 状态：deferred_user_ruling —— 断言对象（D2 白名单键 aFeature/bFeature、D1 features[] 派生缓存
 * 求值器消费、导入链抽特征接线、sidecar sha 锚定）**尚未实现**；本文件以 skip 形态承载骨架，
 * 实现票获用户发令启动时：
 *   1. 先 `BLOCK322_V2B_SKELETON_ACTIVE=1 node --test test/block322-p3-03-v2b-d2-contract.test.mjs`
 *      复跑捕获真实红（缺席红；红证据先例=acceptance/block494-w2-ticket-readiness/v2b-d2-skeleton-red.txt）；
 *   2. 落地最小实现转绿（BLOCK-491 D1–D5 已裁决形态，禁发明新契约）；
 *   3. 去掉本文件顶部 ACTIVE 开关的 skip 包装，纳入常规定向集。
 *
 * 断言来源（严格从已裁决形态导出，不发明新契约）：
 *   - D2（RULING-04 §4）：mate 约束白名单新增可选 aFeature/bFeature 键；旧约束零迁移可解；
 *     明确不采用 nodeId#featureId 字符串改法。
 *   - D1（RULING-04 §4）：features[] 只能是以 sourceSha256（导入件）/ dimensions 指纹（基元）
 *     为版本键的派生缓存；与源不一致 fail-closed（执法口径沿 mesh_source_hash_required，
 *     scene3d.js mesh-reference 校验区）；特征 id=几何签名（v2b-stability-probe 定案：
 *     内核 subShapeHashes 同进程两次 import 即漂移，禁作跨会话 id）。
 *   - D3（RULING-04 §4）：特征派生链禁 OCCT 建模 API（静态负测，已实现面同样受检）。
 *   - D5（RULING-04 §4）：数值一致性判据——先例=P4-05b 第一刀（resolveToleranceEndpoints +
 *     SVG 数值对账，acceptance/block-322-ruling04/p405b-live-macos.json）。
 *
 * 实况锚（2026-11-19 核对，见 docs/block494-w2-implementation-tickets-readiness-plan.md §1）：
 *   model3d-features.js（derivePrimitiveFeatures/deriveImportFeatures/featureId）在场但未被
 *   求值器/导入链消费；scene3d.js 的 CONSTRAINT_FIELDS.mate 白名单不含 aFeature/bFeature。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ACTIVE = process.env.BLOCK322_V2B_SKELETON_ACTIVE === '1';
const SKIP_REASON =
  'deferred_user_ruling — D2/D1 后端契约未启动（BLOCK-492 W2 只备骨架，BLOCK-494 落档）；' +
  '实现票发令后设 BLOCK322_V2B_SKELETON_ACTIVE=1 复跑捕获缺席红，再实现转绿';

const scene3dSource = readFileSync(new URL('../core/petri-server/helpers/scene3d.js', import.meta.url), 'utf8');
const featuresSource = readFileSync(new URL('../core/petri-server/helpers/model3d-features.js', import.meta.url), 'utf8');

// 骨架自检（永绿）：保证断言集与激活开关不被静默掏空（掏空=契约骨架腐朽）。
test('v2b D2/D1 骨架自检：断言集在场且激活开关语义未被改写', () => {
  const self = readFileSync(new URL('./block322-p3-03-v2b-d2-contract.test.mjs', import.meta.url), 'utf8');
  for (const anchor of [
    "process.env.BLOCK322_V2B_SKELETON_ACTIVE === '1'",
    'aFeature 不在 mate 白名单',
    'features_stale_version_mismatch',
    "'feat:' + sha256",
    'mesh_source_hash_required',
    "includes('makeBox')",
  ]) {
    assert.ok(self.includes(anchor), `骨架断言锚丢失：${anchor}`);
  }
});

// D3 静态负测（对已实现面同样生效，永绿）：特征派生库禁 OCCT 建模 API（makeBox/extrude/
// revolve/fillet/booleanOp 等）——D3「禁 OCCT 建几何」的具体化；只读分析方法不受限。
test('v2b D3：特征派生链禁 OCCT 建模 API（静态负测，已实现面受检）', () => {
  const banned = ['makeBox', 'makeCylinder', 'makeCone', 'makeSphere', 'extrude', 'revolve', 'loft', 'sweep', 'fillet', 'chamfer', 'booleanOp'];
  const hits = banned.filter((api) => featuresSource.includes(api));
  assert.deepEqual(hits, [], `model3d-features.js 出现禁用建模 API：${hits.join(',')}`);
});

// 以下为激活后立即转红的缺席断言（skip 形态承载；实现票启动时转绿）。

test('v2b D2①：mate 白名单收 aFeature/bFeature 可选键（当前树红：不在白名单）', { skip: ACTIVE ? false : SKIP_REASON }, () => {
  const { validateSceneSpec } = require('../core/petri-server/helpers/scene3d.js');
  const base = {
    version: 'scene3d/v1',
    parameters: {},
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    nodes: [
      { id: 'a', type: 'box', position: [0, 0, 0], dimensions: { width: 120, depth: 80, height: 30 } },
      { id: 'b', type: 'box', position: [0, 0, 40], dimensions: { width: 120, depth: 80, height: 20 } },
    ],
    constraints: [{
      kind: 'mate', a: 'a', b: 'b', aFace: '+z', bFace: '-z',
      aFeature: 'sig:planar+z', bFeature: 'sig:planar-z',
    }],
  };
  const result = validateSceneSpec(base);
  assert.deepEqual(result.errors, [], `aFeature/bFeature 应在 mate 白名单：${result.errors.join(' / ')}`);
});

test('v2b D2②：无新键的旧 mate 约束零迁移可解（兼容锚，激活后绿）', { skip: ACTIVE ? false : SKIP_REASON }, () => {
  const { validateSceneSpec } = require('../core/petri-server/helpers/scene3d.js');
  const legacy = {
    version: 'scene3d/v1',
    parameters: {},
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    nodes: [
      { id: 'a', type: 'box', position: [0, 0, 0], dimensions: { width: 120, depth: 80, height: 30 } },
      { id: 'b', type: 'box', position: [0, 0, 40], dimensions: { width: 120, depth: 80, height: 20 } },
    ],
    constraints: [{ kind: 'mate', a: 'a', b: 'b', aFace: '+z', bFace: '-z' }],
  };
  const legacyResult = validateSceneSpec(legacy);
  assert.equal(legacyResult.ok, true, `旧约束（无 aFeature/bFeature）必须零迁移继续合法：${JSON.stringify(legacyResult.errors || [])}`);
});

test('v2b D2③：禁 nodeId#featureId 字符串改法（D2 负向裁决锚）', { skip: ACTIVE ? false : SKIP_REASON }, () => {
  // D2 明确拒绝把 a/b 改成 "nodeId#featureId" 字符串——实现不得引入该语法（校验须拒绝或忽略该形态并报错）。
  const { validateSceneSpec } = require('../core/petri-server/helpers/scene3d.js');
  const mixed = {
    version: 'scene3d/v1',
    parameters: {},
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    nodes: [
      { id: 'a', type: 'box', position: [0, 0, 0], dimensions: { width: 120, depth: 80, height: 30 } },
      { id: 'b', type: 'box', position: [0, 0, 40], dimensions: { width: 120, depth: 80, height: 20 } },
    ],
    constraints: [{ kind: 'mate', a: 'a', b: 'nodeB#face:-z', aFace: '+z', bFace: '-z' }],
  };
  const result = validateSceneSpec(mixed);
  assert.ok(result.ok === false || result.errors.length > 0, 'nodeId#featureId 字符串语法必须被拒绝（D2 负向裁决）');
});

test('v2b D1①：features[] 派生缓存与源不一致 fail-closed（版本键=sha/dimensions）', { skip: ACTIVE ? false : SKIP_REASON }, () => {
  // D1：features 只能是派生缓存——版本键=sourceSha256（导入件）/ dimensions 指纹（基元）；
  // 篡改 features（或源变化未重派生）必须 fail-closed，错误码口径沿 mesh_source_hash_required。
  const { resolveSceneSpec } = require('../core/petri-server/helpers/scene3d.js');
  const stale = {
    version: 'scene3d/v1',
    parameters: {},
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    nodes: [{
      id: 'imported', type: 'mesh-reference', position: [0, 0, 0],
      source: { path: 'model3d/runs/x/model.glb', sha256: 'a'.repeat(64) },
      features: [{ id: 'sig:planar+z', kind: 'plane', staleVersionKey: 'b'.repeat(64) }],
    }],
    constraints: [],
  };
  const result = resolveSceneSpec(stale);
  const flat = JSON.stringify(result.errors || result.error || result);
  // 精确错误码（D1 裁决形态）：实现票落地时必须采用该码（沿 mesh_source_hash_required 执法口径族）。
  assert.ok(flat.includes('features_stale_version_mismatch'),
    `features 与源版本键不一致必须以 features_stale_version_mismatch fail-closed，实际：${flat}`);
});

test('v2b D1②：特征 id=几何签名（禁内核哈希作跨会话 id）', { skip: ACTIVE ? false : SKIP_REASON }, () => {
  // v2b-stability-probe 定案：内核 subShapeHashes 同进程两次 import 即漂移 → 特征 id 一律几何签名。
  const { derivePrimitiveFeatures } = require('../core/petri-server/helpers/model3d-features.js');
  const node = { id: 'p', type: 'box', dimensions: { width: 120, depth: 80, height: 30 } };
  const first = derivePrimitiveFeatures(node);
  const second = derivePrimitiveFeatures(node);
  assert.deepEqual(first.map((f) => f.id), second.map((f) => f.id), '同输入两次派生 id 必须全等（几何签名可复现）');
  assert.ok(first.every((f) => /^feat:[0-9a-f]{24}$/.test(f.id)), '特征 id 必须是几何签名（feat: + sha256 前 24 位，v2b-stability-probe 定案形态）');
});

test('v2b D1③：导入链抽特征接线（deriveImportFeatures 被导入链消费）', { skip: ACTIVE ? false : SKIP_REASON }, () => {
  // 实况：deriveImportFeatures 在 core 内零调用者（除自身导出）——导入链（mesh-assets/mesh-reference
  // 入链）必须消费它产特征表，否则导入件特征引用无来源。
  const consumers = [
    readFileSync(new URL('../core/petri-server/helpers/mesh-assets.js', import.meta.url), 'utf8'),
    scene3dSource,
  ].join('\n');
  assert.ok(consumers.includes('deriveImportFeatures'), '导入链必须接线 deriveImportFeatures（当前树红：零调用者）');
});
