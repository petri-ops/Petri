import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scene3d = require('../core/petri-server/helpers/scene3d.js');
const sceneStore = require('../core/petri-server/helpers/model3d-scene-store.js');

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

function box(id, extra = {}) {
  return {
    id,
    type: 'box',
    dimensions: { width: 120, height: 40, depth: 80 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    ...extra,
  };
}

function scene(nodes) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes,
  };
}

test('BLOCK-322 P3-01 — 几何操作白名单通过校验并参与哈希', () => {
  const nodes = [
    box('cutter', { transform: { position: [40, 0, 0] } }),
    box('base', { modifiers: [
      { kind: 'boolean', operation: 'difference', target: 'cutter' },
      { kind: 'bevel', width: 2, segments: 2 },
      { kind: 'array', count: 3, offset: [140, 0, 0] },
    ] }),
  ];
  const validated = scene3d.validateSceneSpec(scene(nodes));
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
  assert.notEqual(scene3d.hashSceneSpec(scene(nodes)), scene3d.hashSceneSpec(scene(nodes.map((node, index) => (index === 1 ? { ...node, modifiers: [{ kind: 'bevel', width: 5 }] } : node)))),
    'modifier 变更必须换哈希（否则改几何不留 revision）');
});

test('BLOCK-322 P3-01 — 非法 modifier 逐条 fail-closed', () => {
  const cases = [
    [[box('a', { modifiers: [{ kind: 'shell', width: 1 }] })], 'kind 只支持 bevel/array/boolean'],
    [[box('a', { modifiers: [] })], 'modifiers 不能为空数组'],
    [[box('a', { modifiers: 'nope' })], 'modifiers 必须是数组'],
    [[box('a', { modifiers: [{ kind: 'bevel', width: 0 }] })], 'width 须在 (0,100] mm'],
    [[box('a', { modifiers: [{ kind: 'bevel', width: 500 }] })], 'width 须在 (0,100] mm'],
    [[box('a', { modifiers: [{ kind: 'bevel', width: 2, segments: 99 }] })], 'segments 须是 1..8 的整数'],
    [[box('a', { modifiers: [{ kind: 'array', count: 2.5 }] })], 'count 须是 1..64 的整数'],
    [[box('a', { modifiers: [{ kind: 'array', count: 1000 }] })], 'count 须是 1..64 的整数'],
    [[box('a', { modifiers: [{ kind: 'array', count: 2, offset: [1, 2] }] })], 'offset 非法'],
    [[box('a', { modifiers: [{ kind: 'boolean', operation: 'subtract', target: 'b' }] })], 'operation 只支持 union/difference/intersect'],
    [[box('a', { modifiers: [{ kind: 'boolean', operation: 'difference', target: '1bad id' }] })], 'target 非法'],
    [[box('a', { modifiers: [{ kind: 'bevel', width: 2, radius: 1 }] })], 'radius 不在 bevel 白名单'],
    [[box('a', { modifiers: [{ kind: 'bevel', width: 2 }, { kind: 'bevel', width: 2 }, { kind: 'bevel', width: 2 },
      { kind: 'bevel', width: 2 }, { kind: 'bevel', width: 2 }, { kind: 'bevel', width: 2 },
      { kind: 'bevel', width: 2 }, { kind: 'bevel', width: 2 }, { kind: 'bevel', width: 2 }] })], 'modifiers 数量超限'],
  ];
  for (const [nodes, keyword] of cases) {
    const result = scene3d.validateSceneSpec(scene(nodes));
    assert.equal(result.ok, false, JSON.stringify(nodes));
    assert.ok(result.errors.some((error) => error.includes(keyword)), `${keyword} 缺位：${JSON.stringify(result.errors)}`);
  }
});

test('BLOCK-322 P3-01 — boolean 目标引用规则（未知/自身/未排在前 均拒）', () => {
  const missing = scene3d.validateSceneSpec(scene([box('a', { modifiers: [{ kind: 'boolean', operation: 'difference', target: 'ghost' }] })]));
  assert.ok(missing.errors.some((error) => error.includes('boolean 目标 ghost 不是已存在节点')), JSON.stringify(missing.errors));

  const self = scene3d.validateSceneSpec(scene([box('a', { modifiers: [{ kind: 'boolean', operation: 'difference', target: 'a' }] })]));
  assert.ok(self.errors.some((error) => error.includes('不能对节点自身做 boolean')), JSON.stringify(self.errors));

  const later = scene3d.validateSceneSpec(scene([
    box('a', { modifiers: [{ kind: 'boolean', operation: 'difference', target: 'b' }] }),
    box('b'),
  ]));
  assert.ok(later.errors.some((error) => error.includes('必须排在被操作节点之前')), JSON.stringify(later.errors));

  const ok = scene3d.validateSceneSpec(scene([box('b'), box('a', { modifiers: [{ kind: 'boolean', operation: 'union', target: 'b' }] })]));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
});

test('BLOCK-322 P3-01 — update_node 可改 modifiers；source 仍不在白名单（在册债不静默扩权）', () => {
  const base = scene([box('a')]);
  const applied = scene3d.applySceneOperations(base, [{
    op: 'update_node',
    id: 'a',
    changes: { modifiers: [{ kind: 'bevel', width: 3, segments: 3 }] },
  }]);
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.deepEqual(applied.scene.nodes[0].modifiers, [{ kind: 'bevel', width: 3, segments: 3 }]);

  const sourceChange = scene3d.applySceneOperations(
    scene([box('a'), box('b', { type: 'mesh-reference' })]),
    [{ op: 'update_node', id: 'a', changes: { source: { path: 'x.glb', sourceSha256: 'a'.repeat(64) } } }],
  );
  assert.equal(sourceChange.error, 'operation_not_allowed', '改指向需先定义重锚语义，不顺手开权限');
});

