/**
 * agent-tools/mcp-projection.js — MCP 工具投影进 agent 工具集（BLOCK-156 P3）
 *
 * 把已连接第三方 MCP server 的工具，按 `mcp_<server>_<tool>` 命名空间投影为
 * agent 可调用工具。投影是**动态层**：启动时静态注册表（buildToolRegistry
 * fail-fast 三方一致性）不感知 MCP 工具；getProviderToolDefs() 在请求时追加、
 * getToolEntry() 查表兜底——连接断开即消失，零连接=零投影（R1 护栏）。
 *
 * D4 裁决落地：统一 contract = category 'action' + sideEffect **'execution'** +
 * riskTier 'R2'。注意 external-request 不在 policy 的 MUTATING_SIDE_EFFECTS
 * 集合（既有 external-request 工具均为只读检索族）；MCP 工具是「调用外部进程
 * 执行」= execution 语义，由此获得 D4 意图的档位行为：read/plan 档禁、
 * workspace-write 白名单外禁、full 档可用、R3 才全局禁（R2 合法）。
 *
 * D6 裁决：MCP 工具不参与九域预路由收窄（narrowToolDefsByFamily 对未知名
 * 保守保留——「宁全勿缺」既有原则）；knowledge-console 白名单子集天然不含
 * mcp_* 名，自动排除。
 */

'use strict';

const manager = require('../mcp/client-manager');

/** 投影上限：防大量 server 连接把 provider prompt 撑爆（宁可少投影不撑爆）。 */
const MAX_PROJECTED_TOOLS = 40;

/** D4 统一 contract（与静态 contract 同构——policy/interceptor 直接消费）。 */
function mcpToolContract() {
  return {
    contractVersion: '1.0.0',
    category: 'action',
    sideEffect: 'execution',
    riskTier: 'R2',
    resources: ['mcp.server'],
    estimatedDurationMs: 60_000,
    notes: 'BLOCK-156 P3 projection: third-party MCP server tool (D4 uniform tier)',
  };
}

function sanitizeNamePart(part) {
  return String(part ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
}

function projectedToolName(serverId, toolName) {
  return `mcp_${sanitizeNamePart(serverId)}_${sanitizeNamePart(toolName)}`;
}

/** 从 manager 会话构建投影行（含重名消解：同 server 内 sanitize 后撞名去重）。 */
function _buildProjection() {
  const rows = [];
  const seen = new Set();
  for (const row of manager.getStatuses()) {
    if (row.status !== 'connected') continue;
    const toolsResult = manager.listServerTools(row.id);
    if (!toolsResult.ok) continue;
    for (const tool of toolsResult.tools) {
      if (!tool || typeof tool.name !== 'string' || !tool.name) continue;
      let name = projectedToolName(row.id, tool.name);
      if (seen.has(name)) continue; // sanitize 撞名去重（保留首个）
      seen.add(name);
      rows.push({ name, serverId: row.id, toolName: tool.name, tool });
      if (rows.length >= MAX_PROJECTED_TOOLS) return rows;
    }
  }
  return rows;
}

/** 投影为 provider 工具 defs（getProviderToolDefs 追加层）。 */
function projectMcpToolDefs() {
  return _buildProjection().map(({ name, serverId, tool }) => ({
    type: 'function',
    function: {
      name,
      description: `[MCP:${serverId}] ${tool.description || tool.name}`,
      parameters:
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema
          : { type: 'object', properties: {} },
    },
  }));
}

/** 按名查投影工具的执行 entry（registry.getToolEntry 兜底层）。 */
function getMcpToolEntry(name) {
  if (typeof name !== 'string' || !name.startsWith('mcp_')) return null;
  const row = _buildProjection().find((r) => r.name === name);
  if (!row) return null;
  return {
    definition: deepShape({
      type: 'function',
      function: {
        name: row.name,
        description: `[MCP:${row.serverId}] ${row.tool.description || row.tool.name}`,
        parameters:
          row.tool.inputSchema && typeof row.tool.inputSchema === 'object'
            ? row.tool.inputSchema
            : { type: 'object', properties: {} },
      },
    }),
    handler: async (args) => {
      const called = await manager.callServerTool(row.serverId, row.toolName, args ?? {});
      if (!called.ok) {
        return { ok: false, error: 'mcp_call_failed', message: called.error || 'unknown' };
      }
      const content = called.result && Array.isArray(called.result.content)
        ? called.result.content
        : [];
      const text = content
        .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
      const isError = !!(called.result && called.result.isError);
      return isError
        ? { ok: false, error: 'mcp_tool_error', message: text || 'MCP server returned isError' }
        : { ok: true, server: row.serverId, tool: row.toolName, text };
    },
    contract: mcpToolContract(),
  };
}

/** 当前投影数（测试/状态透出）。 */
function projectedToolCount() {
  return _buildProjection().length;
}

function deepShape(value) {
  // 轻量深拷贝（投影源是 SDK 会话缓存，避免共享引用被上层 mutate）
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  MAX_PROJECTED_TOOLS,
  projectedToolName,
  projectMcpToolDefs,
  getMcpToolEntry,
  projectedToolCount,
  mcpToolContract,
};
