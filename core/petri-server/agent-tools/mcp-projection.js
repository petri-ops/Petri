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
 * BLOCK-241（Q8）— 大目录懒加载：单 server 可用工具数超过阈值（默认 30）时，
 * 不再逐工具投影，而是投影两个合成工具：
 *   - `mcp_<server>__catalog`（R1/retrieval）：list / describe，只读、有界；
 *   - `mcp_<server>__call`（R2/execution）：按名代理调用，调用时**重新**读
 *     server/tool policy，投影快照不能成为放行依据。
 * 小目录（≤阈值）逐字保持原行为；策略在 call 时复核，blocked/disabled/unknown
 * 一律 tool_not_available。
 */

'use strict';

const manager = require('../mcp/client-manager');
const toolPolicy = require('../helpers/mcp-tool-policy');
const serverPolicy = require('../helpers/mcp-server-policy');

/**
 * BLOCK-204（W5）— 投影上限现为**可配**（`mcp-tool-policy` 族的 `projectionLimit`）。
 * 保留常量仅作"注册表缺失时的兜底"，且它与基线冻结值（40）逐字相同。
 */
const MAX_PROJECTED_TOOLS = toolPolicy.DEFAULT_PROJECTION_LIMIT;
/** BLOCK-241 — 大目录阈值（单 server 可用工具数 > 阈值 → catalog/call）。 */
const DEFAULT_CATALOG_THRESHOLD = 30;

function catalogThreshold() {
  const raw = Number(process.env.PETRI_MCP_CATALOG_THRESHOLD);
  return Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_CATALOG_THRESHOLD;
}

/** D4 统一 contract（与静态 contract 同构——policy/interceptor 直接消费）。
 * BLOCK-157 CAP-1 分级：tool.annotations.readOnlyHint === true 时投影为
 * retrieval/none/R1（只读检索族 → read/plan 档可用，与内置只读工具同待遇）；
 * BLOCK-240：destructive/openWorld 覆盖 readOnly 降档；idempotent 记录；
 * 无注释/destructive 倾向保守维持 execution/R2（D4 默认零漂移）。 */
function readMcpHints(tool) {
  const annotations = tool && typeof tool === 'object'
    && tool.annotations && typeof tool.annotations === 'object'
    ? tool.annotations
    : {};
  return {
    readOnly: annotations.readOnlyHint === true,
    destructive: annotations.destructiveHint === true,
    openWorld: annotations.openWorldHint === true,
    idempotent: annotations.idempotentHint === true,
  };
}

function activeHintNames(hints) {
  return [
    hints.readOnly ? 'readOnlyHint' : null,
    hints.destructive ? 'destructiveHint' : null,
    hints.openWorld ? 'openWorldHint' : null,
    hints.idempotent ? 'idempotentHint' : null,
  ].filter(Boolean);
}

function hintSuffix(hints) {
  const active = activeHintNames(hints);
  return active.length > 0 ? `；hints=[${active.join(',')}]` : '';
}

function mcpToolContract(tool, contractMode = 'auto') {
  // BLOCK-204（W5）— 逐工具 `contractMode` 覆盖只作用于**喂给既有四档判定的合同输入**：
  //  · read-only → 与 readOnlyHint=true 同形（read/plan 档可用）
  //  · mutating  → 与保守默认同形（execution/R2：read/plan 禁、write 档白名单外禁）
  //  · auto      → 逐字保留 BLOCK-157 CAP-1 的原推导（默认零漂移）
  // BLOCK-240（Q8）— 四 hint 进合同：destructive/openWorld 覆盖 readOnly 降档；
  // idempotent 只记录，不改变风险档。显式 contractMode 仍是用户声明，优先于 hint。
  const hints = readMcpHints(tool);
  if (contractMode === 'read-only') {
    return {
      contractVersion: '1.0.0',
      category: 'retrieval',
      sideEffect: 'none',
      riskTier: 'R1',
      resources: ['mcp.server'],
      estimatedDurationMs: 60_000,
      hints,
      notes: 'BLOCK-204 W5: contractMode=read-only → read/plan 档可用（用户显式声明）' + hintSuffix(hints),
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
      hints,
      notes: 'BLOCK-204 W5: contractMode=mutating → 保守档（read/plan 禁）' + hintSuffix(hints),
    };
  }
  if (hints.destructive || hints.openWorld) {
    const reason = hints.destructive && hints.readOnly
      ? 'BLOCK-240: destructiveHint=true overrides readOnlyHint=true → R2/execution（保守）'
      : hints.destructive
        ? 'BLOCK-240: destructiveHint=true → R2/execution（保守）'
        : 'BLOCK-240: openWorldHint=true → R2/execution（开放世界保守）';
    return {
      contractVersion: '1.0.0',
      category: 'action',
      sideEffect: 'execution',
      riskTier: 'R2',
      resources: ['mcp.server'],
      estimatedDurationMs: 60_000,
      hints,
      notes: reason + (hints.idempotent ? '；idempotentHint=true（记录，不改变风险档）' : ''),
    };
  }
  if (hints.readOnly) {
    return {
      contractVersion: '1.0.0',
      category: 'retrieval',
      sideEffect: 'none',
      riskTier: 'R1',
      resources: ['mcp.server'],
      estimatedDurationMs: 60_000,
      hints,
      notes: 'BLOCK-157 CAP-1: annotations.readOnlyHint=true → read/plan 档可用（只读检索族）'
        + (hints.idempotent ? '；idempotentHint=true（记录，不改变风险档）' : ''),
    };
  }
  return {
    contractVersion: '1.0.0',
    category: 'action',
    sideEffect: 'execution',
    riskTier: 'R2',
    resources: ['mcp.server'],
    estimatedDurationMs: 60_000,
    hints,
    notes: 'BLOCK-156 P3 projection: third-party MCP server tool（D4 保守默认）'
      + (hints.idempotent ? '；idempotentHint=true（记录，不改变风险档）' : ''),
  };
}

