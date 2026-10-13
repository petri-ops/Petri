/**
 * BLOCK-179 P0 — 正文工具块修复提升：解析器单测（红绿先行）。
 *
 * scanPlainTextToolCalls 契约：
 * - 三形态解析：围栏代码块 JSON / 正文顶层裸 JSON 对象 / <tool_call> 标签包裹 JSON
 *   （实现为字符串感知的顶层平衡扫描，三种包裹内的 JSON 对象天然同被覆盖）。
 * - 保护规则 fail-closed：任一候选 name 不在可用名单 → 整轮 keep；
 *   arguments 非对象 → 该块弃（invalid_arguments）；候选 >maxCalls → 整轮 keep。
 * - keep 决策零副作用、reasons 可审计。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { scanPlainTextToolCalls } = require(resolve(root, 'core/petri-server/helpers/tool-call-repair.js'));

const TOOLS = new Set(['system_info', 'workspace_read', 'run_tool']);

function scan(text, options = {}) {
  return scanPlainTextToolCalls(text, { availableToolNames: TOOLS, ...options });
}

test('围栏代码块内的工具调用 JSON → repair', () => {
  const text = [
    '我来读取文件。',
    '',
    '```json',
    '{"name": "workspace_read", "arguments": {"path": "data.csv"}}',
    '```',
  ].join('\n');
  const result = scan(text);
  assert.equal(result.decision, 'repair');
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, 'workspace_read');
  assert.deepEqual(JSON.parse(result.calls[0].arguments), { path: 'data.csv' });
});

test('正文顶层裸 JSON 对象（name+arguments 双键）→ repair', () => {
  const text = '先查系统信息 {"name": "system_info", "arguments": {}} 再汇报。';
  const result = scan(text);
  assert.equal(result.decision, 'repair');
  assert.equal(result.calls[0].name, 'system_info');
});

test('<tool_call> 标签包裹 → repair', () => {
  const text = '<tool_call>{"name": "system_info", "arguments": {}}</tool_call>';
  const result = scan(text);
  assert.equal(result.decision, 'repair');
  assert.equal(result.calls[0].name, 'system_info');
});

test('键名别名：tool/args 与 tool/parameters → repair', () => {
  const a = scan('{"tool": "workspace_read", "args": {"path": "a.txt"}}');
  assert.equal(a.decision, 'repair');
  assert.equal(a.calls[0].name, 'workspace_read');
  const b = scan('{"tool": "workspace_read", "parameters": {"path": "a.txt"}}');
  assert.equal(b.decision, 'repair');
  assert.equal(b.calls[0].name, 'workspace_read');
});

test('缺 arguments 键 → 视为空参数调用', () => {
  const result = scan('{"name": "system_info"}');
  assert.equal(result.decision, 'repair');
  assert.equal(result.calls[0].arguments, '{}');
});

test('arguments 为对象（非字符串）→ 规范化为 JSON 字符串', () => {
  const result = scan('{"name": "workspace_read", "arguments": {"path": "x"}}');
  assert.equal(result.decision, 'repair');
  assert.equal(typeof result.calls[0].arguments, 'string');
  assert.deepEqual(JSON.parse(result.calls[0].arguments), { path: 'x' });
});

test('arguments 双重编码字符串 → 解码规范化', () => {
  const result = scan('{"name": "workspace_read", "arguments": "{\\"path\\": \\"y\\"}"}');
  assert.equal(result.decision, 'repair');
  assert.deepEqual(JSON.parse(result.calls[0].arguments), { path: 'y' });
});

test('纯文本最终回答（无 JSON）→ keep 且零 reasons', () => {
  const result = scan('任务已完成，结果如下：……');
  assert.equal(result.decision, 'keep');
  assert.deepEqual(result.calls, []);
  assert.deepEqual(result.reasons, []);
});

test('无 name 键的 JSON 载荷（数据展示）→ keep', () => {
  const result = scan('示例输出：{"result": 42, "status": "ok"}');
  assert.equal(result.decision, 'keep');
  assert.equal(result.blocks, 0);
});

test('未知工具名 → 整轮 keep + unknown_tool_name reasons（演示/文档保护）', () => {
  const result = scan('调用示例：{"name": "not_a_real_tool", "arguments": {}}');
  assert.equal(result.decision, 'keep');
  assert.deepEqual(result.reasons, [{ code: 'unknown_tool_name', tools: ['not_a_real_tool'] }]);
});

test('已知+未知混合 → 整轮 keep（fail-closed）', () => {
  const text = '{"name": "system_info", "arguments": {}} {"name": "fake_tool", "arguments": {}}';
  const result = scan(text);
  assert.equal(result.decision, 'keep');
  assert.equal(result.reasons[0].code, 'unknown_tool_name');
});

test('arguments 非对象（数字）→ 该块弃 + invalid_arguments', () => {
  const result = scan('{"name": "system_info", "arguments": 42}');
  assert.equal(result.decision, 'keep');
  assert.deepEqual(result.reasons, [{ code: 'invalid_arguments', tool: 'system_info' }]);
});

test('一个坏块 + 一个好块 → repair 仅保留好块，坏块留 reason', () => {
  const text = '{"name": "system_info", "arguments": null} {"name": "workspace_read", "arguments": {"path": "p"}}';
  const result = scan(text);
  assert.equal(result.decision, 'repair');
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, 'workspace_read');
  assert.deepEqual(result.reasons, [{ code: 'invalid_arguments', tool: 'system_info' }]);
});

test('候选超过 maxCalls（缺省 5）→ 整轮 keep + too_many_candidates', () => {
  const six = Array.from({ length: 6 }, () => '{"name": "system_info", "arguments": {}}').join(' ');
  const result = scan(six);
  assert.equal(result.decision, 'keep');
  assert.deepEqual(result.reasons, [{ code: 'too_many_candidates', count: 6, maxCalls: 5 }]);
  const five = Array.from({ length: 5 }, () => '{"name": "system_info", "arguments": {}}').join(' ');
  assert.equal(scan(five).decision, 'repair');
  assert.equal(scan(six, { maxCalls: 6 }).decision, 'repair', '显式 maxCalls 可放宽');
});

test('嵌套对象内的 name/arguments 不算候选（仅顶层）', () => {
  const result = scan('配置示例：{"outer": {"name": "system_info", "arguments": {}}}');
  assert.equal(result.decision, 'keep');
  assert.equal(result.blocks, 0);
});

test('批量包裹 {"tool_calls": [...]} → 逐项展开', () => {
  const text = '{"tool_calls": [{"name": "system_info", "arguments": {}}, {"name": "workspace_read", "arguments": {"path": "z"}}]}';
  const result = scan(text);
  assert.equal(result.decision, 'repair');
  assert.equal(result.calls.length, 2);
  assert.deepEqual(result.calls.map((c) => c.name), ['system_info', 'workspace_read']);
});

test('字符串内的花括号不干扰平衡扫描（字符串感知）', () => {
  const result = scan('{"name": "workspace_read", "arguments": {"path": "a}{b"}}');
  assert.equal(result.decision, 'repair');
  assert.deepEqual(JSON.parse(result.calls[0].arguments), { path: 'a}{b' });
});

test('多候选保留出现顺序', () => {
  const text = '{"name": "workspace_read", "arguments": {"path": "1"}} 中间叙述 {"name": "system_info", "arguments": {}}';
  const result = scan(text);
  assert.deepEqual(result.calls.map((c) => c.name), ['workspace_read', 'system_info']);
});

test('空/非字符串输入 → keep 零 reasons', () => {
  assert.equal(scan('').decision, 'keep');
  assert.equal(scan('   ').decision, 'keep');
  assert.equal(scan(null).decision, 'keep');
  assert.equal(scan(undefined).decision, 'keep');
});

test('availableToolNames 接受数组形态；空名单全 keep', () => {
  const text = '{"name": "system_info", "arguments": {}}';
  assert.equal(scan(text, { availableToolNames: ['system_info'] }).decision, 'repair');
  assert.equal(scan(text, { availableToolNames: [] }).decision, 'keep');
  assert.equal(
    scanPlainTextToolCalls(text, {}).decision,
    'keep',
    '缺名单 = 空 = 全 keep（fail-closed）',
  );
});

test('畸形 JSON（花括号不闭合/非 JSON 代码）→ 不炸不误收', () => {
  assert.equal(scan('{"name": "system_info", "arguments": {').decision, 'keep');
  assert.equal(scan('function f() { return {a: 1}; }').decision, 'keep');
  const snippet = '代码：```js\nconst x = {"name": "system_info", "arguments": {}};\n```';
  assert.equal(scan(snippet).decision, 'repair', '代码围栏内的合法 JSON 工具调用仍可解析（形态不区分）');
});
