import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scene3d = require('../core/petri-server/helpers/scene3d.js');

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

const KEY = { id: 'key', kind: 'sun', energy: 3, color: '#ffffff', position: [200, -300, 400], target: [0, 0, 20] };

test('BLOCK-322 P2-02 — 灯光与环境声明通过校验并参与哈希', () => {
  const withLight = scene({ lights: [KEY], environment: { background: '#101418', worldStrength: 0.35 } });
  const validated = scene3d.validateSceneSpec(withLight);
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
  assert.notEqual(
    scene3d.hashSceneSpec(withLight),
    scene3d.hashSceneSpec(scene({ lights: [{ ...KEY, energy: 9 }] })),
    '灯光变更必须换哈希（否则改灯不留 revision）',
  );
  assert.notEqual(
    scene3d.hashSceneSpec(withLight),
    scene3d.hashSceneSpec(scene({ lights: [KEY], environment: { background: '#ff0000', worldStrength: 0.35 } })),
  );
});

test('BLOCK-322 P2-02 — 非法灯光/环境 fail-closed', () => {
  const cases = [
    [{ lights: [{ id: 'k', kind: 'laser', energy: 3, position: [0, 0, 1] }] }, 'kind 只支持 sun/point/spot/area'],
    [{ lights: [{ id: 'k', kind: 'sun', energy: 5000, position: [0, 0, 1] }] }, 'energy 须在 0..1000'],
    [{ lights: [{ id: 'k', kind: 'sun', energy: 3 }] }, 'position 非法'],
    [{ lights: [{ id: 'k', kind: 'sun', energy: 3, position: [0, 0, 1], color: 'red' }] }, 'color 非法'],
    [{ lights: [{ id: 'k', kind: 'sun', energy: 3, position: [0, 0, 1] }, { id: 'k', kind: 'point', energy: 1, position: [0, 0, 2] }] }, '重复灯光 id'],
    [{ lights: [{ id: 'k', kind: 'spot', energy: 3, position: [0, 0, 1], spotDeg: 0 }] }, 'spotDeg'],
    [{ lights: 'nope' }, 'lights 必须是数组'],
    [{ lights: Array.from({ length: 17 }, (_, i) => ({ id: `l${i}`, kind: 'sun', energy: 1, position: [0, 0, i + 1] })) }, '灯光数量超限'],
    [{ environment: { background: '#11223344' } }, 'environment.background 须是 #rrggbb'],
    [{ environment: { worldStrength: 99 } }, 'worldStrength 须在 0..10'],
    [{ environment: { samples: 0 } }, 'samples 须是 1..128 的整数'],
    [{ environment: { engine: 'eevee' } }, 'engine 只支持 workbench/cycles'],
    [{ environment: [] }, 'environment 必须是对象'],
  ];
  for (const [extra, keyword] of cases) {
    const result = scene3d.validateSceneSpec(scene(extra));
    assert.equal(result.ok, false, JSON.stringify(extra));
    assert.ok(result.errors.some((error) => error.includes(keyword)), `${keyword} 缺位：${JSON.stringify(result.errors)}`);
  }
});

test('BLOCK-322 P2-02 — 未声明灯光/环境的存量场景不受影响', () => {
  const legacy = scene();
  assert.equal(scene3d.validateSceneSpec(legacy).ok, true);
  assert.equal(legacy.lights, undefined);
  const applied = scene3d.applySceneOperations(legacy, [{ op: 'set_metadata', metadata: { tag: 'p2' } }]);
  assert.equal(applied.ok, true);
  assert.equal(applied.scene.lights, undefined, 'ops 不得凭空长出灯光');
});

test('BLOCK-322 P2-02 — 灯种与引擎名跨语言逐值一致（第三份清单即红）', () => {
  const backend = read('../core/petri-server/helpers/scene3d.js');
  const frontend = read('../frontend/src/lib/scene3d.ts');
  const python = read('../resources/model3d/blender_scene.py');
  const grab = (source, name) => {
    const match = source.match(new RegExp(`${name}[^=\\n]*=\\s*(?:new Set\\(|Object\\.freeze\\()?\\[([^\\]]*)\\]`));
    assert.ok(match, `未找到常量 ${name}`);
    return match[1].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort();
  };
  assert.deepEqual(grab(backend, 'LIGHT_KINDS'), ['area', 'point', 'spot', 'sun']);
  assert.deepEqual(grab(frontend, 'LIGHT_KINDS'), ['area', 'point', 'spot', 'sun'], '前端镜像必须与后端同集');
  assert.deepEqual(grab(backend, 'RENDER_ENGINES'), ['cycles', 'workbench']);
  assert.deepEqual(grab(frontend, 'RENDER_ENGINES'), ['cycles', 'workbench']);
  // Python 侧是字典（Blender 灯型名不同形），键集必须一致。
  const pyKinds = python.match(/LIGHT_KINDS = \{([^}]*)\}/);
  assert.ok(pyKinds, '未找到 Python LIGHT_KINDS');
  assert.deepEqual(
    pyKinds[1].split(',').map((pair) => pair.split(':')[0].trim().replace(/['"]/g, '')).filter(Boolean).sort(),
    ['area', 'point', 'spot', 'sun'],
  );
});

test('BLOCK-322 P2-02 — 构建脚本只在声明灯光/环境时切 Cycles，且回显生效值', () => {
  const python = read('../resources/model3d/blender_scene.py');
  assert.match(python, /def configure_display\(scene_spec\)/);
  assert.match(python, /declared = bool\(environment\) or bool\(lights\)/, '引擎切换必须由声明驱动');
  assert.match(python, /scene\.render\.engine = 'CYCLES'/);
  assert.match(python, /scene\.cycles\.device = 'CPU'/, '无头实测 EEVEE Next 走软件回退（13.3s），故声明灯光时走 Cycles CPU');
  assert.match(python, /BLENDER_WORKBENCH'\n\s+scene\.display\.shading\.light = 'STUDIO'/, '未声明时仍是 Workbench 摄影棚光');
  assert.match(python, /def apply_environment\(environment\)/);
  assert.match(python, /'effectiveWorldStrength'/, '须回显生效强度供对账，不只看声明');
  assert.match(python, /def add_lights\(lights\)/);
  assert.match(python, /unsupported_light_kind/, '未知灯种必须报错而非静默跳过');
  assert.match(python, /'lights': \{'created': lights_created, 'errors': light_errors\}/);
  assert.match(python, /'ok': len\(unsupported\) == 0 and not light_errors/, '灯光建失败要让报告不 ok');
});

test('BLOCK-322 P2-02 — 预览端按声明重建灯组，不拿默认光冒充', () => {
  const preview = read('../frontend/src/components/work-surface/Model3DScene.tsx');
  assert.match(preview, /function buildDeclaredLight\(light: Scene3DLight\)/);
  assert.match(preview, /scene\.remove\(lightsRef\.current\)/, '声明灯存在时须先摘掉默认灯组');
  assert.match(preview, /new THREE\.RectAreaLight/, 'area 灯要有真实映射，不是悄悄降级');
  assert.match(preview, /scene\.background = environment\.background \? new THREE\.Color\(background\) : null/);
  assert.match(preview, /const declared = view\?\.scene\.lights \|\| \[\]/);
  const hemispheres = preview.split('new THREE.HemisphereLight').length - 1;
  assert.equal(hemispheres, 1, `默认摄影棚灯只应出现在灯组同步 effect（现 ${hemispheres} 处，多出的会与声明灯叠加）`);
});