function sanitizeNamePart(part) {
  return String(part ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
}

function projectedToolName(serverId, toolName) {
  return `mcp_${sanitizeNamePart(serverId)}_${sanitizeNamePart(toolName)}`;
}

/** 当前策略下该 server 可用的工具（投影名/原名/策略/工具对象）。 */
function _allowedToolsForServer(serverId, store, serverStore) {
  const toolsResult = manager.listServerTools(serverId);
  if (!toolsResult.ok) return [];
  const seen = new Set();
  const allowed = [];
  for (const tool of toolsResult.tools) {
    if (!tool || typeof tool.name !== 'string' || !tool.name) continue;
    const name = projectedToolName(serverId, tool.name);
    if (seen.has(name)) continue; // sanitize 撞名去重（保留首个）
    seen.add(name);
    // BLOCK-204（W5）— 逐工具停用：不投影 ⇒ 模型工具面里根本看不到它
    const policy = toolPolicy.policyFor(name, store);
    if (!policy.enabled) continue;
    // BLOCK-221（Q8）— 服务级 allow/block：block 优先、allow 非空即白名单
    if (!serverPolicy.evaluateTool(serverId, tool.name, serverStore).allowed) continue;
    allowed.push({ name, rawToolName: tool.name, tool, policy });
  }
  return allowed;
}

/** 从 manager 会话构建投影行。kind=direct/catalog/call。 */
function _buildProjection() {
  const rows = [];
  const seen = new Set();
  const store = toolPolicy.readStore();
  const serverStore = serverPolicy.readStore();
  const limit = toolPolicy.projectionLimit(store);
  const threshold = catalogThreshold();

  for (const statusRow of manager.getStatuses()) {
    if (statusRow.status !== 'connected') continue;
    const allowed = _allowedToolsForServer(statusRow.id, store, serverStore);
    if (allowed.length === 0) continue;

    const catalogName = projectedToolName(statusRow.id, '_catalog');
    const callName = projectedToolName(statusRow.id, '_call');
    // 真实工具若恰好占用保留段，回退逐工具投影（宁可截断，不 shadow 真工具）
    const collision = allowed.some((entry) => entry.name === catalogName || entry.name === callName);
    const useCatalog = allowed.length > threshold && limit >= 2 && !collision;
    if (useCatalog) {
      if (seen.has(catalogName) || seen.has(callName)) continue;
      seen.add(catalogName);
      seen.add(callName);
      rows.push({ name: catalogName, serverId: statusRow.id, kind: 'catalog', catalogTools: allowed });
      rows.push({ name: callName, serverId: statusRow.id, kind: 'call', catalogTools: allowed });
    } else {
      for (const entry of allowed) {
        if (seen.has(entry.name)) continue;
        seen.add(entry.name);
        rows.push({
          name: entry.name,
          serverId: statusRow.id,
          kind: 'direct',
          toolName: entry.rawToolName,
          tool: entry.tool,
          policy: entry.policy,
        });
      }
    }
    if (rows.length >= limit) return rows.slice(0, limit);
  }
  return rows;
}

function _catalogDefinition(serverId, count) {
  const callName = projectedToolName(serverId, '_call');
  return {
    type: 'function',
    function: {
      name: projectedToolName(serverId, '_catalog'),
      description: `[MCP:${serverId}] 工具目录（${count} 个可用工具）：action=list 列出/搜索工具，action=describe 查看指定工具的 inputSchema。只读；调用工具请用 ${callName}。`,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'describe'] },
          tool: { type: 'string', description: '工具名（describe 必填）' },
          query: { type: 'string', description: 'list 的可选子串过滤（工具名/描述）' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'list 返回上限（默认 50）' },
          offset: { type: 'integer', minimum: 0, maximum: 10000, description: 'list 偏移（默认 0）' },
        },
        required: ['action'],
      },
    },
  };
}

