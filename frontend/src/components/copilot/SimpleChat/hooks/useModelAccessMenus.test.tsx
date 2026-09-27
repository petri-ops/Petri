// ============================================================
// UI-448 加映 v2 — 访问档位锁定契约（悬挂面仅聊天）。
//
// 悬挂聊天面（SideChatDock）锁 `read` 档：带着项目背景仅聊天，
// 写入/执行类工具被前后端双重拒绝（后端 agent-tool-policy 权威门）。
// 锁定语义落在 useModelAccessMenus：初始档位即锁定值、setAccessMode
// 失效（UI 选择器即使被触发也改不动档位）。
// ============================================================
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModelAccessMenus, type AccessMode } from './useModelAccessMenus';

afterEach(cleanup);

function Harness({ lockedAccessMode }: { lockedAccessMode?: AccessMode }): React.ReactElement {
  const ctrl = useModelAccessMenus({
    modelPresets: [],
    activeModelId: 'm1',
    setActiveModelId: vi.fn(async () => {}),
    lockedAccessMode,
  });
  return (
    <div>
      <span data-testid="mode">{ctrl.accessMode}</span>
      <span data-testid="label">{ctrl.accessModeLabel}</span>
      <button data-testid="to-full" onClick={() => ctrl.setAccessMode('full')}>full</button>
      <button data-testid="to-read" onClick={() => ctrl.setAccessMode('read')}>read</button>
    </div>
  );
}

describe('UI-448 加映 v2 useModelAccessMenus 锁档', () => {
  it('无锁定：缺省 full 档，可自由切换（中栏行为零变化）', () => {
    render(<Harness />);
    expect(screen.getByTestId('mode').textContent).toBe('full');
    fireEvent.click(screen.getByTestId('to-read'));
    expect(screen.getByTestId('mode').textContent).toBe('read');
    expect(screen.getByTestId('label').textContent).toBe('只读模式');
  });

  it('锁 read：初始即 read 档，setAccessMode 失效（选择器改不动）', () => {
    render(<Harness lockedAccessMode="read" />);
    expect(screen.getByTestId('mode').textContent).toBe('read');
    expect(screen.getByTestId('label').textContent).toBe('只读模式');
    fireEvent.click(screen.getByTestId('to-full'));
    expect(screen.getByTestId('mode').textContent).toBe('read');
  });
});
