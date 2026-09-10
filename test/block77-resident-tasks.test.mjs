// BLOCK-77 P1 — 驻留任务工具定义契约（零网络）。
// 行为面（exec_bg 起进程 + 意图卡落盘）依赖项目运行时，P4 实机全链覆盖；
// 本测试锁工具定义与必填参数契约，防止 schema 漂移。
import assert from 'node:assert/strict';
import test from 'node:test';

const { TOOL_DEFS } = await import('../core/biof3-server/agent-tools/tool-defs.js');

function def(name) {
  return TOOL_DEFS.find((d) => d.function && d.function.name === name);
}

test('resident_task_create 定义存在且 command/intent 必填', () => {
  const d = def('resident_task_create');
  assert.ok(d, 'resident_task_create 定义缺失');
  assert.equal(d.type, 'function');
  const props = d.function.parameters.properties;
  assert.ok(props.command && props.intent, 'command/intent 参数缺失');
  assert.deepEqual(d.function.parameters.required.sort(), ['command', 'intent'].sort());
  assert.ok(/意图卡/.test(d.function.description), 'description 应说明意图卡语义');
});

test('resident_task_list / resident_task_read 定义存在', () => {
  assert.ok(def('resident_task_list'), 'resident_task_list 定义缺失');
  const read = def('resident_task_read');
  assert.ok(read, 'resident_task_read 定义缺失');
  assert.deepEqual(read.function.parameters.required, ['taskId']);
});

test('三个驻留工具不与既有工具重名', () => {
  const names = TOOL_DEFS.map((d) => d.function && d.function.name).filter(Boolean);
  assert.equal(new Set(names).size, names.length);
});
