// ============================================================
// Access Mode Validator — enforces read-only mode restrictions
// Validates tool calls against accessMode ('full' | 'read') to
// prevent destructive operations when user selects "只读模式".
// ============================================================

import type { CopilotContext } from '@/lib/copilotContext';

/**
 * Destructive tools (backend registry names) that should be blocked in
 * read-only mode.  The backend decideAgentToolCall() is the authoritative
 * enforcer (core/r-server/agent-tools/agent-tool-policy.js); this set
 * mirrors its MUTATING_SIDE_EFFECTS = { 'workspace-write', 'execution' }
 * so the frontend can surface a synchronous UI hint before network IO.
 *
 * Tool-name mapping (frontend alias → backend registry name):
 *   fs_write / Write / StrReplace / Delete / EditNotebook → workspace_write
 *   Shell / workspace_exec                          → workspace_exec
 *   GitCommit / GitPush / GitBranch / GitMerge / GitRebase → git_*
 *   InstallPackage / UninstallPackage               → npm / pip tools
 *
 * For `run_tool` (plugin delegation), the backend resolves `args.op`
 * against READ_ONLY_RUN_TOOL_OPS at decision time; the frontend cannot
 * know the op before network IO, so run_tool is treated as a passthrough
 * in 'full' mode and as potentially destructive in 'read' mode.
 */
const DESTRUCTIVE_TOOLS = new Set([
  // Workspace write / replace — matches backend sideEffect: 'workspace-write'
  'workspace_write',
  'workspace_replace',
  // Shell / execution — matches backend sideEffect: 'execution'
  'workspace_exec',
  'shell_exec',
  // Git write operations
  'git_commit',
  'git_push',
  'git_branch',
  'git_merge',
  'git_rebase',
  // Package management
  'npm_install',
  'npm_uninstall',
  'pip_install',
  'pip_uninstall',
]);

/**
 * Check if a tool call is allowed under the current access mode.
 * Returns true if allowed, false if blocked.
 */
export function isToolCallAllowed(
  toolName: string,
  context: CopilotContext | undefined
): boolean {
  const accessMode = context?.accessMode || 'full';
  
  // Full access mode allows everything
  if (accessMode === 'full') {
    return true;
  }
  
  // Read-only mode: block destructive tools
  if (accessMode === 'read') {
    return !DESTRUCTIVE_TOOLS.has(toolName);
  }
  
  // Unknown access mode: default to allowing
  return true;
}

/**
 * Get a user-friendly error message for blocked tool calls.
 */
export function getBlockedToolMessage(toolName: string): string {
  return `工具 "${toolName}" 需要完全访问权限。当前为只读模式，无法执行文件修改或命令操作。请切换到"完全访问"模式后重试。`;
}

/**
 * Validate a tool call and throw an error if not allowed.
 * Use this in the tool call pipeline to enforce access mode restrictions.
 */
export function validateToolCall(
  toolName: string,
  context: CopilotContext | undefined
): void {
  if (!isToolCallAllowed(toolName, context)) {
    throw new Error(getBlockedToolMessage(toolName));
  }
}
