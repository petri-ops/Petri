/** item89 HK-01：A 会话→B 会话切换后，文件面板根目录绑定到 B 项目。 */
import { describe, expect, it } from 'vitest';
import { resolveActiveConversationId, writeConversationPreselect, consumeConversationPreselect } from './conversationSelection';

const conversations = [
  { id: 'conv-b1', project_id: 'p-b' },
  { id: 'conv-b2', project_id: 'p-b' },
];

describe('item89 会话切换项目上下文', () => {
  it('HK-01 旧项目会话 id 不得挡住新项目预选', () => {
    const resolved = resolveActiveConversationId({
      projectId: 'p-b',
      conversations,
      activeConvId: 'conv-a1',
      preselectedConversationId: 'conv-b2',
    });
    expect(resolved.conversationId).toBe('conv-b2');
    expect(resolved.projectId).toBe('p-b');
  });

  it('HK-01 新项目内已有合法会话则保持；无预选回落首条', () => {
    expect(resolveActiveConversationId({
      projectId: 'p-b', conversations, activeConvId: 'conv-b1', preselectedConversationId: null,
    }).conversationId).toBe('conv-b1');
    expect(resolveActiveConversationId({
      projectId: 'p-b', conversations, activeConvId: null, preselectedConversationId: null,
    }).conversationId).toBe('conv-b1');
  });

  it('HK-01 跨项目点击写入的 preselect 可一次性消费，随后不残留', () => {
    writeConversationPreselect('conv-b2');
    expect(consumeConversationPreselect()).toBe('conv-b2');
    expect(consumeConversationPreselect()).toBeNull();
  });
});
