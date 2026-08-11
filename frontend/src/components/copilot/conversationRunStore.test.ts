import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cancelAgentTaskMock, streamChatMock, subscribeAgentTaskMock, fetchLoopRunsMock, findResumableAgentTaskMock } = vi.hoisted(() => ({
  cancelAgentTaskMock: vi.fn(),
  streamChatMock: vi.fn(),
  subscribeAgentTaskMock: vi.fn(),
  fetchLoopRunsMock: vi.fn(),
  findResumableAgentTaskMock: vi.fn(),
}));

vi.mock('./copilotClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('./copilotClient')>();
  return {
    ...original,
    cancelAgentTask: cancelAgentTaskMock,
    findResumableAgentTask: findResumableAgentTaskMock,
    streamChat: streamChatMock,
    subscribeAgentTask: subscribeAgentTaskMock,
  };
});

vi.mock('@/lib/loop-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/loop-client')>();
  return {
    ...original,
    fetchLoopRuns: fetchLoopRunsMock,
  };
});

import {
  __resetConversationRunsForTests,
  getConversationRunSnapshot,
  getSubAgentTaskSnapshot,
  listSubAgentTasksForConversation,
  resultEditProgressForContext,
  shouldClearReconciledConversationRun,
  startConversationRun,
  startSubAgentTask,
  stopConversationRun,
  stopSubAgentTask,
  subscribeConversationRun,
  resumeSubAgentTasks,
  resumeOrphanAgentTasks,
} from './conversationRunStore';
import { biof3Events, subscribeBioF3Event } from '@/lib/events';
import { deriveLoopDisplay } from '@/lib/loop-client';

function start(conversationId: string, userContent: string, contextToken?: string): void {
  startConversationRun({
    conversationId,
    projectId: 'project-1',
    userContent,
    messages: [{ role: 'user', content: userContent }],
    context: {
      page: 'desktop-project',
      projectId: 'project-1',
      ...(contextToken ? {
        activeArtifact: {
          jobId: 'job-1', toolId: 'volcano-plot', name: 'plot.png', type: 'image', contextToken,
        },
      } : {}),
    },
  });
}

