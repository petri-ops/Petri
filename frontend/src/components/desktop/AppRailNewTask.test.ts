/**
 * 试用反馈迭代① HK-01（owner msg_771e9c3e974b）：「新建任务」不得静默塞进
 * allProjects[0]，应进带项目上下文的任务创建页（welcome：选/新建项目 + 输入发送才建会话）。
 * 纯函数锚点：resolveNewTaskNavigation —— 多项目无当前项目也去 welcome，零静默建会话。
 */
import { describe, expect, it } from 'vitest';
import { resolveNewTaskNavigation } from './AppRail';

describe('新建任务语义修正（试用反馈①）', () => {
  it('多项目且无当前项目 → 去 welcome 任务创建页，不静默选 allProjects[0]', () => {
    const r = resolveNewTaskNavigation({ currentProjectId: '', allProjects: [{ id: 'p1' }, { id: 'p2' }] });
    expect(r.target).toBe('/');
    expect(r.silentProjectId).toBeNull();
  });
  it('有当前项目 → 仍去 welcome（显式定上下文），不静默建会话', () => {
    const r = resolveNewTaskNavigation({ currentProjectId: 'p1', allProjects: [{ id: 'p1' }] });
    expect(r.target).toBe('/');
    expect(r.silentProjectId).toBeNull();
  });
  it('零项目 → 去 welcome 走诚实引导（无项目可承载时新建项目）', () => {
    const r = resolveNewTaskNavigation({ currentProjectId: '', allProjects: [] });
    expect(r.target).toBe('/');
    expect(r.silentProjectId).toBeNull();
  });
});
