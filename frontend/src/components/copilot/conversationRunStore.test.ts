import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cancelAgentTaskMock, streamChatMock } = vi.hoisted(() => ({
  cancelAgentTaskMock: vi.fn(),
  streamChatMock: vi.fn(),
}));

vi.mock('./copilotClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('./copilotClient')>();
  return {
    ...original,
    cancelAgentTask: cancelAgentTaskMock,
    streamChat: streamChatMock,
  };
});

import {
  __resetConversationRunsForTests,
  getConversationRunSnapshot,
  startConversationRun,
  stopConversationRun,
  subscribeConversationRun,
} from './conversationRunStore';
import { biof3Events, subscribeBioF3Event } from '@/lib/events';

function start(conversationId: string, userContent: string): void {
  startConversationRun({
    conversationId,
    projectId: 'project-1',
    userContent,
    messages: [{ role: 'user', content: userContent }],
    context: { page: 'desktop-project', projectId: 'project-1' },
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
    });
    expect(getConversationRunSnapshot('conversation-a')?.toolActivities).toHaveLength(1);
    expect(cancelAgentTaskMock).toHaveBeenCalledWith('task-1');
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
});
