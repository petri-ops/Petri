import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { streamChatMock } = vi.hoisted(() => ({ streamChatMock: vi.fn() }));

vi.mock('./copilotClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('./copilotClient')>();
  return { ...original, streamChat: streamChatMock };
});

import {
  __resetConversationRunsForTests,
  getConversationRunSnapshot,
  startConversationRun,
  subscribeConversationRun,
} from './conversationRunStore';

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
});
