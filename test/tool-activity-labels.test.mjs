// UI-437 v5.18 — 工具动词注册表契约（后端侧）
//
// test/fixtures/tool-activity-labels.json 是动词/图标唯一真源：
//   - 本测试钉住后端 tool-events.js 的 TOOL_ACTIVITY_VERBS / summarizeToolCallForActivity
//   - 前端 toolActivity.test.ts 钉住前端 TOOL_ACTIVITY_VERBS / TOOL_ACTIVITY_ICONS
//   - 覆盖完整性以 TOOL_DEFS（71 静态工具）为宇宙，双向断言（缺登记/多余登记都红）
// 未登记（MCP/插件动态工具）保持「已调用 name（参数摘要）」兜底，不入册。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixture = JSON.parse(
  readFileSync(new URL('../test/fixtures/tool-activity-labels.json', import.meta.url), 'utf8')
);
const { TOOL_DEFS } = require(`${repoRoot}/core/petri-server/agent-tools/tool-defs.js`);
const { TOOL_ACTIVITY_VERBS, summarizeToolCallForActivity } = require(`${repoRoot}/core/petri-server/agent-tools/tool-events.js`);

test('fixture 覆盖全量静态工具宇宙（TOOL_DEFS 80 个）', () => {
  const universe = TOOL_DEFS.map((t) => t.function.name).sort();
  const fixtureKeys = Object.keys(fixture).sort();
  assert.equal(universe.length, 80);
  assert.deepEqual(fixtureKeys, universe);
});

test('后端动词注册表与 fixture 逐工具一致', () => {
  assert.deepEqual(Object.keys(TOOL_ACTIVITY_VERBS).sort(), Object.keys(fixture).sort());
  for (const [name, expected] of Object.entries(fixture)) {
    assert.equal(TOOL_ACTIVITY_VERBS[name], expected.label, `verbs[${name}]`);
  }
});

test('summarizeToolCallForActivity 逐工具产出 fixture 动词', () => {
  for (const [name, expected] of Object.entries(fixture)) {
    assert.equal(summarizeToolCallForActivity(name).actionLabel, expected.label, `label[${name}]`);
  }
});

test('定制宾语采样：knowledge_search/todo_write/spawn_agent', () => {
  assert.equal(
    summarizeToolCallForActivity('knowledge_search', { query: '验收测试', topK: 5 }).actionDetail,
    '验收测试'
  );
  assert.equal(summarizeToolCallForActivity('todo_write', { items: [{ id: 1 }] }).actionDetail, '任务清单');
  assert.equal(
    summarizeToolCallForActivity('spawn_agent', { task: '核对登记行', role: '🔍' }).actionDetail,
    '核对登记行'
  );
});

test('未登记工具（MCP/插件动态）保持「已调用 name（参数摘要）」兜底', () => {
  const r = summarizeToolCallForActivity('mcp__ext__lookup', { q: 'x' });
  assert.equal(r.actionLabel, '已调用');
  assert.equal(r.actionDetail, 'mcp__ext__lookup（q=x）');
});
