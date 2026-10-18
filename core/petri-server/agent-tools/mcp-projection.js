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
const toolPolicy = require('../helpers/mcp-tool-policy');

/**
 * BLOCK-204（W5）— 投影上限现为**可配**（`mcp-tool-policy` 族的 `projectionLimit`）。
 * 保留常量仅作"注册表缺失时的兜底"，且它与基线冻结值（40）逐字相同。
 */
const MAX_PROJECTED_TOOLS = toolPolicy.DEFAULT_PROJECTION_LIMIT;


/** D4 统一 contract（与静态 contract 同构——policy/interceptor 直接消费）。
 * BLOCK-157 CAP-1 分级：tool.annotations.readOnlyHint === true 时投影为
 * retrieval/none/R1（只读检索族 → read/plan 档可用，与内置只读工具同待遇）；
 * 无注释/destructive 倾向保守维持 execution/R2（D4 默认零漂移）。 */
function mcpToolContract(tool, contractMode = 'auto') {
  // BLOCK-204（W5）— 逐工具 `contractMode` 覆盖只作用于**喂给既有四档判定的合同输入**：
  //  · read-only → 与 readOnlyHint=true 同形（read/plan 档可用）
  //  · mutating  → 与保守默认同形（execution/R2：read/plan 禁、write 档白名单外禁）
  //  · auto      → 逐字保留 BLOCK-157 CAP-1 的原推导（默认零漂移）
  if (contractMode === 'read-only') {
    return {
      contractVersion: '1.0.0',
      category: 'retrieval',
      sideEffect: 'none',
      riskTier: 'R1',
      resources: ['mcp.server'],
      estimatedDurationMs: 60_000,
      notes: 'BLOCK-204 W5: contractMode=read-only → read/plan 档可用（用户显式声明）',
    };
  }
  if (contractMode === 'mutating') {
    return {
      contractVersion: '1.0.0',
      category: 'action',
      sideEffect: 'execution',
      riskTier: 'R2',
      resources: ['mcp.server'],
      estimatedDurationMs: 60_000,
      notes: 'BLOCK-204 W5: contractMode=mutating → 保守档（read/plan 禁）',
    };
  }
  const annotations = tool && typeof tool === 'object' ? tool.annotations : null;
  if (annotations && annotations.readOnlyHint === true) {
    return {
      contractVersion: '1.0.0',
      category: 'retrieval',
      sideEffect: 'none',
      riskTier: 'R1',
      resources: ['mcp.server'],
      estimatedDurationMs: 60_000,
      notes: 'BLOCK-157 CAP-1: annotations.readOnlyHint=true → read/plan 档可用（只读检索族）',
    };
  }
  return {
    contractVersion: '1.0.0',
    category: 'action',
    sideEffect: 'execution',
    riskTier: 'R2',
    resources: ['mcp.server'],
    estimatedDurationMs: 60_000,
    notes: 'BLOCK-156 P3 projection: third-party MCP server tool（D4 保守默认；CAP-1 仅 readOnlyHint 降档）',
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
  const store = toolPolicy.readStore();
  const limit = toolPolicy.projectionLimit(store);
  for (const row of manager.getStatuses()) {
    if (row.status !== 'connected') continue;
    const toolsResult = manager.listServerTools(row.id);
    if (!toolsResult.ok) continue;
    for (const tool of toolsResult.tools) {
      if (!tool || typeof tool.name !== 'string' || !tool.name) continue;
      let name = projectedToolName(row.id, tool.name);
      if (seen.has(name)) continue; // sanitize 撞名去重（保留首个）
      seen.add(name);
      // BLOCK-204（W5）— 逐工具停用：不投影 ⇒ 模型工具面里根本看不到它
      const policy = toolPolicy.policyFor(name, store);
      if (!policy.enabled) continue;
      rows.push({ name, serverId: row.id, toolName: tool.name, tool, policy });
      if (rows.length >= limit) return rows;
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
  const policy = row.policy || toolPolicy.policyFor(row.name);
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
      // BLOCK-204（W5）— 逐工具超时：不配就走 client-manager 的 60s 缺省（行为不变）
      const called = await manager.callServerTool(row.serverId, row.toolName, args ?? {}, { timeoutMs: policy.timeoutMs });
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
    contract: mcpToolContract(row.tool, policy.contractMode),
  };
}

/** 当前会投影的工具名（写侧 unknown-tool 判定用；零连接=空集）。 */
function projectedToolNames() {
  return _buildProjection().map((row) => row.name);
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
  projectedToolNames,
  MAX_PROJECTED_TOOLS,
  projectedToolName,
  projectMcpToolDefs,
  getMcpToolEntry,
  projectedToolCount,
  mcpToolContract,
};
