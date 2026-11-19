/**
 * BLOCK-504 P3-03 v2b 第二票 — 导入链抽特征 + 前端编辑器切键契约测（HK-01 红绿先行）。
 *
 * 断言严格从已裁决形态导出（RULING-04 §5 / D1-D3 / BLOCK-498 第一票接缝）：
 *   - 接缝=buildImportFeatureTable（scene3d 已导出，透传 deriveImportFeatures）；
 *   - 导入链 occt-wasm **只读** faces 枚举（禁建模 API=D3），真 STEP 6 面；
 *   - features[]/featuresVersionKey=sourceSha256 写入 node，sidecar provenance 锚定（sha 一致）；
 *   - IGES 网格无 B-rep faces 如实不写 features（零编造）；
 *   - 前端 SceneConstraintEditor 发送面含 aFeature/bFeature 契约键（additive，aFace/bFace 求值主键保留）；
 *   - sceneFeatures 优先消费 node.features 派生缓存。
 *
 * 红证据=acceptance/block504-v2b-import-features/hk01-red.txt；绿后本文件常驻。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { OcctKernel } from 'occt-wasm';

const require = createRequire(import.meta.url);
const cadExchange = require('../core/petri-server/helpers/cad-exchange.js');
const assets = require('../core/petri-server/helpers/model3d-assets.js');
const scene3d = require('../core/petri-server/helpers/scene3d.js');
const model3dFeatures = require('../core/petri-server/helpers/model3d-features.js');

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const cadSource = read('../core/petri-server/helpers/cad-exchange.js');
const assetsSource = read('../core/petri-server/helpers/model3d-assets.js');
const editorSource = read('../frontend/src/components/work-surface/SceneConstraintEditor.tsx');
const frontFeaturesSource = read('../frontend/src/lib/workSurface/sceneFeatures.ts');
const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'model3d');

function workspace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'v2b-import-')); }

async function sampleStep() {
  const kernel = await OcctKernel.init();
  try {
    const box = kernel.makeBox(10, 20, 30);
    return Buffer.from(kernel.exportStep(box, { schema: 'AP214' }));
  } finally {
    kernel[Symbol.dispose]();
  }
}

// ── 接缝在册（第一票基线，永绿锚，防第二票把接缝掏空） ─────────────────────────
test('v2b-2 接缝：buildImportFeatureTable 在册且透传 deriveImportFeatures', () => {
  assert.equal(typeof scene3d.buildImportFeatureTable, 'function');
  const faces = [{ type: 'plane', volumeMm3: 0, bboxMm: [0, 0, 0, 1, 1, 0] }];
  const viaSeam = scene3d.buildImportFeatureTable(faces);
  const direct = model3dFeatures.deriveImportFeatures(faces);
  assert.deepEqual(viaSeam, direct, '接缝结果必须与特征库派生逐值一致（单源）');
  assert.ok(viaSeam[0].id.startsWith('feat:'), '特征 id 必须是几何签名');
  assert.equal(viaSeam[0].kind, 'plane');
  assert.equal(viaSeam[0].mateAllowed, true);
});

// ── 红①：occt-wasm 只读 faces 枚举（真 STEP） ──────────────────────────────────
test('v2b-2 导入链：extractImportFaces 真 STEP 只读枚举 6 平面 + 6 元 bbox', async () => {
  assert.equal(typeof cadExchange.extractImportFaces, 'function', 'cad-exchange 必须导出 extractImportFaces（只读面枚举）');
  const result = await cadExchange.extractImportFaces({ bytes: await sampleStep() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.faces.length, 6, 'box STEP 必须枚举出 6 个面');
  assert.ok(result.faces.every((f) => f.type === 'plane'), 'box 六面全部 plane');
  assert.ok(result.faces.every((f) => Array.isArray(f.bboxMm) && f.bboxMm.length === 6), '每面须带 6 元 bbox 数组');
  assert.ok(result.faces.every((f) => Number.isFinite(f.volumeMm3)), '每面须带数值 volumeMm3');
  assert.equal(result.summary?.kernel, 'occt-wasm');
});

// ── 红②：D3 静态负测（extractImportFaces 只读，禁建模 API） ─────────────────────
test('v2b-2 D3：extractImportFaces 禁 OCCT 建模 API（只读分析）', () => {
  const match = cadSource.match(/async function extractImportFaces[\s\S]*?\n\}/);
  assert.ok(match, '须能定位 extractImportFaces 函数体');
  const banned = ['makeBox', 'makeCylinder', 'makeCone', 'makeSphere', 'makeSolid', 'sew', 'makeCompound', 'extrude', 'revolve', 'loft', 'sweep', 'fillet', 'chamfer', 'booleanOp'];
  const hits = banned.filter((api) => match[0].includes(api));
  assert.deepEqual(hits, [], `extractImportFaces 出现禁用建模 API：${hits.join(',')}`);
  assert.match(match[0], /importStep/, '须用只读 importStep 导入');
  assert.match(match[0], /getSubShapes\([^)]*'face'\)/, '须枚举 face 子形状');
  assert.match(match[0], /surfaceType/, '须以 surfaceType 分型');
});

// ── 红③：导入链接线 + features 版本键写入节点 ──────────────────────────────────
test('v2b-2 导入链：importCadAsset 写 node.features + featuresVersionKey=sourceSha256', async () => {
  const root = workspace();
  fs.mkdirSync(path.join(root, 'model3d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'model3d', 'part.step'), await sampleStep());
  const result = await assets.importCadAsset({ workspaceRoot: root, sourcePath: 'model3d/part.step' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(Array.isArray(result.node.features) && result.node.features.length > 0, '导入节点须带 features[]');
  assert.ok(result.node.features.every((f) => /^feat:[0-9a-f]{24}$/.test(f.id)), '特征 id 几何签名格式');
  assert.ok(result.node.features.every((f) => ['plane', 'cylinder', 'cone', 'sphere', 'other'].includes(f.kind)), 'kind 枚举合法');
  assert.equal(result.node.featuresVersionKey, result.node.source.sourceSha256, '导入件版本键=sourceSha256（D1）');
  assert.match(assetsSource, /buildImportFeatureTable/, 'model3d-assets 须消费接缝');
});

// ── 红④：sidecar provenance sha 锚定 ──────────────────────────────────────────
test('v2b-2 sidecar：provenance 锚定 featuresVersionKey/featureCount/featureKinds 与 sha 一致', async () => {
  const root = workspace();
  fs.mkdirSync(path.join(root, 'model3d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'model3d', 'part.step'), await sampleStep());
  const result = await assets.importCadAsset({ workspaceRoot: root, sourcePath: 'model3d/part.step' });
  assert.equal(result.ok, true, JSON.stringify(result));
  const provPath = path.join(root, `model3d/assets/${result.asset.sha256}.provenance.json`);
  assert.equal(fs.existsSync(provPath), true, 'sidecar provenance 须存在');
  const prov = JSON.parse(fs.readFileSync(provPath, 'utf8'));
  assert.equal(prov.featuresVersionKey, result.asset.sha256, 'sidecar 版本键须锚定源 sha');
  assert.equal(Number(prov.featureCount), result.node.features.length, 'sidecar 特征计数须与节点一致');
  assert.ok(Array.isArray(JSON.parse(prov.featureKinds)) && JSON.parse(prov.featureKinds).length > 0, 'sidecar 须记录特征类型摘要');
});

// ── 红⑤：IGES 网格无 B-rep faces 如实不写 features ─────────────────────────────
test('v2b-2 IGES：网格导入无 B-rep faces，如实不写 features（零编造）', async () => {
  const root = workspace();
  fs.mkdirSync(path.join(root, 'model3d'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURE_DIR, 'iges-cube-10mm.igs'), path.join(root, 'model3d', 'legacy.igs'));
  const result = await assets.importCadAsset({ workspaceRoot: root, sourcePath: 'model3d/legacy.igs' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.node.features, undefined, 'IGES 网格不得编造 B-rep 特征表');
  assert.equal(result.node.featuresVersionKey, undefined);
});

// ── 红⑥：前端编辑器发送面切 aFeature/bFeature 契约键 ────────────────────────────
test('v2b-2 前端：SceneConstraintEditor 提交含 aFeature/bFeature 契约键（additive）', () => {
  const constraintBlock = editorSource.slice(editorSource.indexOf('op: \'add_constraint\''));
  const payload = constraintBlock.slice(0, constraintBlock.indexOf('expectedHash'));
  assert.match(payload, /aFeature:/, '提交面须含 aFeature 契约键（非仅 UI 命名映射 aFace）');
  assert.match(payload, /bFeature:/, '提交面须含 bFeature 契约键');
  assert.match(payload, /aFace:/, 'aFace 求值主键 additive 保留');
  assert.match(payload, /bFace:/, 'bFace 求值主键 additive 保留');
});

// ── 红⑦：前端特征表优先消费 node.features 缓存 ─────────────────────────────────
test('v2b-2 前端：sceneFeatures 优先消费 node.features 派生缓存', () => {
  assert.match(frontFeaturesSource, /node\.features/, 'sceneFeatures 须优先读 node.features 派生缓存');
  assert.match(frontFeaturesSource, /featuresVersionKey/, '须对缓存做版本键校验或透传（防陈旧表被当成真值）');
});