describe('conversation run store', () => {
  beforeEach(() => {
    __resetConversationRunsForTests();
    streamChatMock.mockReset();
    streamChatMock.mockResolvedValue(undefined);
    cancelAgentTaskMock.mockReset();
    cancelAgentTaskMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    __resetConversationRunsForTests();
  });

  it('keeps parallel conversation streams isolated', () => {
    start('conversation-a', 'first question');
    start('conversation-b', 'second question');

    const firstCallbacks = streamChatMock.mock.calls[0][0];
    const secondCallbacks = streamChatMock.mock.calls[1][0];
    firstCallbacks.onDelta('answer a');
    secondCallbacks.onDelta('answer b');

    expect(getConversationRunSnapshot('conversation-a')).toMatchObject({
      status: 'running',
      userContent: 'first question',
      assistantContent: 'answer a',
    });
    expect(getConversationRunSnapshot('conversation-b')).toMatchObject({
      status: 'running',
      userContent: 'second question',
      assistantContent: 'answer b',
    });
  });

  it('keeps RS5 ChangeSet progress ordered and visible as a compact status', () => {
    start('conversation-rs5', 'change the palette');
    const callbacks = streamChatMock.mock.calls[0][0];
    callbacks.onResultEditProgress({
      resultEditProgressVersion: 1, sequence: 2, changeSetId: 'cs_1', stage: 'job', status: 'running',
    });
    callbacks.onResultEditProgress({
      resultEditProgressVersion: 1, sequence: 1, changeSetId: 'cs_1', stage: 'materialize', status: 'completed',
    });
    expect(getConversationRunSnapshot('conversation-rs5')).toMatchObject({
      statusMessage: '正在生成独立脚本与参数',
      resultEditProgress: [
        { sequence: 1, stage: 'materialize' },
        { sequence: 2, stage: 'job' },
      ],
    });
  });

  it('never projects one result run progress onto a different active context', () => {
    const tokenA = 'a'.repeat(64);
    const tokenB = 'b'.repeat(64);
    start('conversation-scoped', 'change the palette', tokenA);
    const callbacks = streamChatMock.mock.calls[0][0];
    callbacks.onResultEditProgress({
      resultEditProgressVersion: 1, sequence: 1, changeSetId: 'cs-a',
      stage: 'plan', status: 'completed', publicPhase: 'assess_impact',
      publicPhaseLabel: '判断影响',
    });
    const snapshot = getConversationRunSnapshot('conversation-scoped');
    expect(resultEditProgressForContext(snapshot, tokenA)).toHaveLength(1);
    expect(resultEditProgressForContext(snapshot, tokenB)).toEqual([]);
    expect(resultEditProgressForContext(snapshot, null)).toEqual([]);
  });

  it('continues updating after the visible conversation unsubscribes', () => {
    start('conversation-a', 'keep working');
    const listener = vi.fn();
    const unsubscribe = subscribeConversationRun('conversation-a', listener);
    unsubscribe();

    streamChatMock.mock.calls[0][0].onDelta('background result');

    expect(listener).not.toHaveBeenCalled();
    expect(getConversationRunSnapshot('conversation-a')?.assistantContent).toBe('background result');
  });

  it('finishes only the matching conversation', () => {
    start('conversation-a', 'first');
    start('conversation-b', 'second');

    streamChatMock.mock.calls[0][0].onDone();

    expect(getConversationRunSnapshot('conversation-a')?.status).toBe('done');
    expect(getConversationRunSnapshot('conversation-b')?.status).toBe('running');
  });

  it('shows finalization retry status until answer content arrives', () => {
    start('conversation-a', 'inspect files');
    const callbacks = streamChatMock.mock.calls[0][0];

    callbacks.onAgentStatus({
      phase: 'finalization_retry',
      message: '模型未返回可展示的最终说明，正在自动重试整理…',
      attempt: 2,
      maxAttempts: 2,
      reason: 'empty_final_response',
    });
    expect(getConversationRunSnapshot('conversation-a')).toMatchObject({
      assistantPending: true,
      statusMessage: '模型未返回可展示的最终说明，正在自动重试整理…',
    });

    callbacks.onDelta('已完成数据检查。');
    expect(getConversationRunSnapshot('conversation-a')).toMatchObject({
      assistantContent: '已完成数据检查。',
      statusMessage: undefined,
    });
  });

  it('keeps model-authored progress when the next tool iteration starts', () => {
    start('conversation-a', 'inspect project files');
    const callbacks = streamChatMock.mock.calls[0][0];

    callbacks.onDelta('我先核对表达矩阵与样本信息。');
    callbacks.onAgentProgress({
      iteration: 1,
      content: '我先核对表达矩阵与样本信息。',
    });
    callbacks.onIter(2);

    expect(getConversationRunSnapshot('conversation-a')).toMatchObject({
      assistantContent: '',
      assistantPending: true,
      progressUpdates: [{
        iteration: 1,
        content: '我先核对表达矩阵与样本信息。',
      }],
    });

    callbacks.onDelta('文件结构已经确认。');
    expect(getConversationRunSnapshot('conversation-a')).toMatchObject({
      assistantContent: '文件结构已经确认。',
      progressUpdates: [{
        iteration: 1,
        content: '我先核对表达矩阵与样本信息。',
      }],
    });
  });

  it('preserves progress and tool activity when the user stops a background task', async () => {
    start('conversation-a', 'run a long analysis');
    const callbacks = streamChatMock.mock.calls[0][0];
    callbacks.onTaskStarted('task-1');
    callbacks.onAgentProgress({
      iteration: 1,
      content: '表达矩阵和样本信息已完成对齐。',
    });
    callbacks.onResultEditProgress({
      resultEditProgressVersion: 1,
      sequence: 1,
      changeSetId: 'cs-stop',
      stage: 'job',
      status: 'running',
      publicPhase: 'execute_or_recompute',
      publicPhaseLabel: '执行/重算',
    });
    callbacks.onToolCall({ name: 'workspace_read', args: { path: 'counts.csv' } });

    stopConversationRun('conversation-a');

    expect(getConversationRunSnapshot('conversation-a')).toMatchObject({
      status: 'stopped',
      assistantPending: false,
      assistantError: false,
      taskId: 'task-1',
      progressUpdates: [{
        iteration: 1,
        content: '表达矩阵和样本信息已完成对齐。',
      }],
      resultEditProgress: [{
        sequence: 1,
        publicPhase: 'execute_or_recompute',
      }],
    });
    expect(getConversationRunSnapshot('conversation-a')?.toolActivities).toHaveLength(1);
    expect(cancelAgentTaskMock).toHaveBeenCalledWith('task-1');
  });

  it('keeps public result-edit stages after a failed Agent run', () => {
    start('conversation-failed-edit', 'change the threshold');
    const callbacks = streamChatMock.mock.calls[0][0];
    callbacks.onResultEditProgress({
      resultEditProgressVersion: 1,
      sequence: 1,
      changeSetId: 'cs-failed',
      stage: 'failed',
      status: 'terminal',
      reason: 'validator blocked',
    });
    callbacks.onError(new Error('provider disconnected'));
    expect(getConversationRunSnapshot('conversation-failed-edit')).toMatchObject({
      status: 'error',
      assistantPending: false,
      resultEditProgress: [{
        stage: 'failed',
        status: 'terminal',
        reason: 'validator blocked',
      }],
    });
  });

  it('prevents overlapping runs inside the same conversation', () => {
    start('conversation-a', 'first');
    const duplicate = startConversationRun({
      conversationId: 'conversation-a',
      projectId: 'project-1',
      userContent: 'second',
      messages: [{ role: 'user', content: 'second' }],
      context: { page: 'desktop-project', projectId: 'project-1' },
    });

    expect(duplicate).toBe(false);
    expect(streamChatMock).toHaveBeenCalledTimes(1);
  });

  it('broadcasts a project file refresh after successful workspace mutations and commands', () => {
    const received: Array<{ projectId: string; source: string }> = [];
    const unsubscribe = subscribeBioF3Event(biof3Events.projectWorkspaceChanged, (detail) => {
      received.push(detail);
    });
    start('conversation-a', 'edit a file');
    const callbacks = streamChatMock.mock.calls[0][0];

    callbacks.onToolResult({
      name: 'workspace_write',
      summary: 'ok',
      toolResult: {
        contractVersion: '1',
        traceId: 'trace-1',
        callId: 'call-1',
        tool: 'workspace_write',
        status: 'success',
        terminationReason: 'completed',
        durationMs: 2,
        truncated: false,
        sideEffects: { type: 'workspace-write', riskTier: 'R2', resources: ['project.files'] },
      },
    });
    callbacks.onToolResult({
      name: 'workspace_read',
      summary: 'ok',
      toolResult: {
        contractVersion: '1',
        traceId: 'trace-2',
        callId: 'call-2',
        tool: 'workspace_read',
        status: 'success',
        terminationReason: 'completed',
        durationMs: 1,
        truncated: false,
        sideEffects: { type: 'none', riskTier: 'R0', resources: [] },
      },
    });

    expect(received).toEqual([{ projectId: 'project-1', source: 'agent' }]);
    unsubscribe();
  });

  it('opens a completed analysis result directly from the run_tool event', () => {
    const received: Array<{ toolJobId: string; projectId?: string | null }> = [];
    const unsubscribe = subscribeBioF3Event(biof3Events.projectOpenResult, (detail) => {
      received.push(detail);
    });
    start('conversation-a', 'run analysis');
    const callbacks = streamChatMock.mock.calls[0][0];

    callbacks.onToolResult({
      name: 'run_tool',
      summary: 'ok',
      toolJobId: 'tj-result-1',
      toolResult: {
        contractVersion: '1',
        traceId: 'trace-result',
        callId: 'call-result',
        tool: 'run_tool',
        status: 'success',
        terminationReason: 'completed',
        durationMs: 8,
        truncated: false,
        sideEffects: { type: 'execution', riskTier: 'R2', resources: ['tool_jobs'] },
      },
    });

    expect(received).toEqual([{ toolJobId: 'tj-result-1', projectId: 'project-1' }]);
    unsubscribe();
  });

  it('clears durable completed and stopped snapshots after history reconciliation', () => {
    expect(shouldClearReconciledConversationRun({ status: 'done', pendingApproval: null })).toBe(true);
    expect(shouldClearReconciledConversationRun({ status: 'stopped', pendingApproval: null })).toBe(true);
    expect(shouldClearReconciledConversationRun({ status: 'running', pendingApproval: null })).toBe(false);
    expect(shouldClearReconciledConversationRun({ status: 'error', pendingApproval: null })).toBe(false);
    expect(shouldClearReconciledConversationRun({
      status: 'stopped',
      pendingApproval: { ackToken: 'ack-1' },
    })).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // HLE-C4R: durable-loop projection wiring (loop_phase / loop_iteration)
  // ---------------------------------------------------------------------------

  it('records loop_phase into the durable-loop projection', () => {
    start('conversation-a', 'run bulk rna-seq');
    const callbacks = streamChatMock.mock.calls[0][0];

    callbacks.onLoopPhase({
      phase: 'started',
      loopRunId: 'loop-1',
      automationMode: 'trusted',
      executionIntent: 'task_execute',
    });

    expect(getConversationRunSnapshot('conversation-a')?.loop).toMatchObject({
      loopRunId: 'loop-1',
      phase: 'started',
      automationMode: 'trusted',
      executionIntent: 'task_execute',
      recoveryRequired: false,
      iterations: [],
    });
  });

  it('appends loop iterations ordered by sequence and tracks the latest conclusion', () => {
    start('conversation-a', 'run bulk rna-seq');
    const callbacks = streamChatMock.mock.calls[0][0];

    callbacks.onLoopPhase({ phase: 'started', loopRunId: 'loop-1' });
    callbacks.onLoopIteration({
      loopRunId: 'loop-1', iterationId: 'iter-2', sequence: 2,
      decision: 'continue', decisionReasonCode: 'TOOL_SUCCEEDED',
      publicConclusion: 'DESeq2 完成', status: 'succeeded',
      proposedActionKey: null, actionKeyHash: null,
    });
    callbacks.onLoopIteration({
      loopRunId: 'loop-1', iterationId: 'iter-1', sequence: 1,
      decision: 'continue', decisionReasonCode: 'TOOL_SUCCEEDED',
      publicConclusion: '已生成 counts 矩阵', status: 'succeeded',
      proposedActionKey: null, actionKeyHash: null,
    });

    const loop = getConversationRunSnapshot('conversation-a')?.loop;
    expect(loop?.iterations.map((it) => it.sequence)).toEqual([1, 2]);
    // latestConclusion tracks the most recently RECEIVED iteration, not seq order
    expect(loop?.latestConclusion).toBe('已生成 counts 矩阵');
    expect(loop?.lastDecision).toBe('continue');
  });

  it('is idempotent: an SSE event and a replay of the same iterationId merge to one entry', () => {
    start('conversation-a', 'run bulk rna-seq');
    const callbacks = streamChatMock.mock.calls[0][0];

    const iter = {
      loopRunId: 'loop-1', iterationId: 'iter-1', sequence: 1,
      decision: 'continue' as const, decisionReasonCode: 'TOOL_SUCCEEDED',
      publicConclusion: '第一轮', status: 'succeeded',
      proposedActionKey: null, actionKeyHash: null,
    };
    callbacks.onLoopIteration(iter);
    // Replay the same iteration (e.g. API backfill) with an updated conclusion.
    callbacks.onLoopIteration({ ...iter, publicConclusion: '第一轮（更新）' });

    const loop = getConversationRunSnapshot('conversation-a')?.loop;
    expect(loop?.iterations).toHaveLength(1);
    expect(loop?.iterations[0].publicConclusion).toBe('第一轮（更新）');
  });

  it('preserves the loop projection when the user stops the run', () => {
    start('conversation-a', 'run bulk rna-seq');
    const callbacks = streamChatMock.mock.calls[0][0];
    callbacks.onLoopPhase({ phase: 'started', loopRunId: 'loop-1' });
    callbacks.onLoopIteration({
      loopRunId: 'loop-1', iterationId: 'iter-1', sequence: 1,
      decision: 'continue', decisionReasonCode: 'TOOL_SUCCEEDED',
      publicConclusion: '已完成对齐', status: 'succeeded',
      proposedActionKey: null, actionKeyHash: null,
    });

    stopConversationRun('conversation-a');

    const loop = getConversationRunSnapshot('conversation-a')?.loop;
    expect(loop?.loopRunId).toBe('loop-1');
    expect(loop?.iterations).toHaveLength(1);
  });

  it('a blocked iteration never renders as a green completion', () => {
    start('conversation-a', 'run bulk rna-seq');
    const callbacks = streamChatMock.mock.calls[0][0];
    callbacks.onLoopIteration({
      loopRunId: 'loop-1', iterationId: 'iter-1', sequence: 1,
      decision: 'block', decisionReasonCode: 'ARTIFACT_VALIDATION_FAILED',
      publicConclusion: '检测到假成功：任务失败但产生了文件。禁止宣称完成。',
      status: 'blocked', proposedActionKey: null, actionKeyHash: null,
    });

    const loop = getConversationRunSnapshot('conversation-a')?.loop;
    const display = deriveLoopDisplay(loop, false);
    expect(display.status).toBe('blocked');
    expect(display.tone).toBe('warning');
    expect(display.tone).not.toBe('success');
  });
});

// ===========================================================================
// AGENT-CONCURRENCY: parallel sub-agent task subsystem
// ===========================================================================
describe('sub-agent task subsystem', () => {
  beforeEach(() => {
    __resetConversationRunsForTests();
    streamChatMock.mockReset();
  });
  afterEach(() => {
    __resetConversationRunsForTests();
  });

  function spawn(conversationId: string, parentTaskId: string, taskId: string): void {
    streamChatMock.mockImplementation(async (opts) => {
      opts.onTaskStarted?.(taskId);
      opts.onDelta?.('后台结果-' + taskId);
      opts.onDone?.();
    });
    startSubAgentTask({
      conversationId,
      projectId: 'project-1',
      userContent: '后台跑个分析',
      messages: [{ role: 'user', content: '后台跑个分析' }],
      context: { page: 'desktop-project', projectId: 'project-1' },
      parentTaskId,
    });
  }

  it('tracks a sub-agent task independently of the primary run', () => {
    spawn('conv-sub', 'parent-1', 'sub-1');
    const list = listSubAgentTasksForConversation('conv-sub');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      taskId: 'sub-1',
      parentTaskId: 'parent-1',
      status: 'done',
      assistantContent: '后台结果-sub-1',
      conversationId: 'conv-sub',
    });
    // primary conversation run must remain untouched / isolated
    expect(getConversationRunSnapshot('conv-sub')).toBeNull();
  });

  it('runs multiple sub-agents concurrently in the same conversation', () => {
    streamChatMock.mockImplementation(async (opts) => {
      const id = opts.parentTaskId === 'p-a' ? 'sub-a' : 'sub-b';
      opts.onTaskStarted?.(id);
      opts.onDelta?.(id === 'sub-a' ? '结果A' : '结果B');
      opts.onDone?.();
    });
    startSubAgentTask({
      conversationId: 'conv-multi', projectId: 'project-1', userContent: 'a',
      messages: [{ role: 'user', content: 'a' }],
      context: { page: 'desktop-project', projectId: 'project-1' }, parentTaskId: 'p-a',
    });
    startSubAgentTask({
      conversationId: 'conv-multi', projectId: 'project-1', userContent: 'b',
      messages: [{ role: 'user', content: 'b' }],
      context: { page: 'desktop-project', projectId: 'project-1' }, parentTaskId: 'p-b',
    });

    const list = listSubAgentTasksForConversation('conv-multi');
    expect(list.map((t) => t.taskId).sort()).toEqual(['sub-a', 'sub-b']);
    expect(list.find((t) => t.taskId === 'sub-a')?.assistantContent).toBe('结果A');
    expect(list.find((t) => t.taskId === 'sub-b')?.assistantContent).toBe('结果B');
  });

  it('cancels a running sub-agent via stopSubAgentTask', () => {
    streamChatMock.mockImplementation(async (opts) => {
      opts.onTaskStarted?.('sub-stop');
    });
    startSubAgentTask({
      conversationId: 'conv-stop', projectId: 'project-1', userContent: 'x',
      messages: [{ role: 'user', content: 'x' }],
      context: { page: 'desktop-project', projectId: 'project-1' }, parentTaskId: 'p',
    });
    expect(getSubAgentTaskSnapshot('sub-stop')?.status).toBe('running');

    stopSubAgentTask('sub-stop');
    expect(getSubAgentTaskSnapshot('sub-stop')?.status).toBe('stopped');
    expect(cancelAgentTaskMock).toHaveBeenCalledWith('sub-stop');
  });

  it('ignores spawn without a parent task id', () => {
    startSubAgentTask({
      conversationId: 'conv-nop', projectId: 'project-1', userContent: 'x',
      messages: [{ role: 'user', content: 'x' }],
      context: { page: 'desktop-project', projectId: 'project-1' }, parentTaskId: '',
    });
    expect(listSubAgentTasksForConversation('conv-nop')).toHaveLength(0);
    expect(streamChatMock).not.toHaveBeenCalled();
  });
});

