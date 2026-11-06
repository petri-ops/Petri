/**
 * nso-w2b-capability-audit.test.mjs — BLOCK-367（NSO-W2b）审批-执行边界审计透传。
 *
 * 实核（评估 F-06 修正）：once 指纹已在拦截器执行前同步消耗（同进程同步执行无旁路窗口）。
 * 缺口（剩余）：消耗事实停在拦截器层，handler 收不到「本次是被哪个机制放行的」——
 * 执行边界（工具结果/审计面）无法区分「正常策略放行」与「一次性指纹放行」。
 * 契约：消耗 ⇒ handlerOptions.capabilityEvidence={ fingerprintConsumed:true, source:'once_fingerprint' }；
 * 未消耗 ⇒ 无该字段（零行为噪声）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('W2b 单元级：消耗 ⇒ evidence 在场；未消耗 ⇒ 不在场（源码装配契约）', () => {
  const src = require('node:fs').readFileSync(require.resolve('../core/petri-server/agent-tools/agent-tool-interceptor.js'), 'utf8');
  assert.match(src, /capabilityEvidence[\s\S]{0,200}fingerprintConsumed: true[\s\S]{0,60}once_fingerprint/, '消耗事实必须以 capabilityEvidence 透传 handlerOptions');
  // 装配位置契约：必须在 handler 调用前、消耗点之后
  const consumeAt = src.indexOf('consumeFingerprint');
  const evidenceAt = src.indexOf('capabilityEvidence');
  const handlerCall = src.indexOf('entry.handler(args, ctx, handlerOptionsWithAudit)');
  assert.ok(consumeAt > 0 && evidenceAt > consumeAt && handlerCall > evidenceAt, '装配顺序：消耗 → 组装 evidence → 调 handler');
});
