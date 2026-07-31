import assert from 'node:assert/strict';
import test from 'node:test';

import {
  P6_UI110_GATEWAY_CLASSIFICATION,
  buildP6Ui110GatewayResponse,
  classifyP6Ui110Request,
  startP6Ui110LocalGateway,
} from '../scripts/g0-rs-p6-ui110-local-gateway.mjs';

const INTENT = {
  intentId: 'rei_test',
  artifactRef: { artifactId: 'deg_table', revisionId: 'rev_test' },
};

function toolMessage(name, data, status = 'success') {
  return {
    role: 'tool',
    name,
    tool_call_id: 'call_test',
    content: JSON.stringify({ tool: name, status, data }),
  };
}

function toolName(response) {
  return response.choices[0].message.tool_calls?.[0]?.function?.name || null;
}

test('P6 UI-110 gateway classifies only the admitted natural-language routes', () => {
  assert.equal(classifyP6Ui110Request([{ role: 'user', content: '用当前差异基因做 GO 和 KEGG 富集' }]), 'enrichment');
  assert.equal(classifyP6Ui110Request([{ role: 'user', content: '把火山图的点放大并标注选择的基因' }]), 'volcano_presentation');
  assert.equal(classifyP6Ui110Request([{ role: 'user', content: '将 LFC 阈值改为 1.7' }]), 'deg_scientific');
  assert.equal(
    classifyP6Ui110Request([{ role: 'user', content: '将 LFC 阈值改为 1.7，重新计算受影响的下游富集结果' }]),
    'deg_scientific',
  );
  assert.equal(classifyP6Ui110Request([{ role: 'user', content: '把热图的相关性方法改为 Spearman' }]), 'heatmap_scientific');
  assert.equal(classifyP6Ui110Request([{ role: 'user', content: '随机问题' }]), 'unknown');
});

test('P6 UI-110 gateway follows context, plan, create with private server token binding', () => {
  const user = { role: 'user', content: '把火山图的点放大并标注选择的基因' };
  const first = buildP6Ui110GatewayResponse({ messages: [user] }, 1);
  assert.equal(toolName(first.response), 'result_studio_context');
  assert.deepEqual(first.trace, { kind: 'volcano_presentation', phase: 'context', toolName: 'result_studio_context' });

  const context = toolMessage('result_studio_context', { ok: true });
  const planned = buildP6Ui110GatewayResponse({ messages: [user, context] }, 2);
  assert.equal(toolName(planned.response), 'result_edit_plan_in_context');
  const planArgs = JSON.parse(planned.response.choices[0].message.tool_calls[0].function.arguments);
  assert.equal(Object.hasOwn(planArgs, 'contextToken'), false);
  assert.equal(planArgs.useCurrentSelectionForLabels, true);

  const plan = toolMessage('result_edit_plan_in_context', { ok: true, intent: INTENT });
  const created = buildP6Ui110GatewayResponse({ messages: [user, context, plan] }, 3);
  assert.equal(toolName(created.response), 'result_changeset_create_in_context');
  const createArgs = JSON.parse(created.response.choices[0].message.tool_calls[0].function.arguments);
  assert.equal(Object.hasOwn(createArgs, 'contextToken'), false);
  assert.deepEqual(createArgs.intent, INTENT);
  assert.equal(createArgs.scientificConfirmed, true);
});

test('P6 UI-110 gateway never extracts a context token from model-visible output', () => {
  const user = { role: 'user', content: '把火山图的点放大并标注选择的基因' };
  const context = toolMessage('result_studio_context', {
    ok: true,
    context: { contextToken: 'a'.repeat(64) },
  });
  const planned = buildP6Ui110GatewayResponse({ messages: [user, context] }, 2);
  assert.equal(toolName(planned.response), 'result_edit_plan_in_context');
  const args = JSON.parse(planned.response.choices[0].message.tool_calls[0].function.arguments);
  assert.equal(Object.hasOwn(args, 'contextToken'), false);
});

test('P6 UI-110 gateway ignores unrelated tool output when planning', () => {
  const user = { role: 'user', content: '把火山图的点放大并标注选择的基因' };
  const context = toolMessage('result_studio_context', { ok: true });
  const unrelated = toolMessage('workspace_read', {
    ok: true,
    intent: INTENT,
    contextToken: 'a'.repeat(64),
  });
  const planned = buildP6Ui110GatewayResponse({ messages: [user, context, unrelated] }, 2);
  assert.equal(toolName(planned.response), 'result_edit_plan_in_context');
  const planArgs = JSON.parse(planned.response.choices[0].message.tool_calls[0].function.arguments);
  assert.equal(Object.hasOwn(planArgs, 'contextToken'), false);
});

test('P6 UI-110 gateway terminates failed context, plan, create, and enrichment paths', () => {
  const user = { role: 'user', content: '把火山图的点放大并标注选择的基因' };
  const failedContext = toolMessage('result_studio_context', { ok: false }, 'error');
  assert.equal(toolName(buildP6Ui110GatewayResponse({ messages: [user, failedContext] }, 2).response), null);

  const context = toolMessage('result_studio_context', { ok: true });
  const failedPlan = toolMessage('result_edit_plan_in_context', { ok: false }, 'error');
  const blockedPlan = buildP6Ui110GatewayResponse({ messages: [user, context, failedPlan] }, 3);
  assert.equal(toolName(blockedPlan.response), null);
  assert.equal(blockedPlan.trace.errorCode, 'tool_failed_without_safe_code');

  const codedPlanFailure = toolMessage(
    'result_edit_plan_in_context',
    { ok: false, error: 'workflow_graph_stale_or_unpersisted' },
    'error',
  );
  assert.equal(
    buildP6Ui110GatewayResponse({ messages: [user, context, codedPlanFailure] }, 3).trace.errorCode,
    'workflow_graph_stale_or_unpersisted',
  );

  const plan = toolMessage('result_edit_plan_in_context', { ok: true, intent: INTENT });
  const failedCreate = toolMessage('result_changeset_create_in_context', { ok: false }, 'error');
  assert.equal(toolName(buildP6Ui110GatewayResponse({ messages: [user, context, plan, failedCreate] }, 4).response), null);

  const enrichmentUser = { role: 'user', content: '用当前差异基因做 GO 和 KEGG 富集' };
  const enrichment = buildP6Ui110GatewayResponse({ messages: [enrichmentUser, context] }, 5);
  assert.equal(toolName(enrichment.response), 'result_enrichment_from_context');
  const success = toolMessage('result_enrichment_from_context', { ok: true });
  assert.equal(toolName(buildP6Ui110GatewayResponse({ messages: [enrichmentUser, context, success] }, 6).response), null);
  const failedEnrichment = toolMessage('result_enrichment_from_context', { ok: false }, 'error');
  assert.equal(toolName(buildP6Ui110GatewayResponse({ messages: [enrichmentUser, context, failedEnrichment] }, 7).response), null);
});

test('P6 UI-110 gateway exposes only a local OpenAI-compatible endpoint', async () => {
  const gateway = await startP6Ui110LocalGateway();
  try {
    assert.equal(gateway.classification, P6_UI110_GATEWAY_CLASSIFICATION);
    const response = await fetch(`${gateway.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: '将 LFC 阈值改为 1.7' }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(toolName(await response.json()), 'result_studio_context');
    assert.deepEqual(gateway.trace, [{
      requestIndex: 1,
      kind: 'deg_scientific',
      phase: 'context',
      toolName: 'result_studio_context',
    }]);
  } finally {
    await gateway.close();
  }
});