describe('resumeSubAgentTasks (AGENT-CONCURRENCY)', () => {
  beforeEach(() => {
    __resetConversationRunsForTests();
    subscribeAgentTaskMock.mockReset();
    subscribeAgentTaskMock.mockResolvedValue(undefined);
    fetchLoopRunsMock.mockReset();
  });

  afterEach(() => {
    __resetConversationRunsForTests();
  });

  it('只重订阅仍 running 的 sub-agent run，跳过 primary 与已完成的', async () => {
    fetchLoopRunsMock.mockResolvedValue([
      { loopRunId: 'lr-primary', projectId: 'project-1', conversationId: 'c1', loopStatus: 'running', kind: 'primary', taskId: 't-primary' },
      { loopRunId: 'lr-sub1', projectId: 'project-1', conversationId: 'c1', loopStatus: 'running', kind: 'subagent', taskId: 't-sub1', parentLoopRunId: 'lr-primary' },
      { loopRunId: 'lr-sub2', projectId: 'project-1', conversationId: 'c1', loopStatus: 'running', kind: 'subagent', taskId: 't-sub2', parentLoopRunId: 'lr-primary' },
      { loopRunId: 'lr-sub3', projectId: 'project-1', conversationId: 'c1', loopStatus: 'completed', kind: 'subagent', taskId: 't-sub3', parentLoopRunId: 'lr-primary' },
    ] as any);

    await resumeSubAgentTasks('c1', 'project-1');

    expect(subscribeAgentTaskMock).toHaveBeenCalledTimes(2);
    expect(subscribeAgentTaskMock).toHaveBeenCalledWith('t-sub1', expect.anything(), 0);
    expect(subscribeAgentTaskMock).toHaveBeenCalledWith('t-sub2', expect.anything(), 0);
    const taskIds = listSubAgentTasksForConversation('c1').map((t) => t.taskId).sort();
    expect(taskIds).toEqual(['t-sub1', 't-sub2']);
  });

  it('fetchLoopRuns 失败时静默返回，不订阅任何任务', async () => {
    fetchLoopRunsMock.mockRejectedValue(new Error('network'));
    await expect(resumeSubAgentTasks('c1', 'project-1')).resolves.toBeUndefined();
    expect(subscribeAgentTaskMock).not.toHaveBeenCalled();
  });

  it('拒绝恢复到其他项目或会话，并跳过缺少归属字段的旧响应', async () => {
    fetchLoopRunsMock.mockResolvedValue([
      { loopRunId: 'lr-other-project', projectId: 'project-2', conversationId: 'c1', loopStatus: 'running', kind: 'subagent', taskId: 't-project-2' },
      { loopRunId: 'lr-other-conversation', projectId: 'project-1', conversationId: 'c2', loopStatus: 'running', kind: 'subagent', taskId: 't-c2' },
      { loopRunId: 'lr-missing-project', conversationId: 'c1', loopStatus: 'running', kind: 'subagent', taskId: 't-legacy' },
    ] as any);

    await resumeSubAgentTasks('c1', 'project-1');

    expect(subscribeAgentTaskMock).not.toHaveBeenCalled();
    expect(listSubAgentTasksForConversation('c1')).toHaveLength(0);
  });
});

