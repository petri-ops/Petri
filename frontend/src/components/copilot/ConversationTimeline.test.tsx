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
    // UI-437 加映 — 思考节点标签去轮次号（内部细节不外露）
    expect(view.getByText('思考')).toBeTruthy();
    // BLOCK-108 P3 / UI-437 v3 — 完成簇折叠为计数式簇头一行
    expect(container.textContent).toContain('执行工具 1 次');
    // 正文不由本组件产出（宿主负责），避免同一正文被渲染两次
    expect(container.textContent).not.toContain('最终正文');
  });

  it('工具簇复用 ToolActivityList 的簇头一行（不传 reasoningByIteration，思考不重复）', () => {
    const { container } = render(<ConversationTimeline segments={[toolsSegment]} />);
    expect(container.querySelector('.sc-conversation-timeline')).toBeTruthy();
    expect(container.querySelector('.sc-timeline-cluster')).toBeTruthy();
    // UI-437 v3 — 完成簇保留折叠开关（簇头一行摘要），明细默认隐藏
    expect(container.querySelector('.sc-tool-activity-summary')).toBeTruthy();
    expect(container.querySelector('[data-testid="qoder-cluster-body"]')).toBeNull();
    // 簇内不再出现思考行（思考已由时间线独立成节点）
    expect(container.querySelector('.sc-timeline-reasoning')).toBeNull();
  });

  it('UI-437 加映：思考节点折叠态只留标签一行（无长预览），点击展开全文', () => {
    const { container } = render(<ConversationTimeline segments={[reasoningSegment]} />);
    // 完成态思考行对齐 ZCode：只留标签，预览不渲染（避免读起来像未折叠正文）
    expect(container.querySelector('.sc-timeline-reasoning-preview')).toBeNull();

    fireEvent.click(within(container).getByRole('button', { name: '展开思考' }));

    expect(container.querySelector('.sc-tool-reasoning-text')?.textContent)
      .toContain('第二行细节');
  });

  it('progress 分段默认跳过（宿主仍在别处渲染阶段进度时不重复展示）', () => {
    const { container } = render(<ConversationTimeline segments={[progressSegment]} />);
    expect(container.firstChild).toBeNull();
  });

  it('传入 renderProgress 时按输入顺序渲染（簇前/簇后由段模型排序，BLOCK-108 起簇前）', () => {
    const { container } = render(
      <ConversationTimeline
        segments={[toolsSegment, progressSegment]}
        renderProgress={(segment) => <span>{segment.content}</span>}
      />
    );
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
    expect(metas).toEqual([
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

  it('UI-437 v3 ZCode 模型：完成簇自动折叠为一行摘要；运行簇只渲染最新一条事件单行', () => {
    // 用户裁决「每一轮所有任务都自动折叠 需要再点开」：完成即折叠为摘要一行
    // （点簇头展开明细），运行簇头部「工作中 · 已运行 Ns」+ 仅最新事件单行。
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
    expect(settled.container.textContent).toContain('执行工具 1 次');

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
    expect(live.container.querySelectorAll('.sc-tool-qoder-row').length).toBe(1);
  });
});
