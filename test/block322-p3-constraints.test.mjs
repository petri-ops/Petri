import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scene3d = require('../core/petri-server/helpers/scene3d.js');

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

function box(id, position = [0, 0, 0], rotation = [0, 0, 0]) {
  return {
    id,
    type: 'box',
    dimensions: { width: 120, height: 40, depth: 80 },
    transform: { position, rotation },
  };
}

function scene(nodes, constraints) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes,
    ...(constraints ? { constraints } : {}),
  };
}

const positionOf = (resolved, id) => resolved.scene.nodes.find((node) => node.id === id).transform.position;
const rotationOf = (resolved, id) => resolved.scene.nodes.find((node) => node.id === id).transform.rotation;

test('BLOCK-322 P3-02a — 三类约束通过校验且随值换哈希（改装配必留 revision）', () => {
  const nodes = [box('a', [10, 20, 30]), box('b'), box('c')];
  const constraints = [
    { kind: 'align', a: 'a', b: 'b', axis: 'x' },
    { kind: 'distance', a: 'a', b: 'c', axis: 'z', value: 60 },
    { kind: 'angle', a: 'b', b: 'c', axis: 'z', value: 15 },
  ];
  const validated = scene3d.validateSceneSpec(scene(nodes, constraints));
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
  assert.equal(validated.stats.constraints, 3);
  const changed = constraints.map((constraint) => ({ ...constraint, value: constraint.value === undefined ? 1 : constraint.value + 1 }));
  assert.notEqual(
    scene3d.hashSceneSpec(scene(nodes, constraints)),
    scene3d.hashSceneSpec(scene(nodes, changed)),
    '约束值变更必须换哈希',
  );
});

test('BLOCK-322 P3-02a — align/distance/angle 求值给出解析式位置与姿态', () => {
  const nodes = [box('a', [10, 20, 30], [0, 0, 25]), box('b', [0, 0, 0]), box('c', [-5, -5, -5])];

  const aligned = scene3d.resolveSceneSpec(scene(nodes, [{ kind: 'align', a: 'a', b: 'b', axis: 'y' }]));
  assert.equal(aligned.ok, true, JSON.stringify(aligned.errors));
  assert.deepEqual(positionOf(aligned, 'b'), [0, 20, 0], 'align 只改 b 的被约束分量');
  assert.deepEqual(aligned.appliedConstraints, [{
    index: 0, kind: 'align', a: 'a', b: 'b', axis: 'y', field: 'position', from: 0, to: 20, changed: true,
  }], JSON.stringify(aligned.appliedConstraints));

  const spaced = scene3d.resolveSceneSpec(scene(nodes, [{ kind: 'distance', a: 'a', b: 'c', axis: 'z', value: 60 }]));
  assert.equal(spaced.ok, true, JSON.stringify(spaced.errors));
  assert.equal(positionOf(spaced, 'c')[2], 90, 'distance = 参照面当前分量 + 带符号间距');

  const negative = scene3d.resolveSceneSpec(scene(nodes, [{ kind: 'distance', a: 'a', b: 'c', axis: 'z', value: -25 }]));
  assert.equal(positionOf(negative, 'c')[2], 5);

  const turned = scene3d.resolveSceneSpec(scene(nodes, [{ kind: 'angle', a: 'a', b: 'b', axis: 'z', value: 15 }]));
  assert.equal(turned.ok, true, JSON.stringify(turned.errors));
  assert.equal(rotationOf(turned, 'b')[2], 40, 'angle = 参照面绕同轴转角 + 相对角度');
  assert.deepEqual(positionOf(turned, 'b'), [0, 0, 0], 'angle 不改位置');
});

test('BLOCK-322 P3-02a — 单遍按声明顺序求值：链式约束自然传递，参照面读已求过的值', () => {
  const nodes = [box('a', [7, 0, 0]), box('b', [0, 0, 0]), box('c', [0, 0, 0])];
  const chained = scene3d.resolveSceneSpec(scene(nodes, [
    { kind: 'align', a: 'a', b: 'b', axis: 'x' },
    { kind: 'align', a: 'b', b: 'c', axis: 'x' },
  ]));
  assert.equal(positionOf(chained, 'b')[0], 7);
  assert.equal(positionOf(chained, 'c')[0], 7, 'b→c 的参照读的是 b 求值后的 x');

  const loop = scene3d.resolveSceneSpec(scene(nodes, [
    { kind: 'align', a: 'a', b: 'b', axis: 'x' },
    { kind: 'align', a: 'b', b: 'c', axis: 'x' },
    { kind: 'align', a: 'c', b: 'a', axis: 'x' },
  ]));
  assert.equal(loop.ok, true, JSON.stringify(loop.errors));
  assert.deepEqual([positionOf(loop, 'a')[0], positionOf(loop, 'b')[0], positionOf(loop, 'c')[0]], [7, 7, 7],
    '闭合环按声明序收敛，不产生抖动（不做迭代求解=不引入第二套求解器语义）');

  const unanchored = scene3d.resolveSceneSpec(scene([box('a'), box('b')], [{ kind: 'align', a: 'a', b: 'b', axis: 'x' }]));
  assert.deepEqual(positionOf(unanchored, 'b'), [0, 0, 0]);
  assert.equal(unanchored.appliedConstraints[0].changed, false, '本就对齐时 changed=false，台账如实记');
});

