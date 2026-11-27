'use strict';

/**
 * shared kernel-registry（item 86 — arch-cycles 环解耦的依赖反转面）
 *
 * 为什么存在：agent-runner 是组合根，spawn-agent-tools / agent-fallback / resume /
 * automation-store 需要它的运行期服务（runAgentLoop / 内置工具名单），但反向 require
 * 构成循环依赖（arch-cycles 基线 A/B/C 三族环）。此模块做依赖反转：
 *   - 组合根（agent-runner / registry）在模块加载时 register；
 *   - 消费方用 get 取服务；
 *   - 图上只剩「组合根 → 本模块」「消费方 → 本模块」单向边，环消失。
 *
 * 这不是门禁豁免：forbidCycles 照跑，环是真解开的。HK-01 值岗断言在
 * test/item86-kernel-registry.test.mjs（HK-86-4/5）。
 *
 * fail-fast 契约：
 *   - 未注册就 get → 抛错（宁可显式失败，不静默 undefined）；
 *   - 重复 register → 抛错（单一组合根，防静默覆盖）；
 *   - 入参形态错误 → 抛错。
 * 时序保证：所有消费调用都发生在请求/运行期（组合根早已加载），get 时注册必已完成。
 */

/** @type {{ runAgentLoop: Function } | null} */
let agentLoopEntry = null;
/** @type {string[] | null} */
let builtinToolNames = null;

function fail(message) {
  throw new Error(`[kernel-registry] ${message}`);
}

function registerAgentLoopEntry(entry) {
  if (!entry || typeof entry !== 'object') fail('registerAgentLoopEntry 需要 { runAgentLoop }');
  if (typeof entry.runAgentLoop !== 'function') fail('runAgentLoop 必须是函数');
  if (agentLoopEntry) fail('agent loop entry 重复注册（单一组合根纪律）');
  agentLoopEntry = entry;
}

function getAgentLoopEntry() {
  if (!agentLoopEntry) fail('agent loop entry 未注册（agent-runner 组合根尚未加载？）');
  return agentLoopEntry.runAgentLoop;
}

function registerBuiltinToolNames(names) {
  if (!Array.isArray(names)) fail('registerBuiltinToolNames 需要字符串数组');
  if (!names.every((name) => typeof name === 'string' && name.length > 0)) {
    fail('内置工具名单必须全为非空字符串');
  }
  if (builtinToolNames) fail('内置工具名单重复注册（单一来源纪律）');
  builtinToolNames = [...names];
}

function getBuiltinToolNames() {
  if (!builtinToolNames) fail('内置工具名单未注册（agent-tools/registry 尚未加载？）');
  return [...builtinToolNames];
}

/** 测试隔离用（生产代码不得调用）。 */
function __resetKernelRegistryForTest() {
  agentLoopEntry = null;
  builtinToolNames = null;
}

module.exports = {
  registerAgentLoopEntry,
  getAgentLoopEntry,
  registerBuiltinToolNames,
  getBuiltinToolNames,
  __resetKernelRegistryForTest,
};
