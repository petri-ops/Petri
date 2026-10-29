import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const recipes = require('../core/petri-server/helpers/model3d-recipes.js');
const scene3d = require('../core/petri-server/helpers/scene3d.js');

const IDS = ['box-enclosure', 'bracket', 'room-layout', 'experiment-rig', 'from-table'];

test('NEXT-05 recipes — 五类 recipe 均生成合法 SceneSpec + modeling TaskSpec', () => {
  const summaries = recipes.recipeSummaries();
  assert.deepEqual(summaries.map((item) => item.id), IDS);
  for (const id of IDS) {
    const params = id === 'from-table' ? { rows: [{ width: 10, depth: 20, height: 30, x: 0, y: 0, label: 'row' }] } : {};
    const built = recipes.buildRecipe(id, params);
    assert.equal(built.ok, true, `${id}: ${JSON.stringify(built).slice(0, 300)}`);
    assert.equal(built.recipe.id, id);
    assert.equal(built.taskSpec.version, 'task-spec/v1');
    assert.equal(built.taskSpec.taskType, 'modeling');
    assert.equal(built.taskSpec.missingInfo.length > 0, true, `${id} 必须诚实标注未建模项`);
    assert.equal(scene3d.validateSceneSpec(built.scene).ok, true);
    const ids = built.scene.nodes.map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length, `${id} 节点 id 必须唯一`);
    assert.match(built.hash, /^[a-f0-9]{64}$/);
  }
});

test('NEXT-05 recipes — 参数变化改变几何哈希，metadata 时间不影响哈希', () => {
  const a = recipes.buildRecipe('box-enclosure', { width: 120 });
  const b = recipes.buildRecipe('box-enclosure', { width: 130 });
  assert.notEqual(a.hash, b.hash);
  assert.equal(recipes.buildRecipe('box-enclosure', { width: 120 }).hash, a.hash);
  assert.equal(a.scene.metadata.recipeId, 'box-enclosure');
});

test('NEXT-05 recipes — from-table 有界与异常行 fail-closed', () => {
  assert.equal(recipes.buildRecipe('from-table', { rows: [] }).error, 'rows_required');
  assert.equal(recipes.buildRecipe('from-table', { rows: Array.from({ length: 41 }, () => ({ width: 1, depth: 1, height: 1 })) }).error, 'rows_too_many');
  assert.equal(recipes.buildRecipe('from-table', { rows: [{ width: 10, depth: -1, height: 1 }] }).error, 'row_invalid');
  assert.equal(recipes.buildRecipe('from-table', { rows: [{ width: 10, depth: 10, height: 10, x: 'bad' }] }).error, 'row_invalid');
  const valid = recipes.buildRecipe('from-table', {
    rows: [
      { width: 10, depth: 10, height: 10, x: 0, y: 0 },
      { width: 20, depth: 20, height: 20, x: 50, y: 0, label: 'second' },
    ],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.scene.nodes.length, 2);
  assert.equal(valid.scene.nodes[1].label, 'second');
});

test('NEXT-05 recipes — 非法 recipeId fail-closed', () => {
  assert.equal(recipes.buildRecipe('nope', {}).error, 'recipe_not_found');
  assert.equal(recipes.buildRecipe('', {}).error, 'recipe_not_found');
});
