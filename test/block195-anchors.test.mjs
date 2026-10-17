/**
 * BLOCK-195 — 竞争力 8 维锚点复测的契约测（**毫秒级离线**：不执行任何锚点命令）。
 *
 * 钉住的是"判分口径与清单诚实性"，不是分数结果：
 *  · 点位集合必须可指回总纲 §1/§2（derivesFrom），且**不得有幽灵锚点**（引用不存在的文件）；
 *  · 无证据不给分——unanchored 点位计分母不计分子，因此分数上限被证据缺口压低；
 *  · 环境档（dev 栈不在场）不得冒绿；
 *  · 棘轮「绿→无锚」也算后退，堵住"删锚点洗白"这条最省事的作弊路径；
 *  · 定分公式在 runner 里只有一处实现（改口径必须先过本测）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  derivePointState, scoreDimension, resolveCmd, auditList, compareAnchorBaseline, unmetPrecondition, POINT_RANK, TIERS,
} from '../scripts/lib/anchor-ratchet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST_PATH = path.join(ROOT, 'evals', 'anchors', 'competitiveness-8d.json');
const list = JSON.parse(fs.readFileSync(LIST_PATH, 'utf8'));

test('清单形状：8 维齐、每维点位≥5、点位 id 唯一', () => {
  assert.equal(list.schema, 'petri-competitiveness-anchors/v1');
  assert.equal(list.dimensions.length, 8);
  const ids = new Set();
  for (const d of list.dimensions) {
    assert.ok(d.name && typeof d.inferred20261012 === 'number', `dim${d.id} 缺名称或推断值`);
    assert.ok(d.points.length >= 5, `dim${d.id} 点位过少（${d.points.length}）`);
    for (const p of d.points) {
      const id = `${d.id}.${p.id}`;
      assert.equal(ids.has(id), false, `重复点位 ${id}`);
      ids.add(id);
    }
  }
});

test('清单诚实性：零幽灵锚点，且每个点位都指得回外部来源', () => {
  assert.deepEqual(auditList(list, ROOT), [], '清单自检发现问题（不存在的锚点路径/坏命令/未知 tier）');
  for (const d of list.dimensions) {
    for (const p of d.points) {
      assert.match(p.derivesFrom, /§|BLOCK-|CP-\d|TTFS/, `dim${d.id}.${p.id} derivesFrom 未指回总纲或既有包`);
    }
  }
});

test('无证据不给分：unanchored 点位计分母不计分子，压低该维上限', () => {
  const allGreen = [{ state: 'anchored-green' }, { state: 'anchored-green' }, { state: 'anchored-green' }, { state: 'anchored-green' }];
  assert.equal(scoreDimension(allGreen), 5);
  const withGap = [{ state: 'anchored-green' }, { state: 'anchored-green' }, { state: 'anchored-green' }, { state: 'unanchored' }];
  assert.equal(scoreDimension(withGap), 3.8, '4 点位 3 绿 1 无锚=3.8（无锚不进分子）');
  const redSameAsUnanchored = [{ state: 'anchored-green' }, { state: 'anchored-red' }, { state: 'unanchored' }, { state: 'anchored-green' }];
  assert.equal(scoreDimension(redSameAsUnanchored), 2.5);
  assert.equal(scoreDimension([]), 0);
});

test('点位状态三值推导（含环境档不冒绿）', () => {
  assert.equal(derivePointState([]).state, 'unanchored');
  assert.equal(derivePointState([{ status: 'pass' }, { status: 'fail' }]).state, 'anchored-red', '任一锚失败=红');
  assert.equal(derivePointState([{ status: 'pass' }]).state, 'anchored-green');
  assert.equal(derivePointState([{ status: 'env' }]).state, 'unanchored', 'dev 栈不在场不得算绿');
  assert.equal(derivePointState([{ status: 'env' }, { status: 'pass' }]).state, 'anchored-green', '有真实证据即绿，环境档另记不掩盖');
  assert.equal(derivePointState([{ status: 'filtered' }]).state, 'unanchored');
});

test('锚点层级枚举与命令别名解析', () => {
  assert.deepEqual(TIERS, ['unit', 'frontend', 'evals', 'live', 'probe']);
  assert.equal(resolveCmd('@evals-smoke', { 'evals-smoke': 'npm run evals:run -- --suite=smoke' }), 'npm run evals:run -- --suite=smoke');
  assert.equal(resolveCmd('node --test test/x.test.mjs', {}), 'node --test test/x.test.mjs');
  assert.equal(resolveCmd('@nope', {}), null, '未知别名=null（清单自检据此报缺陷）');
  assert.equal(resolveCmd('', {}), null);
});

test('棘轮序与对账：绿退到无锚也算后退（堵死删锚点洗白）', () => {
  assert.ok(POINT_RANK['anchored-green'] > POINT_RANK.unanchored);
  assert.ok(POINT_RANK.unanchored > POINT_RANK['anchored-red']);
  const base = { points: [{ id: '1.a', state: 'anchored-green' }, { id: '1.b', state: 'anchored-red' }, { id: '1.c', state: 'anchored-green' }] };
  const v1 = compareAnchorBaseline([{ id: '1.a', state: 'unanchored' }, { id: '1.b', state: 'anchored-green' }, { id: '1.c', state: 'anchored-green' }], base);
  assert.equal(v1.ok, false);
  assert.match(v1.regressions.join('|'), /1\.a: anchored-green→unanchored/);
  assert.match(v1.improvements.join('|'), /1\.b: anchored-red→anchored-green/);
  const gone = compareAnchorBaseline([{ id: '1.b', state: 'anchored-green' }], base);
  assert.match(gone.regressions.join('|'), /1\.a: 点位已从清单消失/, '删点位=回归，不是"少一条要求"');
  assert.equal(compareAnchorBaseline([{ id: '1.a', state: 'anchored-green' }, { id: '1.b', state: 'anchored-red' }, { id: '1.c', state: 'anchored-green' }], base).ok, true);
});

test('无锚点位不得被藏：口径层给 unanchored，清单层如实留缺口（补锚转绿是改善，删点位是作弊）', () => {
  // ① 口径层（纯函数·与清单当前状态无关）：零锚 / 锚全环境不可用 → unanchored（计分母不计分子）
  assert.equal(derivePointState([]).state, 'unanchored');
  assert.equal(derivePointState([{ tier: 'live', status: 'env' }]).state, 'unanchored', '环境不可用不得冒绿也不得判红');
  assert.equal(derivePointState([{ tier: 'unit', status: 'skip' }]).state, 'unanchored', 'skip 不是证据');
  // ② 清单层：真实证据缺口必须仍以无锚点位形式在场（全绿反而可疑——那是"点位被删了"的形状）
  const unanchored = list.dimensions.flatMap((d) => d.points.filter((p) => !p.anchors || p.anchors.length === 0));
  assert.ok(unanchored.length > 0, '全有点位锚点反而可疑：未实现能力须如实列为无锚，不得靠删点位凑满分');
  for (const p of unanchored) assert.ok(p.derivesFrom, `无锚点位 ${p.id} 必须指回外部标尺（防自造点位再"无锚"刷分母）`);
  // ③ 点位集合相对棘轮基线不得缩水（**不写死具体 id**：BLOCK-196 给 6.6-data-binding 补锚转绿就是正当改善，
  //    把"当前无锚"冻进门禁等于惩罚补锚；门禁只守口径与集合完整性，进度归棘轮 --check）
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'anchors', 'baseline.json'), 'utf8'));
  const now = new Set(list.dimensions.flatMap((d) => d.points.map((p) => `${d.id}.${p.id}`)));
  const gone = baseline.points.map((p) => p.id).filter((id) => !now.has(id));
  assert.deepEqual(gone, [], `点位从清单消失：${gone.join(', ')}`);
});

test('前置条件预检：文件面缺失给因，cdp 面交上层异步判（不在此猜）', () => {
  assert.equal(unmetPrecondition({ precondition: { cdp: 9223 } }, ROOT), null, 'cdp 前置不是纯函数能判的');
  assert.equal(unmetPrecondition({}, ROOT), null);
  const miss = unmetPrecondition({ precondition: { fsExists: 'definitely/not/here-xyz', note: 'R 运行面' } }, ROOT);
  assert.match(miss, /前置缺失.*definitely\/not\/here-xyz.*R 运行面/);
});

test('删锚点洗白被堵：同点位锚点集合收缩=回归（即使状态看起来"变好"）', () => {
  const base = { points: [{ id: '6.x', state: 'anchored-red', anchors: [{ tier: 'unit', path: 'test/block195-anchors.test.mjs' }] }] };
  const removed = compareAnchorBaseline([{ id: '6.x', state: 'unanchored', anchorPaths: [] }], base);
  assert.equal(removed.ok, false, '把红点位的锚删掉不得算过关');
  assert.match(removed.regressions.join('|'), /6\.x: 锚点被移除/);
  const kept = compareAnchorBaseline([{ id: '6.x', state: 'anchored-red', anchorPaths: ['test/block195-anchors.test.mjs'] }], base);
  assert.equal(kept.ok, true, '锚点集合不变时同态不判回归');
});

test('反拟合守卫：定分公式单源，清单无 volatile 字段', () => {
  const runner = fs.readFileSync(path.join(ROOT, 'scripts', 'block195-anchors.mjs'), 'utf8');
  assert.equal((runner.match(/5 \* green \/ total/g) || []).length, 0, 'runner 不得自己重写公式');
  assert.match(runner, /from '.\/lib\/anchor-ratchet.mjs'/);
  assert.match(runner, /scoreDimension\(points\)/);
  const raw = fs.readFileSync(LIST_PATH, 'utf8');
  assert.equal(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw), false, '清单不得含时间戳（须可逐字节对账）');
  assert.match(list.scoring.formula, /anchored_green/);
  assert.match(list.scoring.rule, /无证据不给分/);
});
