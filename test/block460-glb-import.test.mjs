import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { importSand3dGlb } = require('../core/petri-server/helpers/scene3d-import.js');
const scene3d = require('../core/petri-server/helpers/scene3d.js');

// BLOCK-460 — sand3d GLB → SceneSpec v1(+joints) 归一器契约（HK-01 红绿先行）。
// fixture = BLOCK-459 探针真实导出物（程序→GLB 的原生产物，非手工构造）：
//   sand3d-probe-rest.glb    hinge(revolute +Z 0..90°) + rail(prismatic +X 0..40mm) + cap(mimic 0.5)
//   sand3d-probe-posed45.glb 同一装配在 pose(45°) 下的导出（value≠0 → 归一器必须拒绝）
//   sand3d-probe-kinds.glb   continuous + floating（free 的导出层命名）组合
// 语义依据：acceptance/block-459/PROBE-REPORT.md §2/§3 与 scene-ir-v0-draft.md N1–N8
//（SceneSpec 变体：角度=度、长度=mm、z-up——由导出层 rad/m、glTF Y-up 换算）。

const fixture = (name) => path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', name);

function writeWorkspace(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block460-import-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

test('BLOCK-460: rest GLB 归一为合法 SceneSpec(+joints)，产出 mesh-reference 节点与 provenance', () => {
  const glbPath = fixture('sand3d-probe-rest.glb');
  const root = writeWorkspace(null, { 'model3d/probe.glb': fs.readFileSync(glbPath) });
  const result = importSand3dGlb({
    workspaceRoot: root,
    glbRelativePath: 'model3d/probe.glb',
    programDigest: 'fee4e403d8206135',
  });
  assert.equal(result.ok, true, `归一必须成功: ${JSON.stringify(result.errors || result.error || [])}`);
  const spec = result.scene;

  // 既有契约全绿（归一产物必须是合法 SceneSpec）
  const validated = scene3d.validateSceneSpec(spec);
  assert.equal(validated.ok, true, `归一产物必须过 validateSceneSpec: ${JSON.stringify(validated.errors || [])}`);

  // 装配根 = mesh-reference 承载整装配视觉（逐件拆分留 P3）；被关节引用的 GLB 内部
  // 部件以 group 节点在场（joints 引用完整性，validateJoints 拒悬空）。本 fixture：
  // probe_machine(root) + arm/post/slider/cap 四个运动学体 = 5 节点。
  assert.equal(spec.nodes.length, 5);
  assert.equal(spec.nodes[0].type, 'mesh-reference');
  assert.equal(spec.nodes[0].id, 'probe_machine');
  assert.equal(spec.nodes[0].source.path, 'model3d/probe.glb');
  assert.match(spec.nodes[0].source.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(spec.nodes[0].source.sourceSha256, result.glbSha256, '节点锚定哈希必须等于真实文件哈希');
  const specNodeIds = new Set(spec.nodes.map((node) => node.id));
  for (const joint of spec.joints) {
    assert.ok(specNodeIds.has(joint.child), `joint ${joint.id}.child ${joint.child} 必须在场`);
    assert.ok(specNodeIds.has(joint.parent), `joint ${joint.id}.parent ${joint.parent} 必须在场`);
  }

  // 三个关节归一（hinge/rail/cap）
  assert.equal(spec.joints.length, 3);
  const byId = Object.fromEntries(spec.joints.map((j) => [j.id, j]));
  assert.deepEqual(Object.keys(byId).sort(), ['cap_follow', 'hinge_arm', 'rail_slider']);

  // 轴向：GLB 局部+Y 经节点四元数变换到 glTF 世界系，再转 z-up spec 系
  // hinge +Z(glTF Y-up 世界) → spec [0,0,1]；rail +X → spec [1,0,0]
  assert.deepEqual(byId.hinge_arm.axis, [0, 0, 1]);
  assert.deepEqual(byId.rail_slider.axis, [1, 0, 0]);

  // 单位换算：revolute rad→deg（1.5708→90）、prismatic m→mm（0.04→40）
  assert.equal(byId.hinge_arm.kind, 'revolute');
  assert.equal(byId.hinge_arm.range.max, 90);
  assert.equal(byId.rail_slider.kind, 'prismatic');
  assert.equal(byId.rail_slider.range.max, 40);

  // mimic → follows/ratio
  assert.equal(byId.cap_follow.follows, 'rail_slider');
  assert.equal(byId.cap_follow.ratio, 0.5);

  // 溯源段
  assert.equal(spec.metadata.provenance.producer, 'sand3d');
  assert.equal(spec.metadata.provenance.programDigest, 'fee4e403d8206135');
  assert.equal(spec.metadata.provenance.glbSha256, result.glbSha256);

  // rest 判据：全部关节 value=0
  assert.equal(result.restPose, true);
});

test('BLOCK-460: posed 导出（value≠0）fail-closed 拒绝——首版只消费 rest', () => {
  const root = writeWorkspace(null, { 'model3d/posed.glb': fs.readFileSync(fixture('sand3d-probe-posed45.glb')) });
  const result = importSand3dGlb({
    workspaceRoot: root,
    glbRelativePath: 'model3d/posed.glb',
    programDigest: 'fee4e403d8206135',
  });
  assert.equal(result.ok, false, '非 rest 导出必须拒绝');
  assert.match(String(result.error || ''), /not_rest_pose|value/);
});

test('BLOCK-460: continuous/floating 归一——free 的导出层命名映射、无 range', () => {
  const root = writeWorkspace(null, { 'model3d/kinds.glb': fs.readFileSync(fixture('sand3d-probe-kinds.glb')) });
  const result = importSand3dGlb({
    workspaceRoot: root,
    glbRelativePath: 'model3d/kinds.glb',
    programDigest: 'kinds-digest',
  });
  assert.equal(result.ok, true, `kinds 归一必须成功: ${JSON.stringify(result.errors || [])}`);
  const byId = Object.fromEntries(result.scene.joints.map((j) => [j.id, j]));
  assert.equal(byId.spin.kind, 'continuous');
  assert.equal(byId.spin.range, undefined);
  assert.equal(byId.wobble.kind, 'floating', '程序层 free → 导出层 floating，IR 取导出层命名');
  assert.equal(byId.wobble.axis, undefined);
  assert.equal(byId.wobble.range, undefined);
  // 归一产物同样过既有校验
  const validated = scene3d.validateSceneSpec(result.scene);
  assert.equal(validated.ok, true, `kinds 归一产物必须过 validateSceneSpec: ${JSON.stringify(validated.errors || [])}`);
});

test('BLOCK-460: 损坏 GLB（非 glTF 魔数）fail-closed 拒绝', () => {
  const root = writeWorkspace(null, { 'model3d/bad.glb': Buffer.from('not a glb at all........') });
  const result = importSand3dGlb({
    workspaceRoot: root,
    glbRelativePath: 'model3d/bad.glb',
    programDigest: 'x',
  });
  assert.equal(result.ok, false);
});

test('BLOCK-460: 越界路径拒绝（归一器不读工作区外文件）', () => {
  const root = writeWorkspace(null, {});
  const result = importSand3dGlb({
    workspaceRoot: root,
    glbRelativePath: '../outside/model3d/probe.glb',
    programDigest: 'x',
  });
  assert.equal(result.ok, false);
});
