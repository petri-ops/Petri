/**
 * item 86 HK-01 — 内核组合根 locator（环解耦的反转面）。
 *
 * 为什么存在：agent-runner 是组合根，spawn-agent-tools / agent-fallback / resume /
 * automation-store 需要它的运行期服务（runAgentLoop / 内置工具名单），但反向 require
 * 会构成循环依赖（arch-cycles 基线 11 环中的 A/B/C 三族）。此模块做依赖反转：
 * 组合根在模块加载时 register，消费方 get——图上只有「消费方 → 本模块」「agent-runner →
 * 本模块」两条单向边，环消失。这不是豁免：forbidCycles 规则照跑，环是真解开的。
 *
 * fail-fast 契约：未注册就 get = 抛错（宁可显式失败，不静默 undefined）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const requireFrom = (rel) => require(path.join(ROOT, rel));

// HK-86-5 要真加载组合根（agent-runner 加载链会 prepare projects 表）——同 mcp-tool-registry
// 同款临时库+全量迁移自举，真修不 skip。
const { bootstrapTestDb } = requireFrom('test/helpers/bootstrap-db.mjs');
bootstrapTestDb('item86-kernel-registry-');
const {
  registerAgentLoopEntry,
  getAgentLoopEntry,
  registerBuiltinToolNames,
  getBuiltinToolNames,
  __resetKernelRegistryForTest,
} = requireFrom('core/petri-server/helpers/kernel-registry.js');

test('HK-86-1：register→get 往返，未注册时 fail-fast 抛错', () => {
  __resetKernelRegistryForTest();
  assert.throws(() => getAgentLoopEntry(), /未注册|not registered/i);
  assert.throws(() => getBuiltinToolNames(), /未注册|not registered/i);

  const runAgentLoop = () => ({});
  registerAgentLoopEntry({ runAgentLoop });
  assert.equal(getAgentLoopEntry(), runAgentLoop);

  registerBuiltinToolNames(['workspace_read', 'generate_image']);
  assert.deepEqual(getBuiltinToolNames(), ['workspace_read', 'generate_image']);
});

test('HK-86-2：重复注册拒绝（单一组合根，防静默覆盖）', () => {
  __resetKernelRegistryForTest();
  registerAgentLoopEntry({ runAgentLoop: () => ({}) });
  assert.throws(() => registerAgentLoopEntry({ runAgentLoop: () => ({}) }), /重复|already/i);
  registerBuiltinToolNames(['a']);
  assert.throws(() => registerBuiltinToolNames(['b']), /重复|already/i);
});

test('HK-86-3：入参形态错误 fail-fast', () => {
  __resetKernelRegistryForTest();
  assert.throws(() => registerAgentLoopEntry({}), /runAgentLoop/);
  assert.throws(() => registerAgentLoopEntry({ runAgentLoop: 'not-a-function' }), /runAgentLoop/);
  assert.throws(() => registerBuiltinToolNames('nope'), /数组|array/i);
  assert.throws(() => registerBuiltinToolNames([1, 2]), /字符串|string/i);
});

test('HK-86-4（值岗）：真实模块已从 locator 取服务、不再反向 require agent-runner/registry', () => {
  const fs = require('node:fs');
  // spawn-agent-tools / agent-fallback / resume 不再 require agent-runner
  for (const rel of [
    'core/petri-server/agent-tools/spawn-agent-tools.js',
    'core/petri-server/helpers/agent-fallback.js',
    'core/petri-server/routes/ai-agent/resume.js',
  ]) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(
      /require\((['"]).*agent-runner\1\)/.test(text),
      false,
      `${rel} 不得再反向 require agent-runner（改走 kernel-registry）`
    );
  }
  // automation-store 不再 require registry
  const store = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/automation-store.js'), 'utf8');
  assert.equal(/require\((['"]).*agent-tools\/registry\1\)/.test(store), false,
    'automation-store 不得 require agent-tools/registry（改走 kernel-registry）');
  // tool-defs 不再 require registry（环 D 的反向边）
  const toolDefs = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs.js'), 'utf8');
  assert.equal(/require\((['"]).*\.\/registry\1\)/.test(toolDefs), false,
    'tool-defs 不得 require ./registry（getToolDefs 改由 index 从 registry 转出）');
});

test('HK-86-5（值岗）：组合根已完成注册（真模块加载后 get 即命中）', () => {
  // 直接 require agent-runner（组合根）：应向 locator 注册 loop entry；registry 应注册内置名单
  const runner = requireFrom('core/petri-server/agent-runner.js');
  assert.equal(typeof getAgentLoopEntry(), 'function', 'agent-runner 加载后应注册 runAgentLoop');
  const names = getBuiltinToolNames();
  assert.ok(Array.isArray(names) && names.length > 100, `内置工具名单应已注册（实际 ${Array.isArray(names) ? names.length : '无'}）`);
  assert.ok(names.includes('workspace_read'));
  void runner;
});
