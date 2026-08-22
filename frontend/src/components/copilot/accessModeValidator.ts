// ============================================================
// Access Mode Validator — enforces read-only mode restrictions
// Validates tool calls against accessMode ('full' | 'read') to
// prevent destructive operations when user selects "只读模式".
// ============================================================

import type { CopilotContext } from '@/lib/copilotContext';

/**
 * Destructive tools that should be blocked in read-only mode.
 * These tools can modify files, execute commands, or alter system state.
 */
const DESTRUCTIVE_TOOLS = new Set([
  // File modifications
  'fs_write',
  'StrReplace',
  'Delete',
  'EditNotebook',
  'Write',
  
  // Command execution
  'Shell',
  
  // Version control write operations
  'GitCommit',
  'GitPush',
  'GitBranch',
  'GitMerge',
  'GitRebase',
  
  // Package/dependency management
  'InstallPackage',
  'UninstallPackage',
  
  // Other destructive operations
  'Task', // Tasks may contain destructive operations
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
