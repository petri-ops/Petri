/**
 * item88 第二波 HK-01：flag 关闭时聊天/工位渲染与 v1.0 逐字节等价。
 * 口径候选：docs/agent-workbench-enhancement-plan.md:692。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorkbenchFlagGate } from './WorkbenchFlagGate';

const BASELINE_V1 = '<div data-testid="wb-flag-gate" data-enabled="false">baseline</div>';

describe('item88 flag-off 快照', () => {
  it('HK-01 flag-off 渲染逐字节等于 v1.0 基线，不出现第二波节点', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchFlagGate enabled={false}>
        <div data-testid="workbench-approval-card">new</div>
      </WorkbenchFlagGate>,
    );
    expect(markup).toBe(BASELINE_V1);
    expect(markup).not.toContain('workbench-approval-card');
  });

  it('HK-01 AgentRunPanel 通过 gate 挂新组件（不裸接）', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'AgentRunPanel.tsx'), 'utf8');
    assertMatch(src, /WorkbenchFlagGate/);
    assertMatch(src, /WorkbenchApprovalCard/);
  });
});

function assertMatch(src: string, re: RegExp) {
  if (!re.test(src)) throw new Error(`AgentRunPanel 缺少接线：${re}`);
  expect(re.test(src)).toBe(true);
}
