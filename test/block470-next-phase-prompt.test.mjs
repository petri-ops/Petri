// BLOCK-470 / T1 — 下一阶段提示词生成器纯函数负测（HK-01 判据侧红绿，治理批豁免声明）。
// 纯函数 deriveNextPhaseDraft(inputs) 与 shouldWriteDraft(existing) 先红后绿。
// 边界：仅 advice 不发令 / 继承未消耗 R 项 / 观感零代签 / 新裁决标 pending / 幂等 / 缺输入归因。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveNextPhaseDraft,
  shouldWriteDraft,
  classifyRulings,
} from '../scripts/lib/next-phase-prompt-core.mjs';

const baseInputs = () => ({
  date: '2026-11-19',
  batch: 3,
  stateSummary: '串行 active 槽位空；最近完成 BLOCK-469 completed/CLOSED',
  auditHead: '最后更新：2026-11-18（S1-S5 全收口）',
  suggestion: { suggestion: 'C-53-P2', confidence: 0.95, reason: 'jev_adopted' },
  previousBody: [
    '- R8 C-53 发令 = P2–P6 全自动推进 + P7 非观感准备；P7 人眼签字留用户，不代签。',
    '- R9 P2 IA 与高频路径 = 首片',
    '- R13 P6 产品 Skill v1.1 = ...',
    '- R15 每步收口走 closeout + 六件套 + commit + push；观感项永不写 verified。',
  ].join('\n'),
  completedPhases: [],
  humanEyeItems: ['UI-706', 'UI-707', 'UI-709', 'UI-710', 'E类22条'],
});

test('T1-1 缺关键输入 → external-blocked 归因（不臆造草案）', () => {
  const bad = { ...baseInputs(), suggestion: null };
  const r = deriveNextPhaseDraft(bad);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'external-blocked');
  assert.ok(r.diagnostics.some((d) => /suggestion/i.test(d)));
});

test('T1-2 继承未消耗 R 项：P0/P1 已完成 → R 项保留，标注继承来源', () => {
  const r = deriveNextPhaseDraft(baseInputs());
  assert.equal(r.ok, true);
  assert.ok(r.draft.includes('R8'));
  assert.ok(r.inherited.some((x) => x.includes('R9')));
  assert.ok(r.draft.includes('继承'), '草案须标注 R 项来源=继承');
});

test('T1-3 观感零代签：草案保留 pending_human_eye 且永不写 verified', () => {
  const r = deriveNextPhaseDraft(baseInputs());
  for (const item of baseInputs().humanEyeItems) {
    assert.ok(r.draft.includes(item), `${item} 须在草案留槽`);
  }
  assert.equal(/pending_human_eye[\s\S]{0,80}verified/.test(r.draft), false, '观感项不得被写 verified');
  assert.ok(r.draft.includes('不代签'));
});

test('T1-4 新裁决点标 pending_user_ruling，不写进 R 项', () => {
  const inputs = { ...baseInputs(), completedPhases: ['P2', 'P3', 'P4', 'P5', 'P6', 'P7'] };
  const r = deriveNextPhaseDraft(inputs);
  assert.ok(r.draft.includes('pending_user_ruling'), '范围消耗完须标待用户发令');
  assert.equal(r.recommendation, 'advice_only');
});

test('T1-5 幂等：目标已存在 → shouldWriteDraft=false（不覆盖、不重复）', () => {
  assert.equal(shouldWriteDraft(true), false);
  assert.equal(shouldWriteDraft(false), true);
});

test('T1-6 classifyRulings 只继承已授权未消耗阶段，不自造新阶段', () => {
  const c = classifyRulings({ previousBody: baseInputs().previousBody, completedPhases: [] });
  assert.equal(c.mode, 'inherit');
  assert.ok(c.inherited.length > 0);
  const done = classifyRulings({ previousBody: baseInputs().previousBody, completedPhases: ['P2', 'P3', 'P4', 'P5', 'P6', 'P7'] });
  assert.equal(done.mode, 'pending_user_ruling');
  assert.equal(done.inherited.length, 0);
});