function _callDefinition(serverId) {
  return {
    type: 'function',
    function: {
      name: projectedToolName(serverId, '_call'),
      description: `[MCP:${serverId}] 调用目录中的工具：先用 ${projectedToolName(serverId, '_catalog')} list/describe 取工具名与 schema，再传 tool + arguments。调用前会复核服务级/逐工具策略。`,
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'catalog list 返回的原始工具名' },
          arguments: { type: 'object', additionalProperties: true, description: '目标工具的入参' },
        },
        required: ['tool'],
      },
    },
  };
}

function _catalogContract() {
  return {
    contractVersion: '1.0.0',
    category: 'retrieval',
    sideEffect: 'none',
    riskTier: 'R1',
    resources: ['mcp.server'],
    estimatedDurationMs: 60_000,
    hints: { readOnly: true, destructive: false, openWorld: false, idempotent: true },
    notes: 'BLOCK-241 catalog: list/describe only; 只读目录，不执行工具；目标工具策略在 call 时复核。',
  };
}

function _callContract(mcpApproval = null) {
  return {
    contractVersion: '1.0.0',
    category: 'action',
    sideEffect: 'execution',
    riskTier: 'R2',
    resources: ['mcp.server'],
    estimatedDurationMs: 60_000,
    hints: { readOnly: false, destructive: false, openWorld: true, idempotent: false },
    ...(mcpApproval ? { mcpApproval } : {}),
    notes: 'BLOCK-241 catalog proxy: target tool policies rechecked at call time; conservative R2/execution.',
  };
}

/** 真实 MCP 调用 → 统一结果（direct 与 catalog call 共用）。 */
async function _callServerToolResult(serverId, toolName, args, timeoutMs) {
  const called = await manager.callServerTool(serverId, toolName, args ?? {}, { timeoutMs });
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
    : { ok: true, server: serverId, tool: toolName, text };
}

