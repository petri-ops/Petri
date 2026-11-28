// item 88 polish ① HK-01——/overview 全局页项目上下文只读派生。
import { describe, expect, it } from 'vitest';
import { resolveOverviewProjectRef } from './overview';

const project = (id: string, name: string) => ({ id, name, createdAt: '', updatedAt: '' });
const conv = (id: string, projectId: string | null) => ({ id, project_id: projectId });

describe('overview 项目上下文派生（item88 polish ①）', () => {
  it('HK-88p-3：路由项目优先，映射项目名（不展示裸 id）', () => {
    const result = resolveOverviewProjectRef({
      routeProjectId: 'p1',
      activeConvId: 'c2',
      conversations: [conv('c2', 'p2')] as never,
      projects: [project('p1', 'Alpha'), project('p2', 'Beta')] as never,
    });
    expect(result).toEqual({ projectId: 'p1', projectName: 'Alpha' });
  });

  it('HK-88p-4：全局页无路由项目 → 从激活会话派生所属项目', () => {
    const result = resolveOverviewProjectRef({
      routeProjectId: null,
      activeConvId: 'c2',
      conversations: [conv('c1', 'p1'), conv('c2', 'p2')] as never,
      projects: [project('p1', 'Alpha'), project('p2', 'Beta')] as never,
    });
    expect(result).toEqual({ projectId: 'p2', projectName: 'Beta' });
  });

  it('HK-88p-5：无路由项目且会话未归属 → 诚实空，不猜项目', () => {
    const result = resolveOverviewProjectRef({
      routeProjectId: null,
      activeConvId: 'c0',
      conversations: [conv('c0', null)] as never,
      projects: [project('p1', 'Alpha')] as never,
    });
    expect(result).toEqual({ projectId: null, projectName: null });
  });
});
