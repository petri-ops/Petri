/**
 * QODER-J2 技能自进化建议 — P1 纯函数 HK-01 契约（2026-11-23）。
 *
 * 用户发令「开始 J2」，评审稿=建议列表/一键建任务/忽略、轻量包、零新依赖。
 * D1 建议来源=本地 lessons 审计（listLessonEvidence 只读）；D2 自动建任务默认否。
 *
 * P1=投影器纯函数：lessons → 建议（按 skillId 归因、忽略过滤、draft tier、不自动执行）。
 * 红线：不改内置 skill 资产；建议只出草案不自动落盘；忽略状态独立账本可跨蒸馏存活。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'core', 'shared-backend', 'skill-suggestion-projector.js');
const load = () => require(MODULE);

const lessons = [
  {
    sourceFingerprint: 'fp1', title: '重复手写参数校验', action: '为脚本工具补参数校验模板',
    scope: 'draft', confidence: 0.8, status: 'active', verdict: 'keep',
    before: 3, after: 0,
  },
  {
    sourceFingerprint: 'fp2', title: '工具描述含糊', action: '补充工具 description 示例',
    scope: 'auto', confidence: 0.9, status: 'active', verdict: 'keep',
    before: 2, after: 0,
  },
];

test('J2 P1 模块存在且零新依赖（仅 Node 内置）', () => {
  assert.ok(fs.existsSync(MODULE), '须有 core/shared-backend/skill-suggestion-projector.js');
  const s = fs.readFileSync(MODULE, 'utf8');
  assert.doesNotMatch(s, /require\(['"](?!\.\.?\/|node:)/, '不得引入非本地/非 node 新依赖');
});

test('projectSkillSuggestions：lessons→建议，draft tier 标注 + skillId 归因', () => {
  const { projectSkillSuggestions } = load();
  const out = projectSkillSuggestions({ lessons, availableSkillIds: ['script-host', 'coding-playbook'] });
  assert.equal(out.ok, true);
  assert.equal(out.suggestions.length, 2);
  const first = out.suggestions[0];
  assert.equal(first.sourceFingerprint, 'fp1');
  assert.equal(first.tier, 'draft', '建议只能出草案，不自动执行');
  assert.equal(first.autoApply, false, 'D2 默认否：不自动建任务/不自动落盘');
  assert.ok(typeof first.skillId === 'string' && first.skillId, '须归因到某个 skill id');
  assert.ok(first.prompt.includes(first.action), '一键建任务 prompt 须含建议 action');
});

test('忽略账本：ignored fingerprint 被过滤，可跨蒸馏存活（独立账本）', () => {
  const { projectSkillSuggestions } = load();
  const out = projectSkillSuggestions({
    lessons,
    availableSkillIds: ['script-host', 'coding-playbook'],
    ignored: { fp1: { at: '2026-11-23', reason: '不相关' } },
  });
  assert.equal(out.suggestions.length, 1);
  assert.equal(out.suggestions[0].sourceFingerprint, 'fp2');
  assert.equal(out.ignoredCount, 1);
});

test('空输入/无匹配 skill 不伪造建议，不泄漏内部字段', () => {
  const { projectSkillSuggestions } = load();
  const empty = projectSkillSuggestions({ lessons: [], availableSkillIds: [] });
  assert.equal(empty.suggestions.length, 0);
  const noSkill = projectSkillSuggestions({ lessons, availableSkillIds: [] });
  assert.equal(noSkill.suggestions.length, 0, '无可用 skill 时不伪造归因');
});

test('红线：不改内置 skill 资产与既有 harness 红线', () => {
  const redline = fs.readFileSync(path.join(ROOT, 'core', 'shared-backend', 'harness-redline.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(ROOT, 'resources', 'skills', 'manifest.json'), 'utf8');
  assert.match(redline, /resources\/skills/, 'harness 红线禁改内置 skill 仍在');
  assert.ok(manifest.includes('builtinSha256'), 'manifest hash 仍在（建议不写 manifest）');
});