/** catalog：只读 list/describe；每次调用重新读策略，不泄露 blocked/disabled。 */
async function _catalogHandler(serverId, args) {
  const toolsResult = manager.listServerTools(serverId);
  if (!toolsResult.ok) return { ok: false, error: 'server_not_connected' };
  const store = toolPolicy.readStore();
  const serverStore = serverPolicy.readStore();
  const allowed = _allowedToolsForServer(serverId, store, serverStore);
  const action = String((args && args.action) || '').trim();

  if (action === 'list') {
    const query = String((args && args.query) || '').trim().toLowerCase();
    const rawLimit = Number(args && args.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
    const rawOffset = Number(args && args.offset);
    const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const filtered = query
      ? allowed.filter((entry) => (
        entry.rawToolName.toLowerCase().includes(query)
        || String(entry.tool.description || '').toLowerCase().includes(query)
      ))
      : allowed;
    const page = filtered.slice(offset, offset + limit);
    return {
      ok: true,
      server: serverId,
      action: 'list',
      total: filtered.length,
      offset,
      limit,
      hasMore: offset + page.length < filtered.length,
      tools: page.map((entry) => ({
        name: entry.rawToolName,
        description: String(entry.tool.description || '').slice(0, 300),
        hints: readMcpHints(entry.tool),
      })),
    };
  }

  if (action === 'describe') {
    const toolName = String((args && args.tool) || '').trim();
    if (!toolName) return { ok: false, error: 'tool_required' };
    const entry = allowed.find((item) => item.rawToolName === toolName);
    if (!entry) return { ok: false, error: 'tool_not_available' };
    return {
      ok: true,
      server: serverId,
      action: 'describe',
      tool: toolName,
      description: String(entry.tool.description || '').slice(0, 1000),
      inputSchema: entry.tool.inputSchema && typeof entry.tool.inputSchema === 'object'
        ? entry.tool.inputSchema
        : { type: 'object', properties: {} },
      hints: readMcpHints(entry.tool),
    };
  }

  return { ok: false, error: 'invalid_action', message: 'action 必须是 list 或 describe。' };
}

/** call：按原始工具名代理；调用时重新读策略 + 用逐工具 timeout。 */
async function _callHandler(serverId, args) {
  const toolName = String((args && args.tool) || '').trim();
  if (!toolName) return { ok: false, error: 'tool_required' };
  const rawArgs = args && args.arguments;
  if (rawArgs !== undefined && (rawArgs === null || typeof rawArgs !== 'object' || Array.isArray(rawArgs))) {
    return { ok: false, error: 'arguments_invalid', message: 'arguments 必须是对象。' };
  }
  const toolsResult = manager.listServerTools(serverId);
  if (!toolsResult.ok) return { ok: false, error: 'server_not_connected' };
  const store = toolPolicy.readStore();
  const serverStore = serverPolicy.readStore();
  const entry = _allowedToolsForServer(serverId, store, serverStore)
    .find((item) => item.rawToolName === toolName);
  if (!entry) return { ok: false, error: 'tool_not_available' };

  const result = await _callServerToolResult(serverId, toolName, rawArgs ?? {}, entry.policy.timeoutMs);
  return result.ok ? { ...result, catalog: true } : result;
}

/** BLOCK-221 — 每个 server 的**生效**投影工具数（治理可见面用，不含限流截断后的猜测）。 */
function projectedCountByServer() {
  const counts = {};
  for (const row of _buildProjection()) {
    counts[row.serverId] = (counts[row.serverId] || 0) + 1;
  }
  return counts;
}

/** BLOCK-241 — 目录模式摘要（UI/状态面解释「生效 2 / 已连接 N」）。 */
function catalogModeByServer() {
  const modes = {};
  for (const row of _buildProjection()) {
    if (row.kind === 'catalog') {
      modes[row.serverId] = { mode: 'catalog', total: row.catalogTools.length };
    }
  }
  return modes;
}

/** 投影为 provider 工具 defs（getProviderToolDefs 追加层）。 */
function projectMcpToolDefs() {
  return _buildProjection().map((row) => {
    if (row.kind === 'catalog') return _catalogDefinition(row.serverId, row.catalogTools.length);
    if (row.kind === 'call') return _callDefinition(row.serverId);
    return {
      type: 'function',
      function: {
        name: row.name,
        description: `[MCP:${row.serverId}] ${row.tool.description || row.tool.name}`,
        parameters:
          row.tool.inputSchema && typeof row.tool.inputSchema === 'object'
            ? row.tool.inputSchema
            : { type: 'object', properties: {} },
      },
    };
  });
}

/** 按名查投影工具的执行 entry（registry.getToolEntry 兜底层）。 */
function getMcpToolEntry(name) {
  if (typeof name !== 'string' || !name.startsWith('mcp_')) return null;
  const row = _buildProjection().find((r) => r.name === name);
  if (!row) return null;

  if (row.kind === 'catalog') {
    return {
      definition: deepShape(_catalogDefinition(row.serverId, row.catalogTools.length)),
      handler: async (args) => _catalogHandler(row.serverId, args),
      contract: _catalogContract(),
    };
  }
  if (row.kind === 'call') {
    // BLOCK-243 — 目录代理无法静态知道目标 hint：只要目录含 destructive 工具就
    // 保守附审批元数据（trust ask 时由 policy 要求确认）。
    const hasDestructive = row.catalogTools.some((entry) => readMcpHints(entry.tool).destructive);
    return {
      definition: deepShape(_callDefinition(row.serverId)),
      handler: async (args) => _callHandler(row.serverId, args),
      contract: _callContract(hasDestructive ? { serverId: row.serverId, destructive: true } : null),
    };
  }

  const policy = row.policy || toolPolicy.policyFor(row.name);
  const hints = readMcpHints(row.tool);
  const contract = mcpToolContract(row.tool, policy.contractMode);
  if (hints.destructive) contract.mcpApproval = { serverId: row.serverId, destructive: true };
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
    handler: async (args) => _callServerToolResult(row.serverId, row.toolName, args ?? {}, policy.timeoutMs),
    contract,
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
  projectedCountByServer,
  catalogModeByServer,
  mcpToolContract,
};
