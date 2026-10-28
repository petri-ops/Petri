/**
 * BLOCK-206 / C-29 — 斜杠命令决策层契约测（D15 的机械锚）。
 *
 * 钉四件事：①五个 UI 动作命令逐一对上；②skill: 走结构化 chip（BLOCK-284 chip v2）、
 * template: 走模板注入；③未知命令 = 收起面板（不静默无反应，也不误执行任何 UI 动作）。
 */
import { describe, expect, it } from 'vitest';
import { classifySlashCommand } from './slashExecute';
import { buildSkillItem } from './contextSources';

describe('classifySlashCommand', () => {
  it('UI 动作族逐一对上（与 SimpleChat 的 switch 分支一一对应）', () => {
    expect(classifySlashCommand('new')).toBe('new-conversation');
    expect(classifySlashCommand('clear')).toBe('clear-conversation');
    expect(classifySlashCommand('model')).toBe('toggle-model-menu');
    expect(classifySlashCommand('export')).toBe('export-markdown');
    expect(classifySlashCommand('compact')).toBe('compact-context');
    expect(classifySlashCommand('schedule')).toBe('schedule-task');
  });

  it('BLOCK-284 chip v2 — skill: 走结构化 chip；template: 保持文本模板', () => {
    expect(classifySlashCommand('skill:coding-playbook')).toBe('add-skill-chip');
    expect(classifySlashCommand('template:weekly-report')).toBe('insert-template');
  });

  it('help 与未知命令 = 收起面板（不误执行 UI 动作）', () => {
    expect(classifySlashCommand('help')).toBe('dismiss-slash');
    expect(classifySlashCommand('nope')).toBe('dismiss-slash');
    expect(classifySlashCommand('')).toBe('dismiss-slash');
  });
});

describe('buildSkillItem（BLOCK-284 chip v2 单源构造器）', () => {
  it('与 @ 菜单 buildSkillCandidates 同形（id/dedupeKey/payload 契约一致）', () => {
    const item = buildSkillItem({ id: 'deg-analysis-standard', label: '标准差异分析', description: '从计数矩阵到火山图' });
    expect(item.id).toBe('ctx-skill-deg-analysis-standard');
    expect(item.kind).toBe('skill');
    expect(item.dedupeKey).toBe('skill|deg-analysis-standard');
    expect(item.payload).toEqual({ id: 'deg-analysis-standard' });
    expect(item.label).toBe('标准差异分析');
  });

  it('label/description 缺省兜底（label=id，说明空串）', () => {
    const item = buildSkillItem({ id: 'x' });
    expect(item.label).toBe('x');
    expect(item.lines.join('\n')).toContain('技能：x');
  });
});