describe('resumeOrphanAgentTasks (AGENT-CONCURRENCY A-5)', () => {
  beforeEach(() => {
    __resetConversationRunsForTests();
    subscribeAgentTaskMock.mockReset();
    subscribeAgentTaskMock.mockResolvedValue(undefined);
    fetchLoopRunsMock.mockReset();
    findResumableAgentTaskMock.mockReset();
    findResumableAgentTaskMock.mockReturnValue(null);
    streamChatMock.mockReset();
    streamChatMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    __resetConversationRunsForTests();
  });

  it('同时恢复 running 的 sub-agent 与 localStorage 中未完成的 primary', async () => {
    fetchLoopRunsMock.mockResolvedValue([
      { loopRunId: 'lr-primary', projectId: 'project-1', conversationId: 'c1', loopStatus: 'running', kind: 'primary', taskId: 't-primary' },
      { loopRunId: 'lr-sub1', projectId: 'project-1', conversationId: 'c1', loopStatus: 'running', kind: 'subagent', taskId: 't-sub1', parentLoopRunId: 'lr-primary' },
    ] as any);
    findResumableAgentTaskMock.mockReturnValue('t-primary');

    await resumeOrphanAgentTasks('c1', 'project-1');

    expect(findResumableAgentTaskMock).toHaveBeenCalledWith('c1', 'project-1');
    // sub-agent：来自后端 loop_runs
    expect(subscribeAgentTaskMock).toHaveBeenCalledWith('t-sub1', expect.anything(), 0);
    // primary：来自 localStorage resumable task，走 subscribeAgentTask 而非重新提交
    expect(subscribeAgentTaskMock).toHaveBeenCalledWith('t-primary', expect.anything(), 0);
    expect(streamChatMock).not.toHaveBeenCalled();
    // 主 run 快照已登记 taskId 并进入 running（未重复创建 sub-agent 条目）
    expect(getConversationRunSnapshot('c1')).toMatchObject({ status: 'running', taskId: 't-primary' });
    expect(listSubAgentTasksForConversation('c1').map((t) => t.taskId)).toEqual(['t-sub1']);
  });

  it('无 resumable primary 时只恢复 sub-agent，不创建主 run', async () => {
    fetchLoopRunsMock.mockResolvedValue([
      { loopRunId: 'lr-sub1', projectId: 'project-1', conversationId: 'c1', loopStatus: 'running', kind: 'subagent', taskId: 't-sub1', parentLoopRunId: 'lr-primary' },
    ] as any);
    findResumableAgentTaskMock.mockReturnValue(null);

    await resumeOrphanAgentTasks('c1', 'project-1');

    expect(subscribeAgentTaskMock).toHaveBeenCalledTimes(1);
    expect(subscribeAgentTaskMock).toHaveBeenCalledWith('t-sub1', expect.anything(), 0);
    expect(getConversationRunSnapshot('c1')).toBeNull();
  });

  it('已有活跃主 run 时不重复恢复 primary（避免重复订阅）', async () => {
    fetchLoopRunsMock.mockResolvedValue([] as any);
    findResumableAgentTaskMock.mockReturnValue('t-primary');
    startConversationRun({
      conversationId: 'c1',
      projectId: 'project-1',
      userContent: '进行中',
      messages: [{ role: 'user', content: '进行中' }],
      context: { page: 'desktop-project', projectId: 'project-1' },
    });

    await resumeOrphanAgentTasks('c1', 'project-1');

    expect(subscribeAgentTaskMock).not.toHaveBeenCalled();
  });
});
