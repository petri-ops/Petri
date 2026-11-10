/**
 * K3 体验面契约（反向契约 + 逐条篡改负测 + 新机械门负测）。
 *
 * 反向契约（K-14）：事件发出但 UI 消费链任一环断开 → 必红；
 * 这是「事件到了 SSE 却没人消费」的机械守护，不冒充真实 SSE/视觉验收。
 * E 类：人眼签字缺席必须被检出，任何代签形态必红。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectExperienceTruth, adjudicateExperience, adjudicateInlineDebt,
  countInlineLiterals, FOUR_EVENT_CODES, INLINE_DEBT_FILES, DEBT_CEILING,
} from '../scripts/lib/post-h9-k3-experience.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const truth = collectExperienceTruth(ROOT);
const tamper = (patch) => adjudicateExperience({ ...truth, ...patch });
const mustRed = (v, prefix) => {
  assert.equal(v.ok, false, `${prefix} 篡改后必须判红`);
  assert.ok(v.issues.some((i) => i.startsWith(prefix)), `应产生 ${prefix} 归因: ${v.issues.join(' / ')}`);
};

test('K3 四类不变量在真实源码下成立，E/L 边界如实标注', () => {
  const v = adjudicateExperience(truth);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.deepEqual(v.conclusions, {
    'K-14': 'projection-chain-intact',
    'K-16': 'single-source-intact',
    'K-17': 'debt-frozen',
    'K-15': 'pending_human_eye',
  });
});

// ---- K-14 反向契约 ----
test('四事件四码在映射层齐全且消费链完整', () => {
  assert.deepEqual([...truth.events.codesDeclared].sort(), [...FOUR_EVENT_CODES].sort());
  assert.ok(truth.events.mapperCases >= 4);
  assert.equal(truth.events.streamImportsMapper, true);
  assert.equal(truth.events.streamCallsOnAgentStatus, true);
  assert.equal(truth.events.storeWritesStatusMessage, true);
  assert.equal(truth.events.bannerConsumesStatus, true);
});

test('K-14 边界：Toast 历史存在但尚未接四事件（不冒充已交付）', () => {
  assert.equal(truth.events.toastHistoryExists, true);
  assert.equal(truth.events.toastHistoryHasFourEvents, false, 'toast 历史接四事件属独立切片，当前不得假接线');
});

test('负测 反向契约：事件发出但 agentTaskStream 未导入映射 → 判红', () => {
  mustRed(tamper({ events: { ...truth.events, streamImportsMapper: false } }), 'K-14');
});

test('负测 反向契约：映射层掉一个码 → 判红', () => {
  mustRed(tamper({ events: { ...truth.events, codesDeclared: FOUR_EVENT_CODES.slice(0, 3) } }), 'K-14');
});

test('负测 反向契约：onAgentStatus 未下发（UI 零消费）→ 判红', () => {
  mustRed(tamper({ events: { ...truth.events, streamCallsOnAgentStatus: false } }), 'K-14');
});

test('负测 反向契约：statusMessage → Banner 链断裂 → 判红', () => {
  mustRed(tamper({ events: { ...truth.events, bannerConsumesStatus: false } }), 'K-14');
});

// ---- K-16 布局单源防回退 ----
test('K-16：内层 composes 同一规则，外层基础定义唯一，resize handle 单定义双挂载', () => {
  assert.equal(truth.layout.innerComposes, true);
  assert.equal(truth.layout.baseDefinitionCount, 1);
  assert.equal(truth.layout.innerOwnName, true);
  assert.equal(truth.layout.floatHandleDefinitions, 1);
  assert.equal(truth.layout.floatHandleMounts, 2);
});

test('负测 K-16：内层又挂外层同名 class → 判红', () => {
  mustRed(tamper({ layout: { ...truth.layout, innerComposes: false } }), 'K-16');
});

test('负测 K-16：出现第二份基础定义或第二份 handle 定义 → 判红', () => {
  mustRed(tamper({ layout: { ...truth.layout, baseDefinitionCount: 2 } }), 'K-16');
  mustRed(tamper({ layout: { ...truth.layout, floatHandleDefinitions: 2 } }), 'K-16');
});

// ---- K-17 内联样式债棘轮门 ----
test('K-17：内联债冻结读数与 CSS 面 354/30 基线分离，不重打 debt 上限', () => {
  assert.equal(truth.cssBaselineTotal, 354);
  assert.equal(truth.cssBaselineFiles, 30);
  assert.ok(truth.debtTotal > 0, '内联债真实存在，不得冻结成 0 形成假绿');
  assert.deepEqual(DEBT_CEILING, { liveMissing: 13, blocked: 22, total: 35 });
});

test('K-17：门禁在干净树判绿且逐文件与基线一致', () => {
  const v = adjudicateInlineDebt(truth.inlineDebt, truth.inlineBaseline);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.equal(v.verdict, 'inline-debt-non-increasing');
  assert.equal(Object.keys(truth.inlineBaseline).length, INLINE_DEBT_FILES.length);
});

test('负测 新机械门：任一文件新增一个裸 hex → 判红', () => {
  const first = INLINE_DEBT_FILES[0];
  const bumped = { ...truth.inlineDebt, [first]: { ...truth.inlineDebt[first], color: truth.inlineDebt[first].color + 1 } };
  const v = adjudicateInlineDebt(bumped, truth.inlineBaseline);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.includes('新增即红')));
});

test('负测 新机械门：新增内联 zIndex → 判红', () => {
  const bumped = { ...truth.inlineDebt, [INLINE_DEBT_FILES[4]]: { ...truth.inlineDebt[INLINE_DEBT_FILES[4]], zIndex: truth.inlineDebt[INLINE_DEBT_FILES[4]].zIndex + 1 } };
  assert.equal(adjudicateInlineDebt(bumped, truth.inlineBaseline).ok, false);
});

test('负测 新机械门：清空冻结清单形成假绿 → 判红', () => {
  assert.equal(adjudicateInlineDebt(truth.inlineDebt, {}).ok, false);
});

test('countInlineLiterals 行为：注释里的色值不计，真实字面量计数可复算', () => {
  const a = countInlineLiterals('/* #ffffff rgba(0,0,0,1) */');
  assert.equal(a.color, 0);
  const b = countInlineLiterals("const x = { background: '#fff', zIndex: 78 };");
  assert.equal(b.color, 1);
  assert.equal(b.zIndex, 1);
});

