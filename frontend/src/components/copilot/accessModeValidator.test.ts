// BLOCK-56 P2 — accessModeValidator 三档矩阵（前端同步层）。
// 后端 decideAgentToolCall 是权威裁决者；本测试保证前端镜像矩阵不漂移。
import { describe, expect, it } from 'vitest';
import { getBlockedToolMessage, isToolCallAllowed } from './accessModeValidator';
import type { CopilotContext } from '@/lib/copilotContext';

const ctx = (accessMode?: CopilotContext['accessMode']): CopilotContext | undefined =>
  accessMode ? ({ accessMode } as CopilotContext) : undefined;

describe('accessModeValidator BLOCK-56 P2 三档矩阵', () => {
  it('full 档放行一切', () => {
    for (const tool of ['workspace_write', 'workspace_exec', 'workspace_exec_background', 'git_commit', 'run_tool', 'workspace_read']) {
      expect(isToolCallAllowed(tool, ctx('full'))).toBe(true);
    }
  });

  it('workspace-write 档放行项目写 + 前台命令，拒绝其余写面', () => {
    for (const tool of ['workspace_write', 'workspace_replace', 'workspace_exec', 'fs_write', 'Write']) {
      expect(isToolCallAllowed(tool, ctx('workspace-write'))).toBe(true);
    }
    for (const tool of ['workspace_exec_background', 'shell_exec', 'git_commit', 'git_push', 'npm_install', 'pip_install']) {
      expect(isToolCallAllowed(tool, ctx('workspace-write'))).toBe(false);
    }
  });

  it('read 档拒绝破坏性工具、放行只读（零回归）', () => {
    for (const tool of ['workspace_write', 'workspace_exec', 'git_commit', 'npm_install']) {
      expect(isToolCallAllowed(tool, ctx('read'))).toBe(false);
    }
    for (const tool of ['workspace_read', 'workspace_list', 'run_tool']) {
      expect(isToolCallAllowed(tool, ctx('read'))).toBe(true);
    }
  });

  // UI-303 — 计划模式并入档位菜单第四档：plan 档 = 只读探索 + 仅放行 plan 工具
  it('plan 档放行只读探索与 plan 工具，拒绝一切写面', () => {
    for (const tool of ['workspace_read', 'workspace_list', 'plan']) {
      expect(isToolCallAllowed(tool, ctx('plan'))).toBe(true);
    }
    for (const tool of ['workspace_write', 'workspace_replace', 'workspace_exec', 'workspace_exec_background', 'shell_exec', 'git_commit', 'npm_install', 'run_tool']) {
      expect(isToolCallAllowed(tool, ctx('plan'))).toBe(false);
    }
  });

  it('未知档位默认放行；错误信息按档位区分', () => {
    expect(isToolCallAllowed('workspace_write', ctx(undefined))).toBe(true);
    expect(getBlockedToolMessage('git_commit', 'workspace-write')).toContain('项目写模式');
    expect(getBlockedToolMessage('git_commit', 'plan')).toContain('计划模式');
    expect(getBlockedToolMessage('git_commit', 'read')).toContain('只读模式');
  });
});
