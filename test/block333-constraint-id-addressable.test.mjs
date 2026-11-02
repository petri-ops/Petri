/**
 * BLOCK-333 — 约束可寻址契约（UI-639a 实机腿抓到的真缺陷）。
 *
 * 现场：约束编辑器的「移除」按钮是 `disabled={busy || !row.id}`，后端 `remove_constraint`
 * 也按 `c.id` 匹配——但 `add_constraint` 从不分配 id，`CONSTRAINT_FIELDS` 白名单也不收 id。
 * 结果：约束一旦建出来就**再也删不掉**（按钮永远灰着，即便强发请求也只会 constraint_not_found）。
 *
 * 本测钉住「能建就能删」这条最小闭环，并锁住两处容易回退的细节：
 * ①创建即分配唯一 id（`cN` 且避开既有 id），显式传入重复 id 直接拒；
 * ②`validateSceneSpec` 对重复 id 给错（手写 SceneSpec 也一样），且 id 只接受安全字符。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { applySceneOperations, validateSceneSpec } = require(resolve(root, 'core/petri-server/helpers/scene3d.js'));

function box(id, position) {
  return { id, type: 'box', dimensions: { width: 120, height: 80, depth: 40 }, transform: { position, rotation: [0, 0, 0] } };
}

function scene() {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: [box('base', [0, 0, 0]), box('tower', [0, 90, 60])],
    constraints: [],
    metadata: { title: 'block333' },
  };
}

/** 可解约束：法向相反的同轴平面（+x ↔ -x）。 */
const mate = { kind: 'mate', a: 'base', b: 'tower', aFace: '+x', bFace: '-x' };

test('BLOCK-333 — 创建即分配唯一 id，且约束可被 remove_constraint 删掉', () => {
  const added = applySceneOperations(scene(), [{ op: 'add_constraint', constraint: { ...mate } }]);
  assert.equal(added.ok, true, JSON.stringify(added).slice(0, 200));
  const created = added.scene.constraints;
  assert.equal(created.length, 1);
  assert.equal(created[0].id, 'c1', '缺省 id 应为 cN 形式');

  const removed = applySceneOperations(added.scene, [{ op: 'remove_constraint', id: 'c1' }]);
  assert.equal(removed.ok, true, JSON.stringify(removed).slice(0, 200));
  assert.deepEqual(removed.scene.constraints, [], '按 id 必须删得掉——这就是实机腿抓到的断链');
});

test('BLOCK-333 — 第二条约束 id 递增且不撞既有 id（删过再建也不复用）', () => {
  let state = applySceneOperations(scene(), [{ op: 'add_constraint', constraint: { ...mate } }]).scene;
  state = applySceneOperations(state, [{ op: 'add_constraint', constraint: { ...mate } }]).scene;
  assert.deepEqual(state.constraints.map((c) => c.id), ['c1', 'c2']);

  state = applySceneOperations(state, [{ op: 'remove_constraint', id: 'c1' }]).scene;
  state = applySceneOperations(state, [{ op: 'add_constraint', constraint: { ...mate } }]).scene;
  const ids = state.constraints.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `id 不得重复：${ids.join(',')}`);
  assert.ok(!ids.includes('c1'), '删掉的 id 不应被新约束复用（避免历史引用指错条）');
});

test('BLOCK-333 — 显式传入重复 id 直接拒（否则 remove 会删错条）', () => {
  const first = applySceneOperations(scene(), [{ op: 'add_constraint', constraint: { ...mate, id: 'c9' } }]);
  assert.equal(first.ok, true);
  const second = applySceneOperations(first.scene, [{ op: 'add_constraint', constraint: { ...mate, id: 'c9' } }]);
  assert.equal(second.ok, false);
  assert.equal(second.error, 'duplicate_constraint_id');
});

test('BLOCK-333 — validateSceneSpec 对重复/非法 id 给错，对合法 id 放行', () => {
  const okScene = { ...scene(), constraints: [{ ...mate, id: 'c1' }, { ...mate, id: 'c2' }] };
  const okResult = validateSceneSpec(okScene);
  assert.equal(okResult.ok, true, JSON.stringify(okResult.errors ?? []).slice(0, 200));

  const dup = { ...scene(), constraints: [{ ...mate, id: 'c1' }, { ...mate, id: 'c1' }] };
  const dupResult = validateSceneSpec(dup);
  assert.equal(dupResult.ok, false);
  assert.ok(dupResult.errors.some((e) => /id 重复/.test(e)), dupResult.errors.join('; '));

  const bad = { ...scene(), constraints: [{ ...mate, id: '1 bad id' }] };
  const badResult = validateSceneSpec(bad);
  assert.equal(badResult.ok, false);
  assert.ok(badResult.errors.some((e) => /id 非法/.test(e)), badResult.errors.join('; '));
});

test('BLOCK-333 — 无 id 的历史约束仍可读（加性：id 是可选字段）', () => {
  const legacy = { ...scene(), constraints: [{ ...mate }] };
  assert.equal(validateSceneSpec(legacy).ok, true, '老场景（约束无 id）不得因为本包变更而判非法');
});
