import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cancelAgentTaskMock, streamChatMock, subscribeAgentTaskMock, fetchLoopRunsMock, findResumableAgentTaskMock, resumeAgentTaskMock } = vi.hoisted(() => ({
  cancelAgentTaskMock: vi.fn(),
  streamChatMock: vi.fn(),
  subscribeAgentTaskMock: vi.fn(),
  fetchLoopRunsMock: vi.fn(),
  findResumableAgentTaskMock: vi.fn(),
  resumeAgentTaskMock: vi.fn(),
}));

vi.mock('./copilotClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('./copilotClient')>();
  return {
    ...original,
    cancelAgentTask: cancelAgentTaskMock,
    findResumableAgentTask: findResumableAgentTaskMock,
    resumeAgentTask: resumeAgentTaskMock,
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
  __resetConversationTodosForTests,
  __resetConversationCitationsForTests,
  getConversationCitations,
  clearConversationRun,
  getConversationRunSnapshot,
  getConversationTodoList,
  getSubAgentTaskSnapshot,
  listSubAgentTasksForConversation,
  resultEditProgressForContext,
  resumeInterruptedConversation,
  shouldClearReconciledConversationRun,
  getChildFinishedNotices,
  startConversationRun,
  startSubAgentTask,
  stopConversationRun,
  stopSubAgentTask,
  subscribeConversationRun,
  resumeSubAgentTasks,
  resumeOrphanAgentTasks,
} from './conversationRunStore';
import { gewuEvents, subscribeGewuEvent } from '@/lib/events';
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
    resumeAgentTaskMock.mockReset();
    subscribeAgentTaskMock.mockReset();
    subscribeAgentTaskMock.mockResolvedValue(undefined);
    findResumableAgentTaskMock.mockReset();
    fetchLoopRunsMock.mockReset();
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

  it('BLOCK-39: 断线重连期间显示重连提示，后续增量到达后清理', () => {
    start('conversation-reconnect', 'run a long task');
    const callbacks = streamChatMock.mock.calls[0][0];
    callbacks.onStreamReconnecting?.({ taskId: 't-1', attempt: 2, lastSeq: 5, nextRetryMs: 4000 });
    expect(getConversationRunSnapshot('conversation-reconnect')).toMatchObject({
      status: 'running',
      statusMessage: '与任务失去连接，正在重连（第 2 次）…',
    });
    callbacks.onDelta('back online');
    expect(getConversationRunSnapshot('conversation-reconnect')?.statusMessage).toBeUndefined();
  });

  it('BLOCK-56 P1: 请求级降级事件记录一次性提示且任务保持运行', () => {
    start('conversation-fallback-note', 'run with fallback');
    const callbacks = streamChatMock.mock.calls[0][0];
    callbacks.onModelFallback?.({ scope: 'request_level', toProfileLabel: '备用模型B', message: '已降级到「备用模型B」继续' });
    const run = getConversationRunSnapshot('conversation-fallback-note');
    expect(run).toMatchObject({
      status: 'running',
      modelFallbackNotice: '已降级到「备用模型B」继续',
      statusMessage: '已降级到「备用模型B」继续',
      assistantPending: true,
    });
    // 一次性提示：后续重复事件不覆盖已有 notice
    callbacks.onModelFallback?.({ scope: 'request_level', toProfileLabel: '备用模型C', message: '已降级到「备用模型C」继续' });
    expect(getConversationRunSnapshot('conversation-fallback-note')?.modelFallbackNotice).toBe('已降级到「备用模型B」继续');
  });

  it('BLOCK-56 P1: 任务级降级无缝切换订阅新 task，不进入 error 终态', async () => {
    start('conversation-fallback-switch', 'run with task fallback');
    const callbacks = streamChatMock.mock.calls[0][0];
    callbacks.onTaskStarted?.('task-old');
    expect(getConversationRunSnapshot('conversation-fallback-switch')?.taskId).toBe('task-old');

    callbacks.onError?.(new Error('The server is overloaded'), {
      fallbackTaskId: 'task-new',
      fallbackLabel: '备用模型B',
    });
    // await 微任务队列，让内部 subscribeAgentTask 拉起
    await Promise.resolve();
    await Promise.resolve();

    const run = getConversationRunSnapshot('conversation-fallback-switch');
    expect(run).toMatchObject({
      status: 'running',
      taskId: 'task-new',
      resumeOfTaskId: 'task-old',
      modelFallbackNotice: '模型服务异常，已自动降级到「备用模型B」继续执行',
      assistantPending: true,
    });
    // 订阅切换到新 task，且续跑内容继续渲染到同一会话
    expect(subscribeAgentTaskMock).toHaveBeenCalledWith(
      'task-new',
      expect.objectContaining({ conversationId: 'conversation-fallback-switch' }),
      0
    );
    const subCallbacks = subscribeAgentTaskMock.mock.calls[0][1];
    subCallbacks.onDelta?.('resumed output');
    expect(getConversationRunSnapshot('conversation-fallback-switch')?.assistantContent).toBe('resumed output');
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

  it('buckets reasoning deltas by iteration (UI-272)', () => {
    start('conversation-r', 'verify the pipeline');
    const callbacks = streamChatMock.mock.calls[0][0];

    callbacks.onIter(1);
    callbacks.onReasoning?.('先确认目录结构，');
    callbacks.onReasoning?.('再查入口文件');
    callbacks.onIter(2);
    callbacks.onReasoning?.('第二轮：检查输出格式');

    const snapshot = getConversationRunSnapshot('conversation-r');
    expect(snapshot?.reasoningByIteration).toEqual({
      1: '先确认目录结构，再查入口文件',
      2: '第二轮：检查输出格式',
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
    const unsubscribe = subscribeGewuEvent(gewuEvents.projectWorkspaceChanged, (detail) => {
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
    const unsubscribe = subscribeGewuEvent(gewuEvents.projectOpenResult, (detail) => {
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
  // BLOCK-38 P2 — 中断续跑：resumable 标记透传 + resume action 链路
  // ---------------------------------------------------------------------------

  it('BLOCK-38: interrupted error marks the run resumable; plain error stays non-resumable', () => {
    start('conversation-b38a', 'long running job');
    const callbacksA = streamChatMock.mock.calls[0][0];
    callbacksA.onTaskStarted('task-b38-a');
    callbacksA.onError(new Error('服务重启，Agent 任务中断'), {
      resumable: true,
      interruptedAt: '2026-09-02T12:00:00.000Z',
    });
    expect(getConversationRunSnapshot('conversation-b38a')).toMatchObject({
      status: 'error',
      resumable: true,
      interruptedAt: '2026-09-02T12:00:00.000Z',
      taskId: 'task-b38-a',
    });

    start('conversation-b38b', 'plain failure');
    const callbacksB = streamChatMock.mock.calls[1][0];
    callbacksB.onTaskStarted('task-b38-b');
    callbacksB.onError(new Error('模型上游错误'));
    expect(getConversationRunSnapshot('conversation-b38b')).toMatchObject({
      status: 'error',
      resumable: false,
    });
  });

  it('BLOCK-38: resume action calls the endpoint with the interrupted taskId and subscribes the new task', async () => {
    start('conversation-b38c', 'resume me');
    const callbacks = streamChatMock.mock.calls[0][0];
    callbacks.onTaskStarted('task-b38-old');
    callbacks.onError(new Error('服务重启，Agent 任务中断'), {
      resumable: true,
      interruptedAt: '2026-09-02T12:30:00.000Z',
    });

    resumeAgentTaskMock.mockResolvedValue({
      taskId: 'task-b38-new',
      conversationId: 'conversation-b38c',
      resumeOfTaskId: 'task-b38-old',
      interruptedAt: '2026-09-02T12:30:00.000Z',
      lastModelCall: null,
    });

    const newTaskId = await resumeInterruptedConversation('conversation-b38c', 'project-1');
    expect(newTaskId).toBe('task-b38-new');
    expect(resumeAgentTaskMock).toHaveBeenCalledWith('task-b38-old');

    // 新 run 携带审计链（resumeOfTaskId = 原 taskId），非中断失败不残留 resumable
    const snapshot = getConversationRunSnapshot('conversation-b38c');
    expect(snapshot?.resumeOfTaskId).toBe('task-b38-old');
    expect(snapshot?.resumable ?? false).toBe(false);
    expect(snapshot?.status).toBe('running');
    expect(subscribeAgentTaskMock).toHaveBeenCalledWith(
      'task-b38-new',
      expect.objectContaining({ conversationId: 'conversation-b38c' }),
      0
    );
  });

  it('BLOCK-38: resume action refuses when the run is not resumable', async () => {
    start('conversation-b38d', 'plain failure');
    streamChatMock.mock.calls[0][0].onTaskStarted('task-b38-d');
    streamChatMock.mock.calls[0][0].onError(new Error('模型上游错误'));
    await expect(resumeInterruptedConversation('conversation-b38d', 'project-1')).rejects.toThrow(
      '当前会话没有可续跑的中断任务'
    );
    expect(resumeAgentTaskMock).not.toHaveBeenCalled();
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


describe('BLOCK-49 加映 — 子 agent 终态通知（proactive child_finished）', () => {
  it('child_finished 事件累计为会话级 notice（多条保序）', () => {
    start('conv-child-finished', 'run with sub agents');
    const callbacks = streamChatMock.mock.calls.at(-1)![0];
    callbacks.onChildFinished?.({ childTaskId: 'child-a', status: 'completed', summaryHead: '任务 A 完成' });
    callbacks.onChildFinished?.({ childTaskId: 'child-b', status: 'failed', summaryHead: '任务 B 失败原因' });

    const notices = getChildFinishedNotices('conv-child-finished');
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({ childTaskId: 'child-a', status: 'completed' });
    expect(notices[1]).toMatchObject({ childTaskId: 'child-b', status: 'failed' });
  });

  it('新 run 开始时 notice 清除（会话级生命周期）', () => {
    start('conv-child-clear', 'first run');
    streamChatMock.mock.calls.at(-1)![0].onChildFinished?.({
      childTaskId: 'child-x', status: 'completed', summaryHead: 'X',
    });
    expect(getChildFinishedNotices('conv-child-clear')).toHaveLength(1);

    // 首轮 run 结束后再开新 run（运行中守卫会拒绝并发 start）
    stopConversationRun('conv-child-clear');
    start('conv-child-clear', 'second run');
    expect(getChildFinishedNotices('conv-child-clear')).toHaveLength(0);
  });

  it('超过 10 条丢弃最旧（上限保护）', () => {
    start('conv-child-cap', 'run with many children');
    const callbacks = streamChatMock.mock.calls.at(-1)![0];
    for (let i = 0; i < 12; i++) {
      callbacks.onChildFinished?.({ childTaskId: `child-${i}`, status: 'completed', summaryHead: String(i) });
    }
    const notices = getChildFinishedNotices('conv-child-cap');
    expect(notices).toHaveLength(10);
    expect(notices[0].childTaskId).toBe('child-2');
    expect(notices.at(-1)?.childTaskId).toBe('child-11');
  });

  it('缺 childTaskId 的事件忽略（防御）', () => {
    start('conv-child-defensive', 'run');
    streamChatMock.mock.calls.at(-1)![0].onChildFinished?.({ childTaskId: '', status: 'completed', summaryHead: '' });
    expect(getChildFinishedNotices('conv-child-defensive')).toHaveLength(0);
  });
});


describe('BLOCK-49 加映二 — 模型派生子 agent 活动面板数据源', () => {
  it('spawn_agent 工具结果 → 登记 running 快照（面板列表可见）', () => {
    start('conv-panel-spawn', 'spawn a sub agent');
    const callbacks = streamChatMock.mock.calls.at(-1)![0];
    callbacks.onToolCall?.({
      name: 'spawn_agent',
      args: { task: '整理实验数据并输出摘要' },
      callId: 'call-spawn-1',
    });
    callbacks.onToolResult?.({
      name: 'spawn_agent',
      summary: '已派生',
      toolResult: {
        contractVersion: '1.0.0',
        traceId: 'tr-1',
        callId: 'call-spawn-1',
        tool: 'spawn_agent',
        status: 'success',
        terminationReason: 'completed',
        durationMs: 12,
        truncated: false,
        sideEffects: { type: 'state-write', riskTier: 'R2', resources: [] },
        data: { ok: true, agentId: 'agent-panel-1' },
      },
    } as never);

    const list = listSubAgentTasksForConversation('conv-panel-spawn');
    const entry = list.find((t) => t.taskId === 'agent-panel-1');
    expect(entry).toBeTruthy();
    expect(entry?.status).toBe('running');
    expect(entry?.userContent).toContain('整理实验数据');
  });

  it('child_finished → 终态落账（done + 摘要），面板行更新', () => {
    start('conv-panel-settle', 'spawn and settle');
    const callbacks = streamChatMock.mock.calls.at(-1)![0];
    callbacks.onToolCall?.({
      name: 'spawn_agent',
      args: { task: '分析数据' },
      callId: 'call-spawn-2',
    });
    callbacks.onToolResult?.({
      name: 'spawn_agent',
      summary: '已派生',
      toolResult: {
        contractVersion: '1.0.0',
        traceId: 'tr-2',
        callId: 'call-spawn-2',
        tool: 'spawn_agent',
        status: 'success',
        terminationReason: 'completed',
        durationMs: 5,
        truncated: false,
        sideEffects: { type: 'state-write', riskTier: 'R2', resources: [] },
        data: { ok: true, agentId: 'agent-panel-2' },
      },
    } as never);
    callbacks.onChildFinished?.({
      childTaskId: 'agent-panel-2',
      status: 'completed',
      summaryHead: '数据分析完成：共 3 条结论',
    });

    const entry = listSubAgentTasksForConversation('conv-panel-settle')
      .find((t) => t.taskId === 'agent-panel-2');
    expect(entry?.status).toBe('done');
    expect(entry?.assistantContent).toContain('3 条结论');
    expect(entry?.assistantPending).toBe(false);
  });

  it('页面刷新场景：无登记的 child_finished 也会建终态条目', () => {
    start('conv-panel-orphans', 'run');
    streamChatMock.mock.calls.at(-1)![0].onChildFinished?.({
      childTaskId: 'agent-orphan-1',
      status: 'failed',
      summaryHead: '任务失败原因',
    });
    const entry = listSubAgentTasksForConversation('conv-panel-orphans')
      .find((t) => t.taskId === 'agent-orphan-1');
    expect(entry?.status).toBe('error');
    expect(entry?.assistantContent).toContain('任务失败原因');
  });

  it('终态幂等：重复 child_finished 不覆盖已有终态', () => {
    start('conv-panel-idem', 'run');
    const callbacks = streamChatMock.mock.calls.at(-1)![0];
    callbacks.onChildFinished?.({
      childTaskId: 'agent-idem-1', status: 'completed', summaryHead: '第一次',
    });
    callbacks.onChildFinished?.({
      childTaskId: 'agent-idem-1', status: 'failed', summaryHead: '第二次',
    });
    const entry = listSubAgentTasksForConversation('conv-panel-idem')
      .find((t) => t.taskId === 'agent-idem-1');
    expect(entry?.assistantContent).toBe('第一次');
  });
});

// ---------------------------------------------------------------------------
// BLOCK-97: task_todo 任务清单投影
// ---------------------------------------------------------------------------

describe('BLOCK-97 task_todo projection (conversation-level store)', () => {
  beforeEach(() => {
    __resetConversationRunsForTests();
    __resetConversationTodosForTests();
    streamChatMock.mockReset();
    streamChatMock.mockResolvedValue(undefined);
  });

  it('projects task_todo snapshots into the conversation todo store, replacing wholesale', () => {
    start('conv-todo', '做多步任务');
    const callbacks = streamChatMock.mock.calls[0][0];

    callbacks.onTaskTodo?.([
      { id: '1', content: '重建索引', status: 'completed' },
      { id: '2', content: '跑通冒烟测试', status: 'in_progress' },
    ]);
    expect(getConversationTodoList('conv-todo')).toEqual([
      { id: '1', content: '重建索引', status: 'completed' },
      { id: '2', content: '跑通冒烟测试', status: 'in_progress' },
    ]);

    // 整单幂等替换：新快照整体覆盖，不合并
    callbacks.onTaskTodo?.([
      { id: '1', content: '重建索引', status: 'completed' },
      { id: '2', content: '跑通冒烟测试', status: 'completed' },
      { id: '3', content: '写收口报告', status: 'pending' },
    ]);
    expect(getConversationTodoList('conv-todo').length).toBe(3);
    expect(
      getConversationTodoList('conv-todo').every((it) => it.status !== 'in_progress')
    ).toBe(true);
  });

  it('survives run stop/reconciliation; clears only when the next run starts', () => {
    start('conv-todo-2', '第一轮');
    streamChatMock.mock.calls[0][0].onTaskTodo?.([
      { id: '1', content: '旧清单', status: 'completed' },
    ]);
    expect(getConversationTodoList('conv-todo-2').length).toBe(1);

    // run 终态/对账清理快照后，末次清单仍可见（「做完一条勾一条」不闪没）
    stopConversationRun('conv-todo-2');
    clearConversationRun('conv-todo-2');
    expect(getConversationRunSnapshot('conv-todo-2')).toBeNull();
    expect(getConversationTodoList('conv-todo-2').length).toBe(1);

    // 下一轮 run 开始 → 清除（生命周期=单次 agent 任务运行）
    start('conv-todo-2', '第二轮');
    expect(getConversationTodoList('conv-todo-2')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BLOCK-94 / UI-402: knowledge_citations 知识溯源投影
// ---------------------------------------------------------------------------

describe('BLOCK-94 knowledge_citations projection (conversation-level store)', () => {
  beforeEach(() => {
    __resetConversationRunsForTests();
    __resetConversationCitationsForTests();
    streamChatMock.mockReset();
    streamChatMock.mockResolvedValue(undefined);
  });

  it('projects knowledge_citations into the conversation store, replacing wholesale', () => {
    start('conv-cite', '这段结论哪来的');
    const callbacks = streamChatMock.mock.calls[0][0];

    callbacks.onKnowledgeCitations?.({
      citations: [
        { docId: 'kdoc_a', docName: '基因笔记.md', seq: 0, channels: { vector: 0.82 } },
        { docId: 'kdoc_b', docName: '方案.pdf', seq: 2, channels: { fts: 1 } },
      ],
    });
    expect(getConversationCitations('conv-cite')).toHaveLength(2);
    expect(getConversationCitations('conv-cite')[0]).toMatchObject({ docName: '基因笔记.md', seq: 0 });

    // 整单替换：下一轮注入覆盖上一轮
    callbacks.onKnowledgeCitations?.({
      citations: [{ docId: 'kdoc_c', docName: '新文档.md', seq: 1, channels: {} }],
    });
    expect(getConversationCitations('conv-cite')).toHaveLength(1);
    expect(getConversationCitations('conv-cite')[0]?.docName).toBe('新文档.md');
  });

  it('survives run stop/reconciliation; clears only when the next run starts', () => {
    start('conv-cite-2', '第一轮');
    streamChatMock.mock.calls[0][0].onKnowledgeCitations?.({
      citations: [{ docName: '旧文档', seq: 0 }],
    });
    expect(getConversationCitations('conv-cite-2')).toHaveLength(1);

    // run 终态/对账清理快照后，末次溯源仍可见（「这段结论哪来的」可持续对照）
    stopConversationRun('conv-cite-2');
    clearConversationRun('conv-cite-2');
    expect(getConversationRunSnapshot('conv-cite-2')).toBeNull();
    expect(getConversationCitations('conv-cite-2')).toHaveLength(1);

    // 下一轮 run 开始 → 清除（生命周期=单次 agent 任务运行）
    start('conv-cite-2', '第二轮');
    expect(getConversationCitations('conv-cite-2')).toEqual([]);
  });

  it('defends against malformed citations (filters non-object entries)', () => {
    start('conv-cite-3', 'run');
    const callbacks = streamChatMock.mock.calls[0][0];
    callbacks.onKnowledgeCitations?.({
      citations: [
        { docName: 'ok.md', seq: 0 },
        null,
        'garbage',
        { seq: 'not-a-number' },
      ],
    } as never);
    expect(getConversationCitations('conv-cite-3')).toHaveLength(1);
  });
});
