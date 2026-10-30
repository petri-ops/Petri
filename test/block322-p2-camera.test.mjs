import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scene3d = require('../core/petri-server/helpers/scene3d.js');
const views = require('../core/petri-server/helpers/model3d-views.js');

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

function scene(extra = {}) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: [{ id: 'base', type: 'box', dimensions: { width: 120, height: 40, depth: 80 } }],
    ...extra,
  };
}

test('BLOCK-322 P2-01 — 声明相机通过校验并参与哈希', () => {
  const camera = { position: [300, -300, 260], target: [0, 0, 20], fovDeg: 35 };
  const validated = scene3d.validateSceneSpec(scene({ camera }));
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));

  const other = scene3d.validateSceneSpec(scene({ camera: { ...camera, fovDeg: 60 } }));
  assert.equal(other.ok, true);
  assert.notEqual(
    scene3d.hashSceneSpec(scene({ camera })),
    scene3d.hashSceneSpec(scene({ camera: { ...camera, fovDeg: 60 } })),
    '机位变化必须换哈希（SceneSpec 仍是唯一真值）',
  );
  assert.equal(scene3d.hashSceneSpec(scene({ camera })), scene3d.hashSceneSpec(scene({ camera })), '同声明同哈希');
});

test('BLOCK-322 P2-01 — 非法相机会 fail-closed', () => {
  const cases = [
    [{ position: [1, 2, 3] }, 'camera.target 非法'],
    [{ position: [1, 2, 3], target: [1, 2, 3] }, '视线退化'],
    [{ position: [1, 2, 3], target: [4, 5, 6], up: [0, 0, 0] }, 'camera.up 必须是非零三维向量'],
    [{ position: [0, 0, 0], target: [0, 0, 100], up: [0, 0, 1] }, 'camera.up 与视线共线'],
    [{ position: [1, 2, 3], target: [4, 5, 6], fovDeg: 0 }, 'camera.fovDeg'],
    [{ position: [1, 2, 3], target: [4, 5, 6], fovDeg: 180 }, 'camera.fovDeg'],
    [{ position: [1, 2, 3], target: [4, 5, 6], projection: 'fisheye' }, 'camera.projection'],
    [{ position: [1, 2, 3], target: [4, 5, 6], projection: 'orthographic' }, 'orthoScaleMm'],
    ['not-an-object', 'camera 必须是对象'],
  ];
  for (const [camera, keyword] of cases) {
    const result = scene3d.validateSceneSpec(scene({ camera }));
    assert.equal(result.ok, false, JSON.stringify(camera));
    assert.ok(result.errors.some((error) => error.includes(keyword)), `${keyword} 缺位：${JSON.stringify(result.errors)}`);
  }
});

test('BLOCK-322 P2-01 — 正交投影必须给画幅，透视可省略', () => {
  const ortho = scene3d.validateSceneSpec(scene({
    camera: { position: [0, -400, 200], target: [0, 0, 0], projection: 'orthographic', orthoScaleMm: 320 },
  }));
  assert.equal(ortho.ok, true, JSON.stringify(ortho.errors));
  const orthoBad = scene3d.validateSceneSpec(scene({
    camera: { position: [0, -400, 200], target: [0, 0, 0], projection: 'orthographic', orthoScaleMm: 0 },
  }));
  assert.equal(orthoBad.ok, false);
  const perspWithScale = scene3d.validateSceneSpec(scene({
    camera: { position: [0, -400, 200], target: [0, 0, 0], orthoScaleMm: -5 },
  }));
  assert.equal(perspWithScale.ok, false, '透视下给非法画幅同样拒绝，不静默忽略');
});

test('BLOCK-322 P2-01 — render 分辨率边界（16..4096 整数）', () => {
  assert.equal(scene3d.validateSceneSpec(scene({ render: { width: 1600, height: 900 } })).ok, true);
  assert.equal(scene3d.validateSceneSpec(scene({ render: {} })).ok, true, '空对象=全用默认，合法');
  for (const render of [{ width: 8 }, { height: 5000 }, { width: 800.5 }, { width: '800' }]) {
    const result = scene3d.validateSceneSpec(scene({ render }));
    assert.equal(result.ok, false, JSON.stringify(render));
    assert.ok(result.errors.some((error) => error.startsWith('render.')), JSON.stringify(result.errors));
  }
});

