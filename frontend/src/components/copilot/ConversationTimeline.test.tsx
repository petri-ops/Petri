import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ConversationSegment } from './conversationSegments';
import { ConversationTimeline } from './ConversationTimeline';

const reasoningSegment: ConversationSegment = {
  kind: 'reasoning',
  iteration: 2,
  text: '先确认一下这个函数在哪被调用\n第二行细节',
  preview: '先确认一下这个函数在哪被调用',
};

const toolsSegment: ConversationSegment = {
  kind: 'tools',
  iteration: 2,
  activities: [{
    key: 'call-1',
    name: 'workspace_read',
    status: 'success',
    actionLabel: '已读取',
    actionDetail: 'src/a.ts',
    iteration: 2,
    durationMs: 12,
  }],
  groups: [],
  totalCount: 1,
  failedCount: 0,
  runningCount: 0,
  durationMs: 12,
  state: 'settled',
};

const narrativeSegment: ConversationSegment = { kind: 'narrative', text: '最终正文' };
const progressSegment: ConversationSegment = { kind: 'progress', iteration: 2, content: '已经读完关键文件' };

describe('BLOCK-107 会话时间线渲染（P1b）', () => {
  it('UI-437 v4 运行级折叠：完成后整段任务收成一行运行摘要（叙述/思考/明细都收在里面）', () => {
    const { container } = render(
      <ConversationTimeline segments={[reasoningSegment, toolsSegment, narrativeSegment]} />
    );
    // 折叠态 = 一行运行摘要；思考与明细都收在里面，narrative 仍交由宿主渲染
    expect(container.textContent).toContain('执行工具 1 次 · 1 轮');
    expect(container.textContent).not.toContain('最终正文');
    expect(container.querySelector('.sc-timeline-reasoning')).toBeNull();
    expect(container.textContent).not.toContain('先确认一下这个函数在哪被调用');

    // 点运行摘要 → 展开：思考节点 + 簇明细（forceOpen 行常驻，无内层簇头）
    fireEvent.click(within(container).getByRole('button', { name: '展开执行过程' }));
    expect(within(container).getByText('思考')).toBeTruthy();
    expect(container.querySelectorAll('.sc-tool-qoder-row').length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).not.toContain('最终正文');
  });

  it('运行摘要行携带聚合信息：调用次数 / 轮次 / 耗时', () => {
    const { container } = render(<ConversationTimeline segments={[toolsSegment]} />);
    const line = within(container).getByRole('button', { name: '展开执行过程' }).textContent || '';
    expect(line).toContain('执行工具 1 次');
    expect(line).toContain('1 轮');
    expect(line).toContain('12 ms');
  });

  it('展开后内层簇由 forceOpen 托管：无簇头摘要、行常驻（UI-430 单工具信息在行上）', () => {
    const { container } = render(<ConversationTimeline segments={[toolsSegment]} />);
    fireEvent.click(within(container).getByRole('button', { name: '展开执行过程' }));
    // 行常驻且无内层簇头摘要（总结味下线；聚合信息只在运行摘要行）
    expect(container.querySelector('[data-testid="qoder-cluster-body"]')).toBeTruthy();
    expect(container.querySelector('.sc-tool-activity-summary')).toBeNull();
    expect(container.querySelectorAll('.sc-tool-qoder-row').length).toBe(1);
    expect(container.textContent).toContain('src/a.ts');
  });

  it('UI-437 v5.6：思考节点与工具行同款骨架（brain 图标行 + 短预览，点击展开全文）', () => {
    const { container } = render(<ConversationTimeline segments={[toolsSegment, reasoningSegment]} />);
    fireEvent.click(within(container).getByRole('button', { name: '展开执行过程' }));
    // 短预览单行省略（64 字截断 + CSS ellipsis），不与正文混淆
    expect(container.querySelector('.sc-timeline-reasoning-preview')?.textContent)
      .toBe('先确认一下这个函数在哪被调用');
    fireEvent.click(within(container).getByRole('button', { name: '展开思考' }));
    expect(container.querySelector('.sc-tool-reasoning-text')?.textContent)
      .toContain('第二行细节');
    expect(container.querySelector('.sc-timeline-reasoning-preview')).toBeNull();
  });

  it('progress 分段默认跳过（宿主仍在别处渲染阶段进度时不重复展示）', () => {
    const { container } = render(<ConversationTimeline segments={[progressSegment]} />);
    expect(container.firstChild).toBeNull();
  });

  it('传入 renderProgress 时按输入顺序渲染（展开后：簇前/簇后由段模型排序，BLOCK-108 起簇前）', () => {
    const { container } = render(
      <ConversationTimeline
        segments={[toolsSegment, progressSegment]}
        renderProgress={(segment) => <span>{segment.content}</span>}
      />
    );
    // 有工具段 → 默认折叠，先展开再断言顺序
    fireEvent.click(within(container).getByRole('button', { name: '展开执行过程' }));
    const html = container.innerHTML;
    expect(within(container).getByText('已经读完关键文件')).toBeTruthy();
    expect(html.indexOf('src/a.ts')).toBeLessThan(html.indexOf('已经读完关键文件'));
  });

  it('renderProgress 拿到 isFirst / isLast，容器为过渡叙述排版（BLOCK-108 取代 D5+UI-305 弱化进度行，plan §7.2）', () => {
    const intention: ConversationSegment = { kind: 'progress', iteration: 1, content: '打算先读文件' };
    const metas: Array<{ isFirst: boolean; isLast: boolean }> = [];
    const { container } = render(
      <ConversationTimeline
        segments={[intention, toolsSegment, progressSegment]}
        renderProgress={(segment, meta) => {
          metas.push(meta);
          return <span>{segment.content}</span>;
        }}
      />
    );
    fireEvent.click(within(container).getByRole('button', { name: '展开执行过程' }));
    // 折叠态不渲染 progress（renderProgress 不被调用）；展开后每个分段各调用一次
    // （点击引发的重渲染会重复累计，故取末两位=最新一次展开的调用结果）
    expect(metas.slice(-2)).toEqual([
      { isFirst: true, isLast: false },
      { isFirst: false, isLast: true },
    ]);
    expect(container.querySelector('.sc-timeline-transition')).toBeTruthy();
    expect(container.querySelector('.sc-agent-progress')).toBeNull();
  });

  it('renderProgress 返回 null 的分段不产出节点（首条=意图被宿主省略时不留空壳）', () => {
    const intention: ConversationSegment = { kind: 'progress', iteration: 1, content: '打算先读文件' };
    const { container } = render(
      <ConversationTimeline
        segments={[intention, toolsSegment]}
        renderProgress={(segment, meta) => (meta.isFirst ? null : <span>{segment.content}</span>)}
      />
    );
    fireEvent.click(within(container).getByRole('button', { name: '展开执行过程' }));
    expect(container.querySelector('.sc-timeline-progress')).toBeNull();
    expect(container.querySelector('.sc-timeline-cluster')).toBeTruthy();
  });

  it('仅 narrative 时返回 null（纯文本回答零额外 DOM）', () => {
    const { container } = render(<ConversationTimeline segments={[narrativeSegment]} />);
    expect(container.firstChild).toBeNull();
  });

  it('空分段数组返回 null', () => {
    const { container } = render(<ConversationTimeline segments={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('运行级展开后多簇多思考按传入顺序交错渲染（时间轴顺序即投影顺序）', () => {
    const secondTools: ConversationSegment = {
      ...toolsSegment,
      iteration: 3,
      activities: [
        { key: 'call-2', name: 'workspace_exec', status: 'running', actionLabel: '已运行', iteration: 3 },
      ],
      totalCount: 1,
      runningCount: 1,
      state: 'running',
    };
    const thirdReasoning: ConversationSegment = {
      kind: 'reasoning', iteration: 3, text: '第三轮思考', preview: '第三轮思考',
    };
    const { container } = render(
      <ConversationTimeline segments={[
        reasoningSegment, toolsSegment, thirdReasoning, secondTools,
      ]} />
    );
    // 含运行中簇 → 不折叠（实时流式）；节点顺序：思考2 → 簇2 → 思考3 → 簇3
    const nodes = Array.from(
      container.querySelectorAll('.sc-timeline-reasoning, .sc-timeline-cluster')
    );
    expect(nodes.map((node) => node.getAttribute('data-iteration'))).toEqual(['2', '2', '3', '3']);
    expect(container.querySelectorAll('.sc-timeline-cluster')).toHaveLength(2);
  });

  it('UI-437 v4：运行簇存在时不折叠（实时流式，最新事件可见）；折叠摘要行不再渲染', () => {
    const settledExec: ConversationSegment = {
      ...toolsSegment,
      activities: [{
        key: 'exec-1',
        name: 'workspace_exec',
        status: 'success',
        actionLabel: '已运行',
        iteration: 2,
        command: 'ls',
      }],
      totalCount: 1,
    };
    const settled = render(<ConversationTimeline segments={[settledExec]} />);
    // 完成 → 一行运行摘要，明细收起
    expect(settled.container.querySelector('.sc-run-fold-line')).toBeTruthy();
    expect(settled.container.querySelector('.sc-tool-activity-inline')).toBeNull();

    const running: ConversationSegment = {
      ...settledExec,
      activities: [{
        key: 'exec-2',
        name: 'workspace_exec',
        status: 'running',
        actionLabel: '已运行',
        iteration: 2,
        command: 'ls',
      }],
      runningCount: 1,
      state: 'running',
    };
    const live = render(<ConversationTimeline segments={[running]} />);
    // 运行中 → 不折叠，实时流式（簇体在、最新事件单行）
    expect(live.container.querySelector('.sc-tool-activity-inline')).toBeTruthy();
    expect(live.container.querySelectorAll('.sc-tool-qoder-row').length).toBe(1);
  });
});
