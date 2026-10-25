// BLOCK-246 C4 — 消息动作注册表：顺序/状态/禁用理由/评价切换语义。
import { describe, expect, it } from 'vitest';
import type { IconName } from '@/components/icons/Icon';
import {
  buildAssistantMessageActions,
  buildMessageActions,
  buildUserMessageActions,
  nextRating,
  type MessageActionInput,
} from './messageActions';

function input(overrides: Partial<MessageActionInput> = {}): MessageActionInput {
  return {
    role: 'assistant',
    hasContent: true,
    pending: false,
    streaming: false,
    forking: false,
    copied: false,
    rating: null,
    ...overrides,
  };
}

describe('buildAssistantMessageActions', () => {
  it('keeps the existing action order and appends 加入上下文 + 统计 + 评价', () => {
    const ids = buildAssistantMessageActions(input()).map((action) => action.id);
    expect(ids).toEqual(['copy', 'regenerate', 'fork', 'quote-context', 'stats', 'rate-up', 'rate-down']);
  });

  it('carries state into labels and disabled reasons', () => {
    const specs = buildAssistantMessageActions(input({ copied: true, forking: true, streaming: true }));
    expect(specs.find((spec) => spec.id === 'copy')!.label).toBe('已复制');
    expect(specs.find((spec) => spec.id === 'fork')!.label).toBe('创建中…');
    expect(specs.find((spec) => spec.id === 'fork')!.disabled).toBe(true);
    const regenerate = specs.find((spec) => spec.id === 'regenerate')!;
    expect(regenerate.disabled).toBe(true);
    expect(regenerate.title).toContain('正在生成中');
  });

  it('marks the pressed rating and offers undo wording', () => {
    const specs = buildAssistantMessageActions(input({ rating: 'up' }));
    const up = specs.find((spec) => spec.id === 'rate-up')!;
    expect(up.pressed).toBe(true);
    expect(up.label).toBe('已赞');
    expect(up.title).toContain('取消');
    expect(specs.find((spec) => spec.id === 'rate-down')!.pressed).toBe(false);
  });

  it('renders no actions for pending or empty messages', () => {
    expect(buildAssistantMessageActions(input({ pending: true }))).toEqual([]);
    expect(buildAssistantMessageActions(input({ hasContent: false }))).toEqual([]);
  });

  it('uses only icon names that exist in the icon set', () => {
    const names: IconName[] = buildAssistantMessageActions(input()).map((spec) => spec.icon);
    expect(names).toContain('layers');
    expect(names).toContain('git-branch');
    expect(names).toContain('bar-chart');
  });

  it('统计按钮随面板开合切换文案与按下态', () => {
    const closed = buildAssistantMessageActions(input()).find((spec) => spec.id === 'stats')!;
    expect(closed.label).toBe('统计');
    expect(closed.pressed).toBe(false);
    const open = buildAssistantMessageActions(input({ statsOpen: true })).find((spec) => spec.id === 'stats')!;
    expect(open.label).toBe('收起统计');
    expect(open.pressed).toBe(true);
    expect(open.title).toContain('耗时');
  });
});

describe('buildUserMessageActions', () => {
  it('keeps the single edit action with its divider', () => {
    const specs = buildUserMessageActions(input({ role: 'user' }));
    expect(specs.map((spec) => spec.id)).toEqual(['edit']);
    expect(specs[0].dividerAfter).toBe(true);
    expect(specs[0].title).toContain('回退');
  });

  it('hides for pending user messages (run projection)', () => {
    expect(buildUserMessageActions(input({ role: 'user', pending: true }))).toEqual([]);
  });
});

describe('buildMessageActions / nextRating', () => {
  it('routes by role', () => {
    expect(buildMessageActions(input({ role: 'user' })).map((spec) => spec.id)).toEqual(['edit']);
    expect(buildMessageActions(input()).length).toBe(7);
  });

  it('toggles: same side clears, other side switches', () => {
    expect(nextRating(null, 'up')).toBe('up');
    expect(nextRating('up', 'up')).toBeNull();
    expect(nextRating('up', 'down')).toBe('down');
  });
});
