/**
 * 试用反馈⑫续（owner msg_67a61cb96b68）：copyText 必须优先走主进程 IPC clipboard。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeClipboard = vi.fn(() => Promise.resolve(true));
vi.mock('@/lib/desktopBridge', () => ({ getBridge: (name: string) => name === 'app' ? { writeClipboard } : null }));
vi.mock('@/lib/authClient', () => ({ getPlatformApiPrefix: () => 'http://localhost:3001/api', getToken: () => '' }));

import { copyText } from './conversationActions';

beforeEach(() => { writeClipboard.mockClear(); });

describe('copyText（主进程 IPC 根治）', () => {
  it('Electron 环境优先走 app.writeClipboard IPC，不再依赖 navigator.clipboard', async () => {
    const navWrite = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: navWrite }, configurable: true });
    expect(await copyText('conv-123')).toBe(true);
    expect(writeClipboard).toHaveBeenCalledWith('conv-123');
    expect(navWrite).not.toHaveBeenCalled();
  });

  it('IPC 返回 false（写失败）如实返回 false，不冒充成功', async () => {
    writeClipboard.mockImplementationOnce(() => Promise.resolve(false));
    expect(await copyText('x')).toBe(false);
  });


});
