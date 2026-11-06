'use strict';

/**
 * BLOCK-360（NSO-W2-6）MCP registry 初始化降级账本（从 registry.js 拆出以守尺寸棘轮）。
 * 此前各初始化点 try/catch 仅 console.warn，listTools/callTool 照常宣称完整可用。
 * 关键组件（执行器/技能/插件/工具记录）缺失 → degraded；同步与可选面 → warning。
 * 懒加载组件后续成功时清除旧问题（瞬时失败不常驻）。
 *
 * 账本生命周期 = registry 模块实例生命周期（与拆分前一致；测试重载 registry 时不跨实例串味）。
 */
function createRegistryHealth() {
  const issues = { critical: new Map(), warnings: new Map() };

  function noteRegistryIssue(component, error, { critical = true } = {}) {
    const message = error && error.message ? error.message : String(error);
    const detail = `${component}: ${message}`;
    (critical ? issues.critical : issues.warnings).set(component, detail);
    console.warn(`[mcp-registry] ${critical ? '降级' : '警告'} ${detail}`);
  }

  function clearRegistryIssue(component) {
    issues.critical.delete(component);
    issues.warnings.delete(component);
  }

  function getRegistryHealth() {
    const reasons = [...issues.critical.values()].map((detail) => ({ detail }));
    return { degraded: reasons.length > 0, reasons, warnings: [...issues.warnings.values()] };
  }

  return { noteRegistryIssue, clearRegistryIssue, getRegistryHealth };
}

module.exports = { createRegistryHealth };