test('BLOCK-322 P3-02a — 过约束显式 constraint_conflict，不静默取后值', () => {
  const nodes = [box('a', [0, 0, 0]), box('b', [3, 3, 3])];
  const conflict = scene3d.resolveSceneSpec(scene(nodes, [
    { kind: 'distance', a: 'a', b: 'b', axis: 'x', value: 60 },
    { kind: 'align', a: 'a', b: 'b', axis: 'x' },
  ]));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'constraint_conflict');
  assert.match(conflict.errors[0], /b\.position\.x 已由 constraints\[0\] 定为 60，constraints\[1\]（align）要求 0/);

  const consistent = scene3d.resolveSceneSpec(scene(nodes, [
    { kind: 'align', a: 'a', b: 'b', axis: 'x' },
    { kind: 'align', a: 'a', b: 'b', axis: 'x' },
  ]));
  assert.equal(consistent.ok, true, '重复但同值 = 冗余不是冲突');
  assert.equal(consistent.appliedConstraints.length, 2);

  const otherAxis = scene3d.resolveSceneSpec(scene(nodes, [
    { kind: 'align', a: 'a', b: 'b', axis: 'x' },
    { kind: 'align', a: 'a', b: 'b', axis: 'y' },
  ]));
  assert.equal(otherAxis.ok, true, '不同分量各自定值不构成过约束');

  const proposal = scene3d.applySceneOperations(scene(nodes, [
    { kind: 'distance', a: 'a', b: 'b', axis: 'x', value: 60 },
  ]), [{ op: 'set_metadata', metadata: { title: 'x' } }]);
  assert.equal(proposal.ok, true);
  const conflictingProposal = scene3d.applySceneOperations(scene(nodes, [
    { kind: 'distance', a: 'a', b: 'b', axis: 'x', value: 60 },
    { kind: 'distance', a: 'a', b: 'b', axis: 'x', value: 90 },
  ]), [{ op: 'set_metadata', metadata: { title: 'x' } }]);
  assert.equal(conflictingProposal.error, 'constraint_conflict', '过约束场景不得写盘');
});

test('BLOCK-322 P3-02a — 求值结果越界 fail-closed（声明合法不代表装配后仍合法）', () => {
  const nodes = [box('a', [999_999, 0, 0]), box('b')];
  const outOfRange = scene3d.resolveSceneSpec(scene(nodes, [{ kind: 'distance', a: 'a', b: 'b', axis: 'x', value: 999_999 }]));
  assert.equal(outOfRange.ok, false);
  assert.equal(outOfRange.error, 'constraint_out_of_range');
  assert.match(outOfRange.errors[0], /constraint_out_of_range: constraints\[0\]（distance）把 b\.position\.x 求值为 1999998/);
  assert.equal(scene3d.validateSceneSpec(scene(nodes, [{ kind: 'distance', a: 'a', b: 'b', axis: 'x', value: 999_999 }])).ok, true,
    '单值本身在限内：越界只在求值后出现，故归 resolve 而不是 validate');
});

test('BLOCK-322 P3-02a — 非法约束逐条 fail-closed', () => {
  const nodes = [box('a'), box('b')];
  const cases = [
    [{ kind: 'mate', a: 'a', b: 'b', axis: 'x' }, 'kind 只支持 align/distance/angle'],
    [{ kind: 'align', a: 'a', b: 'b', axis: 'w' }, 'axis 非法'],
    [{ kind: 'align', a: 'a', b: 'ghost', axis: 'x' }, '引用未知节点'],
    [{ kind: 'align', a: 'a', b: 'a', axis: 'x' }, '不能约束自身'],
    [{ kind: 'align', a: 'a', b: 'b', axis: 'x', value: 5 }, 'value 不在 align 白名单'],
    [{ kind: 'distance', a: 'a', b: 'b', axis: 'x' }, 'value 必须是有限数值'],
    [{ kind: 'distance', a: 'a', b: 'b', axis: 'x', value: '60' }, 'value 必须是有限数值'],
    [{ kind: 'angle', a: 'a', b: 'b', axis: 'x', value: null }, 'value 必须是有限数值'],
    [{ kind: 'align', a: '1bad id', b: 'b', axis: 'x' }, '节点 id 非法'],
    [{ kind: 'align', a: 'a', b: 'b', axis: 'x', offset: 2 }, 'offset 不在 align 白名单'],
  ];
  for (const [constraint, keyword] of cases) {
    const result = scene3d.validateSceneSpec(scene(nodes, [constraint]));
    assert.equal(result.ok, false, JSON.stringify(constraint));
    assert.ok(result.errors.some((error) => error.includes(keyword)), `${keyword} 缺位：${JSON.stringify(result.errors)}`);
  }
  assert.ok(scene3d.validateSceneSpec({ ...scene(nodes), constraints: 'nope' }).errors.includes('constraints 必须是数组'));
  const tooMany = Array.from({ length: 201 }, () => ({ kind: 'align', a: 'a', b: 'b', axis: 'x' }));
  assert.ok(scene3d.validateSceneSpec({ ...scene(nodes), constraints: tooMany }).errors.includes('约束数量超限'));
  assert.equal(scene3d.validateSceneSpec(scene(nodes, [])).ok, true, '空数组合法（无约束）');
});

