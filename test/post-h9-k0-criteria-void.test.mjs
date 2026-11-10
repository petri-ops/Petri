/**
 * K0 三条被推翻判据「作废 + 重立」契约（红绿先行 + 逐条篡改负测）。
 *
 * 单一真相源 = scripts/lib/post-h9-k0-criteria.mjs 的 adjudicateCriteria()，
 * 事实来源 = 仓库内既有 acceptance 证据与源码（不新建第二份读数）。
 * 负测覆盖：每条判据的每个关键事实被篡改时必须判红，防止旧判据回潮。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adjudicateCriteria, readCriteriaEvidence, CRITERIA_IDS,
  VOIDED_CRITERIA, RESTATED_CRITERIA,
} from '../scripts/lib/post-h9-k0-criteria.mjs';

const evidence = readCriteriaEvidence();

test('三条判据在真实证据下全部作废并已重立', () => {
  const v = adjudicateCriteria(evidence);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.deepEqual(v.voided, [...CRITERIA_IDS]);
  assert.deepEqual(v.restated, [...CRITERIA_IDS]);
  assert.equal(v.verdict, 'three-criteria-voided-and-restated');
});

test('作废记录与重立判据文本逐条在册且不退回旧判据', () => {
  assert.equal(CRITERIA_IDS.length, 3);
  for (const id of CRITERIA_IDS) {
    assert.ok(VOIDED_CRITERIA[id], `${id} 缺作废记录`);
    assert.ok(RESTATED_CRITERIA[id], `${id} 缺重立判据`);
    assert.notEqual(VOIDED_CRITERIA[id], RESTATED_CRITERIA[id]);
  }
  assert.match(VOIDED_CRITERIA['K-01'], /全量 DOM/);
  assert.match(RESTATED_CRITERIA['K-01'], /LIMIT 100/);
  assert.match(RESTATED_CRITERIA['K-02'], /0\.9/);
  assert.match(RESTATED_CRITERIA['K-03'], /分开命名|分开取数/);
});

// ---- 逐条篡改负测：任一事实被改回旧判据形态必须判红 ----
const tamper = (patch) => adjudicateCriteria({ ...evidence, ...patch });
const mustRed = (v, label) => {
  assert.equal(v.ok, false, `${label} 篡改后必须判红`);
  assert.equal(v.verdict, 'criteria-drift');
  assert.ok(v.issues.some((i) => i.startsWith(label.split(':')[0])), `${label} 应产生对应归因`);
};

test('负测 K-01：服务端 LIMIT 100 被改成 200 → 判红', () => {
  mustRed(tamper({ conversationsApiLimit: 200 }), 'K-01');
});

test('负测 K-01：默认页大小被改成 200（K2 additive 信封语义被破坏）→ 判红', () => {
  mustRed(tamper({ conversationsDefaultPageSize: 200 }), 'K-01');
});

test('K-01 语义校准：K2 additive 信封 LIMIT 101+slice(0,100) 仍满足「默认上限 100」', () => {
  const e = readCriteriaEvidence();
  assert.equal(e.conversationsSourceHasLimit, true);
  assert.equal(e.conversationsDefaultPageSize, 100);
  assert.equal(e.conversationsNoPaginationParam, true);
  assert.equal(adjudicateCriteria(e).ok, true);
});

test('负测 K-01：会话列表新增分页参数但读数未重采 → 判红（防止假接线）', () => {
  mustRed(tamper({ conversationsNoPaginationParam: false }), 'K-01');
});

test('负测 K-01：把 100 档节点数写成与 400/800 同为 7202（蓝图旧措辞）→ 判红', () => {
  mustRed(tamper({ nodes100: 7202 }), 'K-01');
});

test('负测 K-01：抹掉 convRowMatches 平台期 → 判红', () => {
  mustRed(tamper({ plateau: { c100: 500, c400: 2000, c800: 4000 } }), 'K-01');
});

test('负测 K-02：把 cv A/B 裁决改成「有收益、落 CSS」→ 判红', () => {
  mustRed(tamper({ cv: { ...evidence.cv, improved: true, decision: 'ship' } }), 'K-02');
});

test('负测 K-02：把判据退回节点数 → 判红', () => {
  mustRed(tamper({ cv: { ...evidence.cv, criterion: '节点数不降即回滚' } }), 'K-02');
});

test('负测 K-02：伪造 B 态耗时显著下降 → 判红（B < A×0.9 时才可落 CSS）', () => {
  mustRed(tamper({ cv: { ...evidence.cv, bMedian: 0.3 } }), 'K-02');
});

test('负测 K-03：把热栈 5 轮改名成「冷启动 5 次」→ 判红', () => {
  mustRed(tamper({ hotStack: { ...evidence.hotStack, sampling: '冷启动 5 次' } }), 'K-03');
});

test('负测 K-03：把冷启动 cdpPageReady 补成 5/5（冒充五段齐全）→ 判红', () => {
  mustRed(tamper({ coldStart: { ...evidence.coldStart, cdpPageReadyCoverage: 5 } }), 'K-03');
});

test('负测 K-03：专项脚本被挂进 closeout 常驻链（无栈必红 fail-open）→ 判红', () => {
  mustRed(tamper({ startupGateInCloseoutChain: true }), 'K-03');
});

test('负测：证据整体缺席（如 error/not-verifiable 形态）→ 判红而非静默通过', () => {
  const v = adjudicateCriteria({});
  assert.equal(v.ok, false);
  assert.equal(v.voided.length, 0);
  assert.ok(v.issues.length >= 3);
});
