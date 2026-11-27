/** item89 attempt2 HK-01：会话列表真实点击路径（非命令面板）必须带项目上下文。 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

describe('item89 跨项目会话点击链', () => {
  it('HK-01 AppRailContext 种子消费 preselect，并提供跨项目切换入口', () => {
    const ctx = read('AppRailContext.tsx');
    expect(ctx).toContain('consumeConversationPreselect');
    expect(ctx).toContain('resolveActiveConversationId');
    expect(ctx).toContain('switchConversationInProject');
  });

  it('HK-01 LeftPanel 三处跨项目点击改走 switchConversationInProject，不再先设旧 activeConvId', () => {
    const left = read('../workspace-panels/LeftPanel.tsx');
    const occurrences = left.match(/switchConversationInProject\(/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });
});