test('BLOCK-322 P3-01 — 语义 diff 能看见几何操作变化', () => {
  const before = scene([box('a')]);
  const after = scene([box('a', { modifiers: [{ kind: 'bevel', width: 2 }] })]);
  const diff = sceneStore.diffScenes(before, after);
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.nodes[0].fields, ['modifiers'], JSON.stringify(diff));
});

test('BLOCK-322 P3-01 — modifier 白名单跨语言逐值一致', () => {
  const backend = read('../core/petri-server/helpers/scene3d.js');
  const frontend = read('../frontend/src/lib/scene3d.ts');
  const python = read('../resources/model3d/blender_scene.py');
  const grabSet = (source, name) => {
    const match = source.match(new RegExp(`${name}[^=\\n]*=\\s*new Set\\(\\[([^\\]]*)\\]`));
    assert.ok(match, `未找到集合 ${name}`);
    return match[1].split(',').map((item) => item.trim().replace(/['"]/g, '')).filter(Boolean).sort();
  };
  const grabArray = (source, name) => {
    const match = source.match(new RegExp(`${name}[^=\\n]*=\\s*\\[([^\\]]*)\\]`));
    assert.ok(match, `未找到数组 ${name}`);
    return match[1].split(',').map((item) => item.trim().replace(/['"]/g, '')).filter(Boolean).sort();
  };
  const grabDictKeys = (source, name) => {
    const match = source.match(new RegExp(`${name} = \\{([^}]*)\\}`));
    assert.ok(match, `未找到字典 ${name}`);
    return match[1].split(',').map((pair) => pair.split(':')[0].trim().replace(/['"]/g, '')).filter(Boolean).sort();
  };
  const kinds = ['array', 'bevel', 'boolean'];
  const operations = ['difference', 'intersect', 'union'];
  assert.deepEqual(grabSet(backend, 'MODIFIER_KINDS'), kinds);
  assert.deepEqual(grabArray(frontend, 'MODIFIER_KINDS'), kinds, '前端镜像必须与后端同集');
  assert.deepEqual(grabDictKeys(python, 'MODIFIER_KINDS'), kinds, 'Blender 侧支持的种类必须与契约同集');
  assert.deepEqual(grabSet(backend, 'BOOLEAN_OPERATIONS'), operations);
  assert.deepEqual(grabArray(frontend, 'BOOLEAN_OPERATIONS'), operations);
  assert.deepEqual(grabDictKeys(python, 'BOOLEAN_OPERATIONS'), operations);
  assert.equal(backend.includes('maxModifiers: 8'), true);
  assert.match(frontend, /const MAX_MODIFIERS = 8/);
});

test('BLOCK-322 P3-01 — 求值顺序与刀体消费：先烘焙后删除', () => {
  const python = read('../resources/model3d/blender_scene.py');
  assert.match(python, /def apply_modifiers\(nodes, hosts\)/);
  assert.match(python, /for attr in \('solver', 'solver_mode'\):/, '布尔求解器属性名分版本（4.x=solver），设错名字会静默留在 FAST');
  assert.match(python, /setattr\(modifier, attr, 'EXACT'\)/, '必须用 EXACT：体积/水密报告才可信');
  assert.match(python, /def bake_scale\(obj, dimensions\)/, '尺寸须烘进顶点，否则 modifier 按局部单位生效（实测 8mm 倒角削掉一半体积）');
  const realize = python.indexOf('realize_modifiers(objects)');
  const drop = python.indexOf('drop_consumed(objects');
  assert.ok(realize > 0 && drop > realize, `必须先 realize_modifiers 烘焙再删刀体（realize=${realize} drop=${drop}）——否则布尔引用被删对象后结果丢失`);
  assert.match(python, /obj\.modifiers\.clear\(\)/, '烘焙后必须清掉 modifier：留着会被下游二次求值（实测阵列被平方成 ×9）');
  assert.match(python, /def drop_consumed\(objects, consumed\)/);
  assert.match(python, /'geometry': \{\*\*geometry, 'errors': geometry_errors\}/, '几何操作结果与错误都要回显');
  assert.match(python, /'ok': len\(unsupported\) == 0 and not light_errors and not geometry_errors/);
  assert.match(python, /boolean_target_missing:/, '刀体缺失要报错，不静默跳过布尔');
});

test('BLOCK-322 P3-01 — 预览不重做几何（不引入第二执行器），且如实声明差异', () => {
  const scene = read('../frontend/src/lib/scene3d.ts');
  assert.match(scene, /预览显示未加工基元，倒角\/布尔\/阵列在构建导出时生效/);
  assert.match(scene, /validateModifierReferencesForView\(rawNodes, errors\)/);
  const preview = read('../frontend/src/components/work-surface/Model3DScene.tsx');
  assert.doesNotMatch(preview, /csg|BSP|evaluated|modifier/i, '预览端出现几何运算实现即为第二执行器，须改为读回构建产物或走依赖裁决');
});
