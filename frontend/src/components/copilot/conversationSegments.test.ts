import { describe, expect, it } from 'vitest';

import type { ToolActivityItem, ToolActivityStatus } from './toolActivity';
import type { ConversationMessage } from './copilotConversationsClient';
import { restoreSimpleMessage } from './SimpleChat/types';
import {
  REASONING_PREVIEW_CHARS,
  UNGROUPED_ITERATION,
  buildConversationSegments,
  hasNarrativeSegment,
  reasoningPreview,
} from './conversationSegments';

function activity(
  name: string,
  status: ToolActivityStatus,
  overrides: Partial<ToolActivityItem> = {}
): ToolActivityItem {
  return {
    key: overrides.key ?? `${name}:${overrides.iteration ?? UNGROUPED_ITERATION}:${Math.random()}`,
    name,
    status,
    actionLabel: '已调用',
    ...overrides,
  };
}

describe('BLOCK-107 会话分段模型（D1=c 按 iteration 交错）', () => {
  it('无时间线素材时退化为单一 narrative 分段（D2 兼容红线）', () => {
    const segments = buildConversationSegments({ content: '纯文本回答' });
    expect(segments).toEqual([{ kind: 'narrative', text: '纯文本回答' }]);
  });

  it('无素材且无正文时返回空序列', () => {
    expect(buildConversationSegments({ content: '   ' })).toEqual([]);
    expect(buildConversationSegments({})).toEqual([]);
  });

  it('单迭代：思考 → 工具簇 → 正文', () => {
    const segments = buildConversationSegments({
      content: '结论',
      toolActivities: [activity('workspace_read', 'success', { iteration: 1 })],
      reasoningByIteration: { 1: '先看一眼文件' },
    });
    expect(segments.map((segment) => segment.kind)).toEqual(['reasoning', 'tools', 'narrative']);
    const tools = segments[1];
    expect(tools.kind === 'tools' && tools.iteration).toBe(1);
  });

  it('多迭代按 iteration 升序交错（工具与思考不再被类型分组拍平）', () => {
    const segments = buildConversationSegments({
      content: '结论',
      toolActivities: [
        activity('workspace_read', 'success', { iteration: 1 }),
        activity('workspace_exec', 'success', { iteration: 2 }),
        activity('workspace_write', 'success', { iteration: 3 }),
      ],
      reasoningByIteration: { 2: '第二轮先跑测试', 3: '第三轮改代码' },
    });
    // narrative 分段按设计不携带 iteration（它是全部迭代之后的最终输出，
    // 持久化未记录其归属迭代，不伪造）。
    expect(segments.map((segment) => (
      segment.kind === 'narrative' ? 'narrative' : `${segment.kind}#${segment.iteration}`
    ))).toEqual([
      'tools#1',
      'reasoning#2',
      'tools#2',
      'reasoning#3',
      'tools#3',
      'narrative',
    ]);
  });

  it('无 iteration 的历史活动归入 0 号段且排在最前，不丢内容', () => {
    const segments = buildConversationSegments({
      content: '结论',
      toolActivities: [
        activity('legacy_tool', 'success'),
        activity('workspace_read', 'success', { iteration: 2 }),
      ],
    });
    expect(segments[0].kind).toBe('tools');
    expect(segments[0].kind === 'tools' && segments[0].iteration).toBe(UNGROUPED_ITERATION);
    expect(segments[0].kind === 'tools' && segments[0].totalCount).toBe(1);
    expect(segments.at(-1)?.kind).toBe('narrative');
  });

  it('簇头统计：失败计数 / 运行中计数 / 状态 / 耗时求和', () => {
    const segments = buildConversationSegments({
      content: '结论',
      toolActivities: [
        activity('workspace_read', 'success', { iteration: 1, durationMs: 120 }),
        activity('workspace_exec', 'error', { iteration: 1, durationMs: 80 }),
        activity('workspace_exec', 'running', { iteration: 1 }),
      ],
    });
    const tools = segments[0];
    expect(tools.kind).toBe('tools');
    if (tools.kind !== 'tools') throw new Error('unreachable');
    expect(tools.totalCount).toBe(3);
    expect(tools.failedCount).toBe(1);
    expect(tools.runningCount).toBe(1);
    expect(tools.state).toBe('running');
    expect(tools.durationMs).toBe(200);
  });

  it('全部终态时簇状态为 settled（渲染层据此自动收起）', () => {
    const segments = buildConversationSegments({
      toolActivities: [activity('workspace_read', 'success', { iteration: 1 })],
    });
    const tools = segments[0];
    expect(tools.kind === 'tools' && tools.state).toBe('settled');
  });

  it('denied 计入失败计数；无耗时项时 durationMs 为 null（不伪造成 0）', () => {
    const denied = buildConversationSegments({
      toolActivities: [activity('workspace_write', 'denied', { iteration: 1 })],
    });
    expect(denied[0].kind === 'tools' && denied[0].failedCount).toBe(1);
    expect(denied[0].kind === 'tools' && denied[0].durationMs).toBeNull();
  });

  it('阶段进度作为独立分段插在对应工具簇之后（D5）', () => {
    const segments = buildConversationSegments({
      content: '结论',
      toolActivities: [activity('workspace_read', 'success', { iteration: 2 })],
      progressUpdates: [{ iteration: 2, content: '已经读完关键文件' }],
    });
    expect(segments.map((segment) => segment.kind)).toEqual(['tools', 'progress', 'narrative']);
  });

  it('复用 UI-383 既有折叠规则产出 groups（渲染层无需二次分组）', () => {
    const segments = buildConversationSegments({
      toolActivities: [
        activity('workspace_read', 'success', { iteration: 1 }),
        activity('workspace_list', 'success', { iteration: 1 }),
        activity('workspace_exec', 'success', { iteration: 1 }),
      ],
    });
    const tools = segments[0];
    if (tools.kind !== 'tools') throw new Error('unreachable');
    expect(tools.groups).toHaveLength(2);
    expect(tools.groups[0].kind).toBe('routine');
    expect(tools.groups[0].items).toHaveLength(2);
    expect(tools.groups[1].kind).toBe('activity');
  });

  it('正文为空串时不产出 narrative 分段（运行中轮次）', () => {
    const segments = buildConversationSegments({
      content: '   ',
      toolActivities: [activity('workspace_read', 'running', { iteration: 1 })],
    });
    expect(segments.map((segment) => segment.kind)).toEqual(['tools']);
    expect(hasNarrativeSegment(segments)).toBe(false);
  });

  it('reasoningByIteration 的非数字键 / 空值被忽略', () => {
    const segments = buildConversationSegments({
      toolActivities: [activity('workspace_read', 'success', { iteration: 1 })],
      reasoningByIteration: { legacy: '不该出现', 0: '零号忽略', 2: '   ' } as unknown as Record<number, string>,
    });
    expect(segments.map((segment) => segment.kind)).toEqual(['tools']);
  });
});

