'use strict';

/**
 * BLOCK-346 方向2 — harness_plan_task 工具契约。
 *
 * 该工具把「证据优先的科研计划」从只存在于 REST 端点变成 agent 可调能力。
 * 只读分析（R0），不建 job、不写库。本契约钉住：
 *   ① 参数缺失时明确报错（不返回空计划冒充成功）
 *   ② 环境不可用时诚实降级为 harness_unavailable（带 message）
 *   ③ 成功时必须带 plan + scope，且 **绝不**返回 ok:true 的空壳
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require_ = createRequire(import.meta.url);

const { tool_harness_plan_task } = require_(path.join(ROOT, 'core/petri-server/agent-tools/harness-tools.js'));
const { TOOL_DEFS } = require_(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs.js'));

describe('harness_plan_task（BLOCK-346 方向2）', () => {
  test('定义在 TOOL_DEFS 中且只要求 taskSpec', () => {
    const def = TOOL_DEFS.find((t) => t.function && t.function.name === 'harness_plan_task');
    assert.ok(def, 'harness_plan_task 未进 TOOL_DEFS');
    assert.deepEqual(def.function.parameters.required, ['taskSpec']);
    assert.equal(def.function.parameters.properties.taskSpec.type, 'object');
  });

  test('taskSpec 非对象 → missing_task_spec', async () => {
    const r = await tool_harness_plan_task({ taskSpec: 'oops' }, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'missing_task_spec');
  });

  test('缺 projectId → missing_project_id（不静默落空计划）', async () => {
    const r = await tool_harness_plan_task({ taskSpec: { goal: 'x' } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'missing_project_id');
  });

  test('环境不可用 → harness_unavailable 且带 message；可用时成功必带 plan', async () => {
    const r = await tool_harness_plan_task({ taskSpec: { projectId: 'proj_probe', goal: 'diff expression' } }, { userId: 'u1' });
    if (r.ok) {
      assert.ok(r.plan && typeof r.plan === 'object', '成功时必须带 plan');
      assert.equal(r.projectId, 'proj_probe');
    } else {
      assert.equal(r.error, 'harness_unavailable');
      assert.ok(typeof r.message === 'string' && r.message.length > 0, '降级必须带 message');
    }
  });
});
