// BLOCK-244 Q1-REM — 每轮 checkpoint 登记契约。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkpointCreate = vi.fn();
vi.mock('@/lib/desktopBridge', () => ({
  getBridge: () => ({ checkpointCreate }),
}));

import { createTurnCheckpoint, findTurnCheckpoint, recordTurnCheckpoint } from './turn-checkpoints';

describe('turn-checkpoints（BLOCK-244 C5）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    checkpointCreate.mockReset();
  });

  it('记录/查找同会话同文本快照，不同文本不命中', () => {
    recordTurnCheckpoint('c1', '分析数据', 'ref-1');
    expect(findTurnCheckpoint('c1', '分析数据')?.ref).toBe('ref-1');
    expect(findTurnCheckpoint('c1', '另一句')).toBeNull();
    expect(findTurnCheckpoint('c2', '分析数据')).toBeNull();
  });

  it('createTurnCheckpoint 成功登记；created:false/失败不登记', async () => {
    checkpointCreate.mockResolvedValueOnce({ ok: true, data: { created: true, ref: 'ref-2' } });
    const ref = await createTurnCheckpoint({ projectId: 'p1', conversationId: 'c1', text: 'hello' });
    expect(ref).toBe('ref-2');
    expect(findTurnCheckpoint('c1', 'hello')?.ref).toBe('ref-2');

    checkpointCreate.mockResolvedValueOnce({ ok: true, data: { created: false, ref: null } });
    expect(await createTurnCheckpoint({ projectId: 'p1', conversationId: 'c1', text: 'clean' })).toBeNull();
    expect(findTurnCheckpoint('c1', 'clean')).toBeNull();
  });

  it('缺少项目/会话时不调用桥', async () => {
    expect(await createTurnCheckpoint({ projectId: null, conversationId: 'c1', text: 'x' })).toBeNull();
    expect(checkpointCreate).not.toHaveBeenCalled();
  });
});
