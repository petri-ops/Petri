/**
 * 冷启动五段分解判定器契约（红绿先行）。
 * 只测纯函数判据，不冒充实机读数；慢样本 / 缺段 / 倒序 / 非法值都要红。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateFiveStages, FIVE_STAGES, SLOW_SAMPLE_MS } from '../scripts/post-s7-startup-five-stage.mjs';

const good = () => ({ require: 35, migrations: 40, backendHealth: 55, spa200: 70, cdpPageReady: 95 });

test('五段齐全且单调 → measured', () => {
  const r = evaluateFiveStages([good(), good(), good(), good(), good()]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.permanentlyMissing, []);
});

test('负测：植入慢样本必红（不加阈值凑绿）', () => {
  const slow = { ...good(), spa200: SLOW_SAMPLE_MS + 1 };
  const r = evaluateFiveStages([good(), slow]);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes('spa200=slow')));
});

test('负测：缺段 / 非法值 / 无轮次都要红', () => {
  assert.equal(evaluateFiveStages([]).ok, false);
  const missing = { ...good() }; delete missing.cdpPageReady;
  assert.equal(evaluateFiveStages([missing]).ok, false);
  const invalid = { ...good(), spa200: 'green' };
  assert.equal(evaluateFiveStages([invalid]).ok, false);
  const allMissing = Object.fromEntries(FIVE_STAGES.map((k) => [k, 'not_instrumented']));
  const r = evaluateFiveStages([allMissing]);
  assert.equal(r.ok, false);
  assert.equal(r.permanentlyMissing.length, 5);
});

test('跨轴数值不做单调断言（异轴读数是合法现场，不是产品红）', () => {
  // require=主进程相对时刻 35ms，spa200=curl 往返 6ms，二者不同源，不能因 6<35 判倒序。
  const crossAxis = { require: 35, migrations: 1, backendHealth: 6, spa200: 7, cdpPageReady: 9 };
  const r = evaluateFiveStages([crossAxis]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test('not_instrumented 单段如实标注但不冒充通过', () => {
  const partial = { ...good(), migrations: 'not_instrumented' };
  const r = evaluateFiveStages([partial, good()]);
  assert.equal(r.ok, true, '其他轮有读数时整体可测');
  const allPartial = evaluateFiveStages([partial, partial]);
  assert.equal(allPartial.ok, false, '该段全程无打点则不可宣布五段齐全');
  assert.deepEqual(allPartial.permanentlyMissing, ['migrations']);
});