describe('BLOCK-107 思考行折叠预览', () => {
  it('取首个非空行并剥离 markdown 前缀与强调标记', () => {
    expect(reasoningPreview('> ## 先看 **README**\n第二行')).toBe('先看 README');
    expect(reasoningPreview('\n\n- `pnpm build` 试一下')).toBe('pnpm build 试一下');
  });

  it('超长预览按上限截断并以省略号收尾', () => {
    const preview = reasoningPreview('长'.repeat(REASONING_PREVIEW_CHARS + 50));
    expect(preview).toHaveLength(REASONING_PREVIEW_CHARS);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('空文本返回空串', () => {
    expect(reasoningPreview('')).toBe('');
    expect(reasoningPreview('   \n\n  ')).toBe('');
  });
});

describe('BLOCK-107 历史/实况一致性契约（plan §5-2 机械断言）', () => {
  const shape = (segments: ReturnType<typeof buildConversationSegments>): string[] => (
    segments.map((segment) => (
      segment.kind === 'narrative' ? 'narrative' : `${segment.kind}#${segment.iteration}`
    ))
  );

  it('同一轮对话经「历史恢复」与「实况素材」两条轨道投影出的片段时间序一致', () => {
    const liveActivities: ToolActivityItem[] = [
      activity('workspace_read', 'success', { key: 'c1', iteration: 1, durationMs: 30 }),
      activity('workspace_search', 'success', { key: 'c2', iteration: 1, durationMs: 12 }),
      activity('workspace_exec', 'error', { key: 'c3', iteration: 2, durationMs: 90 }),
    ];
    const reasoning = { 1: '先读文件确认结构', 2: '再跑一次命令验证' };
    const progress = [{ iteration: 2, content: '第二轮结束，结构已确认' }];

    // 轨道 A —— 持久化 meta 经历史恢复（刷新 / 切换会话后前端实际走这条）
    const persisted: ConversationMessage = {
      id: 'msg_hist_1',
      role: 'assistant',
      content: '最终结论：结构已确认。',
      ts: '2026-09-20T00:00:00.000Z',
      meta: {
        toolActivities: liveActivities,
        reasoningByIteration: reasoning,
        progressUpdates: progress,
      },
    };
    const historyMessage = restoreSimpleMessage(persisted);

    // 轨道 B —— 实况素材（run 中 SSE 累积出的同一形状）
    const fromHistory = buildConversationSegments({
      content: historyMessage.content,
      toolActivities: historyMessage.toolActivities,
      reasoningByIteration: historyMessage.reasoningByIteration,
      progressUpdates: historyMessage.progressUpdates,
    });
    const fromLive = buildConversationSegments({
      content: '最终结论：结构已确认。',
      toolActivities: liveActivities,
      reasoningByIteration: reasoning,
      progressUpdates: progress,
    });

    expect(shape(fromHistory)).toEqual(shape(fromLive));
    expect(shape(fromLive)).toEqual([
      'reasoning#1',
      'tools#1',
      'reasoning#2',
      'tools#2',
      'progress#2',
      'narrative',
    ]);
  });

  it('实况/历史同源前提：历史恢复层保留交错所依赖的 iteration 与素材字段', () => {
    const persisted: ConversationMessage = {
      id: 'msg_hist_2',
      role: 'assistant',
      content: '结论',
      ts: '2026-09-20T00:00:00.000Z',
      meta: {
        toolActivities: [activity('workspace_read', 'success', { key: 'c1', iteration: 3 })],
        reasoningByIteration: { 3: '第三轮思考' },
        progressUpdates: [{ iteration: 3, content: '第三轮结论' }],
      },
    };
    const restored = restoreSimpleMessage(persisted);
    // 若历史恢复丢了 iteration，分段会退化成「一个 0 号簇」，交错即失效——
    // 这条断言把该退化钉死在测试层（D1=c 的可行性前提）。
    expect(restored.toolActivities?.[0]?.iteration).toBe(3);
    expect(restored.reasoningByIteration).toEqual({ 3: '第三轮思考' });
    expect(restored.progressUpdates).toEqual([{ iteration: 3, content: '第三轮结论' }]);
    expect(shape(buildConversationSegments({
      content: restored.content,
      toolActivities: restored.toolActivities,
      reasoningByIteration: restored.reasoningByIteration,
      progressUpdates: restored.progressUpdates,
    }))).toEqual(['reasoning#3', 'tools#3', 'progress#3', 'narrative']);
  });
});
