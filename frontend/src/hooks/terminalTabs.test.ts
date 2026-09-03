import { describe, expect, it } from 'vitest';
import {
  MAX_TERMINAL_TABS,
  closeTerminalTab,
  createTerminalTab,
  terminalTabLabel,
  terminalTabSubtitle,
  type TerminalTab,
} from './terminalTabs';

function tab(id: string, seq: number, cwd?: string): TerminalTab {
  return { id, seq, cwd, exited: false };
}

describe('terminalTabs', () => {
  it('createTerminalTab: 首个 tab id/cwd/seq 正确', () => {
    const res = createTerminalTab([], '/tmp/proj-a');
    expect('limitReached' in res).toBe(false);
    if (!('limitReached' in res)) {
      expect(res.tab).toMatchObject({ id: 'tab-1', seq: 1, cwd: '/tmp/proj-a', exited: false });
      expect(res.tabs).toHaveLength(1);
    }
  });

  it('createTerminalTab: id 随 max(seq)+1 递增，永不复用旧 seq', () => {
    const first = createTerminalTab([tab('tab-1', 1), tab('tab-3', 3)], '/w');
    if (!('limitReached' in first)) {
      expect(first.tab.id).toBe('tab-4');
      expect(first.tab.seq).toBe(4);
      const second = createTerminalTab(first.tabs, '/w');
      if (!('limitReached' in second)) expect(second.tab.id).toBe('tab-5');
    }
  });

  it(`createTerminalTab: 达上限 ${MAX_TERMINAL_TABS} 个拒绝并保留原状态`, () => {
    const full = [
      tab('tab-1', 1),
      tab('tab-2', 2),
      tab('tab-3', 3),
      tab('tab-4', 4),
    ];
    const res = createTerminalTab(full, '/w');
    expect('limitReached' in res).toBe(true);
    if ('limitReached' in res) expect(res.tabs).toBe(full);
  });

  it('closeTerminalTab: 关闭中间 tab 优先激活右邻', () => {
    const res = closeTerminalTab([tab('tab-1', 1), tab('tab-2', 2), tab('tab-3', 3)], 'tab-2');
    expect(res.nextActiveId).toBe('tab-3');
    expect(res.tabs.map((t) => t.id)).toEqual(['tab-1', 'tab-3']);
  });

  it('closeTerminalTab: 关闭末位 tab 回退左邻；关闭最后一个得 null；未知 id 原样返回', () => {
    expect(closeTerminalTab([tab('tab-1', 1), tab('tab-2', 2)], 'tab-2').nextActiveId).toBe('tab-1');
    expect(closeTerminalTab([tab('tab-1', 1)], 'tab-1').nextActiveId).toBeNull();
    const same = [tab('tab-1', 1)];
    expect(closeTerminalTab(same, 'nope').tabs).toBe(same);
  });

  it('标签文案：seq 稳定不漂移；副标题取 cwd 基名', () => {
    expect(terminalTabLabel(tab('tab-3', 3))).toBe('终端 3');
    expect(terminalTabSubtitle(tab('tab-1', 1, '/Users/x/BioF3-workspace/desktop'))).toBe('desktop');
    expect(terminalTabSubtitle(tab('tab-1', 1, 'C:\\data\\proj'))).toBe('proj');
    expect(terminalTabSubtitle(tab('tab-1', 1))).toBe('');
  });
});
