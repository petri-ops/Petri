'use strict';

/**
 * core/petri-server/mcp/ide-tools/contracts.js — BLOCK-346 T5 追加。
 *
 * 背景：IDE MCP 的 18 个 `ide_*` 工具此前**没有契约/元数据条目**，也不经
 * `agent-tool-policy.decideAgentToolCall`，只有各自零散的 `confirm` 布尔——
 * 等于在统一审批轴之外开了第二套更弱的安全模型（审计可见性缺位）。
 *
 * 本次先补**契约单源**（本文件），并在 dispatch 层对高风险写操作统一强制
 * `confirm=true`。档位接入（accessMode）留 reopen：MCP 的调用方是外部 IDE
 * （Cursor / VSCode 插件），没有 Petri 侧的 accessMode 会话概念，硬接会产生
 * 「外部 IDE 永远被拒」的假门。
 *
 * confirmPolicy 语义：
 *   'always'    —— 每次调用都必须显式 confirm=true
 *   'overwrite' —— 仅覆盖已有目标时必须 confirm=true（保留原有细粒度语义）
 *   false       —— 不需 confirm（只读或幂等创建）
 */

const IDE_TOOL_CONTRACTS = Object.freeze({
  // ---- 写：工作区文件 ----
  ide_file_write: { sideEffect: 'workspace-write', riskTier: 'R2', destructive: false, confirmPolicy: 'overwrite' },
  ide_file_create: { sideEffect: 'workspace-write', riskTier: 'R2', destructive: false, confirmPolicy: false },
  ide_file_delete: { sideEffect: 'workspace-write', riskTier: 'R2', destructive: true, confirmPolicy: 'always' },
  ide_file_rename: { sideEffect: 'workspace-write', riskTier: 'R2', destructive: false, confirmPolicy: 'overwrite' },
  // ---- 写：终端 ----
  ide_terminal_create: { sideEffect: 'execution', riskTier: 'R1', destructive: false, confirmPolicy: false },
  ide_terminal_write: { sideEffect: 'execution', riskTier: 'R2', destructive: false, confirmPolicy: 'always' },
  ide_terminal_close: { sideEffect: 'execution', riskTier: 'R1', destructive: false, confirmPolicy: false },
  // ---- 只读：文件 / 终端 / 检索 / 差异 / git ----
  ide_file_read: { sideEffect: 'none', riskTier: 'R0', destructive: false, confirmPolicy: false },
  ide_file_exists: { sideEffect: 'none', riskTier: 'R0', destructive: false, confirmPolicy: false },
  ide_file_list: { sideEffect: 'none', riskTier: 'R0', destructive: false, confirmPolicy: false },
  ide_terminal_read: { sideEffect: 'none', riskTier: 'R0', destructive: false, confirmPolicy: false },
  ide_terminal_list: { sideEffect: 'none', riskTier: 'R0', destructive: false, confirmPolicy: false },
  ide_file_search_text: { sideEffect: 'none', riskTier: 'R0', destructive: false, confirmPolicy: false },
  ide_file_diff: { sideEffect: 'none', riskTier: 'R0', destructive: false, confirmPolicy: false },
  ide_git_diff: { sideEffect: 'none', riskTier: 'R0', destructive: false, confirmPolicy: false },
  ide_git_log: { sideEffect: 'none', riskTier: 'R0', destructive: false, confirmPolicy: false },
  ide_git_show: { sideEffect: 'none', riskTier: 'R0', destructive: false, confirmPolicy: false },
  ide_git_blame: { sideEffect: 'none', riskTier: 'R0', destructive: false, confirmPolicy: false },
});

/** 写类工具（sideEffect !== 'none'）——供审计/门禁判定。 */
const IDE_WRITE_TOOLS = Object.freeze(
  Object.keys(IDE_TOOL_CONTRACTS).filter((n) => IDE_TOOL_CONTRACTS[n].sideEffect !== 'none'),
);

/**
 * dispatch 层统一 confirm 闸：仅拦 `confirmPolicy === 'always'`。
 * 'overwrite' 的细粒度判定保留在各 handler 内部（需先探测目标是否存在）。
 */
function checkConfirm(name, args) {
  const contract = IDE_TOOL_CONTRACTS[name];
  if (!contract || contract.confirmPolicy !== 'always') return null;
  if (args && args.confirm === true) return null;
  return {
    ok: false,
    error: 'confirm_required',
    toolId: name,
    sideEffect: contract.sideEffect,
    message: `${name} 属${contract.sideEffect === 'execution' ? '执行' : '写入'}类操作，需显式 confirm=true`,
  };
}

module.exports = { IDE_TOOL_CONTRACTS, IDE_WRITE_TOOLS, checkConfirm };
