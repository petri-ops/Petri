/**
 * QODER-A2「审批意图解释」— P1 后端纯函数 HK-01 契约（2026-11-23）。
 *
 * 用户发令「🟡9 立刻开工 A2」（评审稿默认 D1 零新 provider / D2 复用现有本地模型绑定）。
 * A2 验收=「解释可读 + 失败降级不阻断审批」。P1 切片=模型解释辅助纯函数：
 * prompt 构造（从确定性 intent 派生，不编造）+ 文本规范化 + fail-soft（失败/空返回 null）。
 * 零新依赖：只用现有 callModelTask({role:'explanation'})。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = path.join(ROOT, 'core', 'petri-server', 'helpers', 'approval-explanation.js');
const load = () => require(HELPER);

test('A2 P1 模块存在且零新依赖（仅复用 callModelTask）', () => {
  assert.ok(fs.existsSync(HELPER), '须有 core/petri-server/helpers/approval-explanation.js');
  const s = fs.readFileSync(HELPER, 'utf8');
  assert.match(s, /callModelTask/, '须走现有 model task 通道');
  assert.match(s, /role:\s*['"]explanation['"]/, '须用 explanation role');
  assert.doesNotMatch(s, /require\(['"](?!\.\.?\/|node:)/, '不得引入非本地/非 node 新依赖');
});

test('prompt 从确定性 intent 派生，明确不编造/不覆盖审批判断', () => {
  const { buildApprovalExplanationPrompt } = load();
  const prompt = buildApprovalExplanationPrompt({
    action: '写入文件', impact: '修改项目内 1 个文件', reversible: true, reason: '用户请求',
  });
  assert.ok(typeof prompt === 'string' && prompt.length > 20, 'prompt 须可读');
  for (const token of ['写入文件', '修改项目内 1 个文件', '不编造', '不替代']) {
    assert.ok(prompt.includes(token), `prompt 须含 ${token}`);
  }
});

test('文本规范化：空/超长/-whitespace 失败-soft', () => {
  const { normalizeModelExplanation } = load();
  assert.equal(normalizeModelExplanation(''), null);
  assert.equal(normalizeModelExplanation('   \n  '), null);
  assert.equal(normalizeModelExplanation(null), null);
  const long = '说'.repeat(2000);
  const normalized = normalizeModelExplanation(long);
  assert.ok(normalized && normalized.length <= 600, '超长解释须有界截断');
  assert.equal(normalizeModelExplanation('  模型解释文本  '), '模型解释文本');
});

test('resolveModelExplanation 失败返回 null（不阻断审批）', async () => {
  const { resolveModelExplanation } = load();
  const failed = await resolveModelExplanation({
    intent: { action: 'x' },
    callTask: async () => ({ text: '', error: 'model_unavailable' }),
  });
  assert.equal(failed, null, '模型失败须 fail-soft 返回 null');
  const ok = await resolveModelExplanation({
    intent: { action: 'x' },
    callTask: async () => ({ text: '该操作仅写入本项目文件，可撤销。', error: null }),
  });
  assert.equal(ok, '该操作仅写入本项目文件，可撤销。');
});

test('产品审批硬边界未被本票改写（零新 provider/不改 deny 语义）', () => {
  const interceptor = fs.readFileSync(
    path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'agent-tool-interceptor.js'), 'utf8',
  );
  const card = fs.readFileSync(
    path.join(ROOT, 'frontend', 'src', 'components', 'copilot', 'SimpleChat', 'GuardAckCard.tsx'), 'utf8',
  );
  assert.match(interceptor, /approvalIntent/, '确定性解释生成仍在');
  assert.match(card, /放行一次|拒绝/, '审批按钮仍在（P1 不触碰前端按钮）');
});
