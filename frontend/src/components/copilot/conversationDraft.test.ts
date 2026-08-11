import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadConversationDraft,
  migrateConversationDraft,
  saveConversationDraft,
} from './conversationDraft';

describe('UI-150 composer draft migration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('moves a new-conversation draft to the created conversation key', () => {
    saveConversationDraft('project-1', null, '请运行差异分析');

    migrateConversationDraft('project-1', null, 'conversation-1');

    expect(loadConversationDraft('project-1', null)).toBe('');
    expect(loadConversationDraft('project-1', 'conversation-1')).toBe('请运行差异分析');
  });

  it('keeps an existing target draft instead of overwriting it', () => {
    saveConversationDraft('project-1', null, '旧草稿');
    saveConversationDraft('project-1', 'conversation-1', '新会话已有草稿');

    migrateConversationDraft('project-1', null, 'conversation-1');

    expect(loadConversationDraft('project-1', null)).toBe('');
    expect(loadConversationDraft('project-1', 'conversation-1')).toBe('新会话已有草稿');
  });
});