test('BLOCK-322 P3-02a — 求值只在 resolveSceneSpec，构建侧自动吃到，Blender 不二次求解', () => {
  const tools = read('../core/petri-server/agent-tools/model3d-tools.js');
  const runner = read('../core/petri-server/helpers/model3d-recipe-runner.js');
  const routes = read('../core/petri-server/routes/model3d.js');
  const python = read('../resources/model3d/blender_scene.py');
  assert.match(tools, /const resolved = scene3d\.resolveSceneSpec\(checked\.scene\);\n {2}if \(!resolved\.ok\) return resolved;/,
    'inspect 也得处理求值失败，否则过约束场景会抛 undefined');
  assert.match(tools, /scene: resolved\.scene,/, '送 Blender 的必须是求值后的场景（约束效果的唯一消费点）');
  assert.match(runner, /error: resolved\.error/, '配方Runner 不得把求值错误统一改写成 scene_invalid（conflict 需原样可见）');
  assert.match(routes, /app\.post\('\/api\/model3d\/scene\/resolve'/);
  assert.doesNotMatch(python, /constraint/i, 'Blender 侧出现约束求解即为第二套求解器：约束只应读回烘好的 transform');
});

test('BLOCK-322 P3-02a — 约束白名单跨语言逐值一致，预览端不自行求解', () => {
  const backend = read('../core/petri-server/helpers/scene3d.js');
  const frontend = read('../frontend/src/lib/scene3d.ts');
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
  const grabEntryKeys = (source, name) => {
    const match = source.match(new RegExp(`${name}[^=\\n]*=\\s*\\{([^}]*)\\}`));
    assert.ok(match, `未找到字典 ${name}`);
    return [...match[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[/g)].map((item) => item[1]).sort();
  };
  const kinds = ['align', 'angle', 'distance'];
  assert.deepEqual(grabSet(backend, 'CONSTRAINT_KINDS'), kinds);
  assert.deepEqual(grabArray(frontend, 'CONSTRAINT_KINDS'), kinds, '前端镜像必须与后端同集');
  assert.deepEqual(grabSet(backend, 'CONSTRAINT_AXES'), ['x', 'y', 'z']);
  assert.deepEqual(grabArray(frontend, 'CONSTRAINT_AXES'), ['x', 'y', 'z']);
  assert.deepEqual(grabEntryKeys(backend, 'CONSTRAINT_FIELDS'), kinds);
  assert.deepEqual(grabEntryKeys(frontend, 'CONSTRAINT_FIELDS'), kinds);
  const grabFieldList = (source, kind) => {
    const block = new RegExp(`CONSTRAINT_FIELDS[^=\\n]*=\\s*\\{([^}]*)\\}`).exec(source)[1];
    const entry = new RegExp(`\\b${kind}:\\s*\\[([^\\]]*)\\]`).exec(block);
    assert.ok(entry, `未找到 ${kind} 字段白名单`);
    return entry[1].split(',').map((item) => item.trim().replace(/['"]/g, '')).filter(Boolean).sort();
  };
  for (const kind of kinds) {
    assert.deepEqual(grabFieldList(frontend, kind), grabFieldList(backend, kind), `${kind} 字段白名单两侧必须逐值相同`);
  }
  assert.equal(/maxConstraints: (\d+)/.exec(backend)[1], /MAX_CONSTRAINTS = (\d+)/.exec(frontend)[1], '数量上限两侧同值');

  assert.match(frontend, /validateConstraintsForView\(raw\.constraints, seen, errors\)/);
  assert.match(frontend, /装配约束在服务端求值后烘进 transform[\s\S]*预览未取回求值结果，按声明位置显示/,
    '预览不求解（否则=第二套求解器），且必须如实声明差异');
  const preview = read('../frontend/src/components/work-surface/Model3DScene.tsx');
  assert.doesNotMatch(preview, /constraint/i, '预览画布出现约束求解即为第二套求解器');
});
