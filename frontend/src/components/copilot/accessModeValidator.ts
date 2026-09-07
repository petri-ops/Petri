// ============================================================
// Access Mode Validator — enforces per-tier tool restrictions
// BLOCK-56 P2 — accessMode matrix ('full' | 'workspace-write' |
// 'plan' | 'read'; UI-303 把计划模式并入档位菜单成为第四档，plan 档
// 行为对齐 read + 仅额外放行 plan 工具，权威裁决仍在后端 Spec 门)。
// Mirrors the authoritative backend decision surface
// (core/biof3-server/agent-tools/agent-tool-policy.js
// decideAgentToolCall + workspace-tools preflight) so the frontend can
// surface a synchronous UI hint before network IO.
//
// Matrix (frontend alias → backend registry name):
//   fs_write / Write / StrReplace / Delete / EditNotebook → workspace_write
//   Shell / workspace_exec                                → workspace_exec
//   GitCommit / GitPush / GitBranch / GitMerge / GitRebase → git_* (IDE-side)
//   InstallPackage / UninstallPackage                     → npm / pip tools (IDE-side)
//
//   | surface                        | read | plan | workspace-write | full |
//   |--------------------------------|------|------|-----------------|------|
//   | read-only tools                | yes  | yes  | yes             | yes  |
//   | plan (Spec 门起草/修订)         | no   | yes  | yes             | yes  |
//   | workspace_write / _replace     | no   | no   | yes             | yes  |
//   | workspace_exec (foreground)    | no   | no   | yes             | yes  |
//   | workspace_exec_background      | no   | no   | no              | yes  |
//   | run_tool (plugin delegation)   | no   | no   | no              | yes  |
//   | git / package / IDE-side write | no   | no   | no              | yes  |
// ============================================================

import type { CopilotContext } from '@/lib/copilotContext';

/** Project-scoped writes — allowed in workspace-write tier (backend sandbox confines to project root). */
const PROJECT_WRITE_TOOLS = new Set([
  'workspace_write',
  'workspace_replace',
  // Frontend aliases that map to workspace_write
  'fs_write',
  'Write',
  'StrReplace',
  'Delete',
  'EditNotebook',
]);

/** Foreground command execution — allowed in workspace-write tier (blacklist + cwd-in-project enforced backend-side). */
const FOREGROUND_EXEC_TOOLS = new Set([
  'workspace_exec',
]);

/** Tools denied in read-only mode (everything with side effects). */
const DESTRUCTIVE_TOOLS = new Set<string>([
  ...PROJECT_WRITE_TOOLS,
  ...FOREGROUND_EXEC_TOOLS,
  // Shell / execution — matches backend sideEffect: 'execution'
  'workspace_exec_background',
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

/** UI-303 — 计划模式（Spec 门）唯一放行的写面：plan 工具本身（起草/修订计划）。 */
const PLAN_MODE_TOOLS = new Set(['plan']);

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

  // Project-write tier: project-scoped writes + foreground commands only
  if (accessMode === 'workspace-write') {
    return PROJECT_WRITE_TOOLS.has(toolName) || FOREGROUND_EXEC_TOOLS.has(toolName);
  }

  // Plan mode (Spec 门): read-only exploration + plan drafting only.
  // run_tool is op-discriminated backend-side (read-only ops pass there),
  // but the sync hint denies it so heavy-op acks never auto-approve while
  // planning (SimpleChat auto-approve gate queries exactly this tool).
  if (accessMode === 'plan') {
    return PLAN_MODE_TOOLS.has(toolName)
      || (!DESTRUCTIVE_TOOLS.has(toolName) && toolName !== 'run_tool');
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
export function getBlockedToolMessage(toolName: string, accessMode?: string): string {
  if (accessMode === 'plan') {
    return `工具 "${toolName}" 在计划模式下不可用：仅允许只读探索与计划起草（plan 工具），计划获批后自动恢复执行。`;
  }
  if (accessMode === 'workspace-write') {
    return `工具 "${toolName}" 超出项目写模式权限：仅允许项目内文件写入与前台命令；后台进程、插件执行与系统写操作需要切换到"完全访问"模式。`;
  }
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
    throw new Error(getBlockedToolMessage(toolName, context?.accessMode));
  }
}
