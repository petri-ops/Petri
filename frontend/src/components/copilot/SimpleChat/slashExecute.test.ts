/**
 * BLOCK-206 / C-29 — 斜杠命令决策层契约测（D15 的机械锚）。
 *
 * 钉三件事：①五个 UI 动作命令逐一对上；②skill:/template: 走模板注入族；
 * ③未知命令 = 收起面板（不静默无反应，也不误执行任何 UI 动作）。
 */
import { describe, expect, it } from 'vitest';
import { classifySlashCommand } from './slashExecute';

describe('classifySlashCommand', () => {
  it('UI 动作族逐一对上（与 SimpleChat 的 switch 分支一一对应）', () => {
    expect(classifySlashCommand('new')).toBe('new-conversation');
    expect(classifySlashCommand('clear')).toBe('clear-conversation');
    expect(classifySlashCommand('model')).toBe('toggle-model-menu');
    expect(classifySlashCommand('export')).toBe('export-markdown');
    expect(classifySlashCommand('compact')).toBe('compact-context');
    expect(classifySlashCommand('schedule')).toBe('schedule-task');
  });

  it('skill:/template: 前缀走模板注入（结构化 chip 属 v2，不在本包）', () => {
    expect(classifySlashCommand('skill:coding-playbook')).toBe('insert-template');
    expect(classifySlashCommand('template:weekly-report')).toBe('insert-template');
  });

  it('help 与未知命令 = 收起面板（不误执行 UI 动作）', () => {
    expect(classifySlashCommand('help')).toBe('dismiss-slash');
    expect(classifySlashCommand('nope')).toBe('dismiss-slash');
    expect(classifySlashCommand('')).toBe('dismiss-slash');
  });
});