test('BLOCK-322 P2-01 — 无 camera/render 的存量场景仍原样通过（向后兼容）', () => {
  const legacy = scene();
  const validated = scene3d.validateSceneSpec(legacy);
  assert.equal(validated.ok, true);
  assert.equal(validated.stats.primitiveEstimate, 1);
  const resolved = scene3d.resolveSceneSpec(legacy);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.scene.camera, undefined, '未声明即不注入默认机位');
});

test('BLOCK-322 P2-01 — 视角名唯一声明处，消费面不再各写一份', () => {
  assert.deepEqual([...views.RENDER_VIEWS], ['front', 'top', 'side', 'iso', 'camera']);
  assert.deepEqual([...views.STANDARD_VIEWS], ['front', 'top', 'side', 'iso']);
  assert.deepEqual([...views.DEFAULT_RENDER_VIEWS], [...views.RENDER_VIEWS]);
  assert.equal(views.isRenderView('camera'), true);
  assert.equal(views.isRenderView('back'), false);
  assert.deepEqual(views.normalizeRenderViews(['Front', 'camera', 'front']), ['front', 'camera']);
  assert.equal(views.normalizeRenderViews(['front', 'nope']), null);
  assert.equal(views.normalizeRenderViews([]), null);

  const consumers = [
    '../core/petri-server/helpers/blender-provider.js',
    '../core/petri-server/agent-tools/model3d-tools.js',
    '../core/petri-server/agent-tools/tool-defs/model3d.js',
    '../core/petri-server/helpers/model3d-recipe-runner.js',
    '../core/petri-server/helpers/model3d-review.js',
    '../core/petri-server/routes/model3d.js',
  ];
  for (const file of consumers) {
    const source = read(file);
    assert.ok(!source.includes("'front', 'top', 'side', 'iso'"), `${file} 仍在自写视角清单`);
    assert.match(source, /model3d-views/, `${file} 未接入视角单源`);
  }
});

test('BLOCK-322 P2-01 — Blender 构建脚本按声明相机出图，未声明即跳过', () => {
  const python = read('../resources/model3d/blender_scene.py');
  assert.match(python, /def build_declared_camera/);
  assert.match(python, /def aim_with_up/, '显式 up 须有真正的 look-at（mathutils 无 Quaternion.multiply，早期实现即在此崩）');
  assert.match(python, /'upApplied': up_applied/, '未生效的 up 必须回显 false，不假装按声明倾角取景');
  assert.match(python, /data\.sensor_fit = 'VERTICAL'/, 'fov 必须与 Three 的垂直 fov 同轴，否则两侧不是同一个角');
  assert.match(python, /if view == 'camera':/, 'camera 视角分支');
  assert.match(python, /if declared is None:\s*\n\s*continue/, '未声明相机不得伪造机位出图');
  assert.match(python, /'effectiveAngleYDeg'/, '报告须回显生效张角供对账');
  assert.match(python, /DEFAULT_RESOLUTION = \(800, 600\)/, '缺省分辨率维持既有 800×600');
  // 固定四视角位置仍在（camera 是新增视角，不替换标准视角）。
  for (const view of ['front', 'top', 'side', 'iso']) {
    assert.ok(python.includes(`'${view}':`), `标准视角 ${view} 位置表缺位`);
  }
});

test('BLOCK-322 P2-01 — 前端镜像与后端同判据（展示侧不消费后端拒绝的声明）', () => {
  const frontend = read('../frontend/src/lib/scene3d.ts');
  assert.match(frontend, /function validateCameraForView/);
  assert.match(frontend, /camera\.fovDeg 须在 \(1,179\) 度之间/);
  assert.match(frontend, /camera\.orthoScaleMm 在正交投影下必填且须 >0/);
  assert.match(frontend, /render\.\$\{key\} 须是 16\.\.4096 的整数/);
  assert.match(frontend, /camera 视线退化/);
  const panel = read('../frontend/src/components/work-surface/Model3DReviewPanel.tsx');
  assert.match(panel, /'iso', 'camera'/, 'QA 面板视角序须含声明机位');
  const surface = read('../frontend/src/components/work-surface/Model3DSurface.tsx');
  assert.match(surface, /view\?\.scene\.camera \? \[\.\.\.VIEWS, DECLARED_CAMERA_VIEW\] : VIEWS/, '机位按钮只在声明后出现');
});
