/**
 * QODER-A2 P2/P3 — 按需解释路由 + 前端按钮/骨架/失败降级 HK-01 契约（2026-11-23）。
 *
 * P2：POST /api/ai/agent/task/:taskId/approval/:requestId/explain，从 approval-request-store
 * 取 intent → resolveModelExplanation → fail-soft（失败返 null，不写 deny/allow 语义）。
 * P3：GuardAckCard「解释」按钮 + 分析中骨架 + 失败保留确定性解释 + 审批按钮全程可用。
 * 红线：零新依赖；不改产品 sandbox/CSP/凭据/B1 token/handler/pack 声明；外观零代签。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('P2 后端：按需解释路由注册 + 从 store 取 intent + fail-soft', () => {
  const routes = read('core/petri-server/routes/ai-agent/task-actions.js');
  assert.match(routes, /\/approval\/:requestId\/explain/, '须注册按需解释路由');
  assert.match(routes, /getApprovalRequest\s*\(/, '须从 approval-request-store 取请求上下文');
  assert.match(routes, /resolveModelExplanation/, '须调用 P1 模型解释辅助');
  assert.match(routes, /explainUnavailable|explanation:\s*null|ok:\s*false/, '失败须 fail-soft 明确不可用，不伪造解释');
});

test('P3 前端 hook：解释 handler 调路由 + 失败保留确定性解释', () => {
  const hook = read('frontend/src/components/copilot/SimpleChat/hooks/useGuardAck.ts');
  assert.match(hook, /handleGuardExplain/, '须有解释 handler');
  assert.match(hook, /\/approval\/.*\/explain/, '须调 explain 路由');
  assert.match(hook, /guardExplainBusy|explainBusy/, '须有解释中状态（骨架判据）');
  assert.match(hook, /catch|!data\.ok|ok !== true/, '失败须吞掉并保留原解释，不翻状态');
});

test('P3 UI：「解释」按钮 + 骨架 + 审批按钮未被禁用/包裹在 loading 内', () => {
  const card = read('frontend/src/components/copilot/SimpleChat/GuardAckCard.tsx');
  assert.match(card, /解释|重新解释/, '须有解释按钮文案');
  assert.match(card, /guardExplainBusy|explainBusy|分析中|解释中/, '须有分析中骨架态');
  for (const btn of ['放行一次', '拒绝']) {
    assert.ok(card.includes(btn), `审批按钮 ${btn} 须在场`);
  }
  // 审批按钮不得因「解释中」禁用（解释按钮自身的 disabled={guardExplainBusy} 是允许的）。
  const buttons = card.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || [];
  const ackButtons = buttons.filter((block) => /放行一次|本任务|始终信任|拒绝/.test(block));
  assert.ok(ackButtons.length >= 2, '须能定位审批按钮块');
  for (const block of ackButtons) {
    assert.doesNotMatch(block, /disabled=\{[^}]*explain/i, '审批按钮不得因解释中禁用');
  }
});

test('红线：产品安全边界与既有审批决策测试未改', () => {
  const interceptor = read('core/petri-server/agent-tools/agent-tool-interceptor.js');
  const scheme = read('src/main/pack-ui/scheme.js');
  assert.match(interceptor, /approvalIntent/, '确定性解释生成仍在');
  assert.match(scheme, /protocol\.handle\(SCHEME/, 'pack handler 未改');
  assert.ok(fs.existsSync(path.join(ROOT, 'test', 'block243-approval-contract.test.mjs')), '审批契约测仍在');
});