test('负测 K-17：CSS 面基线被改写 → 判红', () => {
  mustRed(tamper({ cssBaselineTotal: 353 }), 'K-17');
});

// ---- K-15 debt 35 / 人眼边界 ----
test('K-15：debt 35 = live-missing 13 + blocked 22，人眼路线未签字', () => {
  assert.equal(truth.triage.debt, 35);
  assert.equal(truth.triage.counts['live-missing'], 13);
  assert.equal(truth.triage.counts.blocked, 22);
  assert.equal(truth.humanEyeRouteSigned, false);
  assert.equal(truth.ledgerMechanicallyClassified, true);
});

test('负测 E 类：伪造人眼签字 → 判红（Agent 不得代答）', () => {
  mustRed(tamper({ humanEyeRouteSigned: true }), 'K-15');
});

test('负测 K-15：把人眼桶洗小（22→1）→ 判红', () => {
  mustRed(tamper({ triage: { ...truth.triage, counts: { ...truth.triage.counts, blocked: 1 }, debt: 14 } }), 'K-15');
});

test('负测 K-15：抹掉台账机械分诊结论 → 判红', () => {
  mustRed(tamper({ ledgerMechanicallyClassified: false }), 'K-15');
});

test('负测：事实整体缺席 → fail-closed 判红', () => {
  const v = adjudicateExperience({});
  assert.equal(v.ok, false);
  assert.ok(v.issues.length >= 4);
});
