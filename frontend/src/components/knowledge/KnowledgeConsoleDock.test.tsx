// BLOCK-103 P4 — KnowledgeConsoleDock 组件定向测试
// KnowledgeConsoleChat 内部 mock（其能力面归 BLOCK-99 契约）；此处只验
// 把手开合 / overlay 挂载 / Esc 收起 / localStorage 记忆四个交互语义。

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./KnowledgeConsoleChat', () => ({
  KnowledgeConsoleChat: () => <div data-testid="knowledge-console">console-mock</div>,
}));

import { KnowledgeConsoleDock } from './KnowledgeConsoleDock';

function renderDock(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <KnowledgeConsoleDock />
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BLOCK-103 KnowledgeConsoleDock', () => {
  it('默认收起：把手常驻，会话台不挂载', () => {
    renderDock();
    expect(screen.getByTestId('knowledge-console-handle')).toBeTruthy();
    expect(screen.queryByTestId('knowledge-console')).toBeNull();
  });

  it('点击把手展开 overlay（localStorage 记忆 =1），再点收起（=0）', () => {
    renderDock();
    const handle = screen.getByTestId('knowledge-console-handle');
    fireEvent.click(handle);
    expect(screen.getByTestId('knowledge-console-surface')).toBeTruthy();
    expect(screen.getByTestId('knowledge-console')).toBeTruthy();
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    expect(window.localStorage.getItem('petri.knowledgeConsoleOpen')).toBe('1');
    fireEvent.click(handle);
    expect(screen.queryByTestId('knowledge-console')).toBeNull();
    expect(window.localStorage.getItem('petri.knowledgeConsoleOpen')).toBe('0');
  });

  it('Esc 收起展开态', () => {
    renderDock();
    fireEvent.click(screen.getByTestId('knowledge-console-handle'));
    expect(screen.getByTestId('knowledge-console-surface')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('knowledge-console')).toBeNull();
  });

  it('localStorage=1 时初始展开（记忆恢复）', () => {
    window.localStorage.setItem('petri.knowledgeConsoleOpen', '1');
    renderDock();
    expect(screen.getByTestId('knowledge-console')).toBeTruthy();
  });
});
