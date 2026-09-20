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
  it('只渲染思考节点与工具簇；narrative 交由宿主原位渲染', () => {
    const { container } = render(
      <ConversationTimeline segments={[reasoningSegment, toolsSegment, narrativeSegment]} />
    );
    const view = within(container);
    expect(view.getByText('思考 · 第 2 轮')).toBeTruthy();
    expect(container.textContent).toContain('已完成 1 项');
    // 正文不由本组件产出（宿主负责），避免同一正文被渲染两次
    expect(container.textContent).not.toContain('最终正文');
  });

  it('工具簇复用 ToolActivityList 的簇头一行（不传 reasoningByIteration，思考不重复）', () => {
    const { container } = render(<ConversationTimeline segments={[toolsSegment]} />);
    expect(container.querySelector('.sc-conversation-timeline')).toBeTruthy();
    expect(container.querySelector('.sc-timeline-cluster')).toBeTruthy();
    expect(container.querySelector('.sc-tool-activity-summary')).toBeTruthy();
    // 簇内不再出现思考行（思考已由时间线独立成节点）
    expect(container.querySelector('.sc-timeline-reasoning')).toBeNull();
  });

  it('思考节点折叠态显示一行预览，点击展开全文并收起预览', () => {
    const { container } = render(<ConversationTimeline segments={[reasoningSegment]} />);
    expect(container.querySelector('.sc-timeline-reasoning-preview')?.textContent)
      .toBe('先确认一下这个函数在哪被调用');

    fireEvent.click(within(container).getByRole('button', { name: '展开思考 · 第 2 轮' }));

    expect(container.querySelector('.sc-tool-reasoning-text')?.textContent)
      .toContain('第二行细节');
    expect(container.querySelector('.sc-timeline-reasoning-preview')).toBeNull();
  });

  it('progress 分段默认跳过（宿主仍在别处渲染阶段进度时不重复展示）', () => {
    const { container } = render(<ConversationTimeline segments={[progressSegment]} />);
    expect(container.firstChild).toBeNull();
  });

  it('传入 renderProgress 时按位置渲染：阶段进度落在对应工具簇之后（D5）', () => {
    const { container } = render(
      <ConversationTimeline
        segments={[toolsSegment, progressSegment]}
        renderProgress={(segment) => <span>{segment.content}</span>}
      />
    );
    const html = container.innerHTML;
    expect(within(container).getByText('已经读完关键文件')).toBeTruthy();
    expect(html.indexOf('已完成 1 项')).toBeLessThan(html.indexOf('已经读完关键文件'));
  });

  it('renderProgress 拿到 isFirst / isLast，容器沿用 .sc-agent-progress 排版（D5+UI-305）', () => {
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
    expect(metas).toEqual([
      { isFirst: true, isLast: false },
      { isFirst: false, isLast: true },
    ]);
    expect(container.querySelector('.sc-timeline-progress.sc-agent-progress')).toBeTruthy();
  });

  it('renderProgress 返回 null 的分段不产出节点（首条=意图被宿主省略时不留空壳）', () => {
    const intention: ConversationSegment = { kind: 'progress', iteration: 1, content: '打算先读文件' };
    const { container } = render(
      <ConversationTimeline
        segments={[intention, toolsSegment]}
        renderProgress={(segment, meta) => (meta.isFirst ? null : <span>{segment.content}</span>)}
      />
    );
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

  it('多簇多思考按传入顺序交错渲染（时间轴顺序即投影顺序）', () => {
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
    // querySelectorAll 按文档顺序返回：思考2 → 簇2 → 思考3 → 簇3
    const nodes = Array.from(
      container.querySelectorAll('.sc-timeline-reasoning, .sc-timeline-cluster')
    );
    expect(nodes.map((node) => node.getAttribute('data-iteration'))).toEqual(['2', '2', '3', '3']);
    expect(container.querySelectorAll('.sc-timeline-cluster')).toHaveLength(2);
  });

  it('D4 折叠策略：含 exec 的已完成簇默认收起为一行，运行中簇默认展开', () => {
    // 用「含 workspace_exec」的簇做判据——既有 ToolActivityList 对该形状默认展开
    // （UI-315 ZCode 式），因此这条断言真正区分 D4 托管态是否生效。
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
    expect(live.container.querySelector('.sc-tool-activity-inline')).toBeTruthy();
  });
});
