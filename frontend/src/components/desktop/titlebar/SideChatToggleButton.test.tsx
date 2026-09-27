/**
 * UI-448 加映 v15 — SideChatToggleButton 契约（摘要按钮同机制）。
 *
 * 开关并入壳状态 useWorkspacePanelsContext：点击 toggleSideChat、
 * aria-pressed 镜像 sideChatOpen——与摘要概览开关完全同一套代码路径。
 * 运行呼吸：侧聊 agent 运行中图标取在线色。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/copilot/conversationRunStore', () => ({
  isConversationRunning: (id: string | null | undefined) => id === 'conv_running',
}));

const panelsState = vi.hoisted(() => ({
  sideChatOpen: false,
  toggleSideChat: vi.fn(function (this: void) {
    panelsState.sideChatOpen = !panelsState.sideChatOpen;
  }),
}));

vi.mock('@/components/desktop/WorkspacePanelsContext', () => ({
  useWorkspacePanelsContext: () => panelsState,
}));

import { SideChatToggleButton } from './SideChatToggleButton';

beforeEach(() => {
  panelsState.sideChatOpen = false;
  panelsState.toggleSideChat.mockClear();
});

afterEach(cleanup);

describe('UI-448 加映 v15 SideChatToggleButton（摘要按钮同机制）', () => {
  it('点击 toggleSideChat；aria-pressed 镜像开态', () => {
    panelsState.sideChatOpen = false;
    render(<SideChatToggleButton projectId="p_1" />);
    const btn = screen.getByTestId('side-chat-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(panelsState.toggleSideChat).toHaveBeenCalledTimes(1);
    // mock 的 state 翻转后重渲染镜像开态（真实树由 context 供值）
    panelsState.sideChatOpen = true;
    cleanup();
    render(<SideChatToggleButton projectId="p_1" />);
    expect(screen.getByTestId('side-chat-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('侧聊 agent 运行中：图标取 running 呼吸类', () => {
    window.localStorage.setItem('gewu:side-chat-conv:p_1', 'conv_running');
    render(<SideChatToggleButton projectId="p_1" />);
    expect(screen.getByTestId('side-chat-toggle').className).toContain('sideChatRunning');
  });

  it('空闲或无侧聊会话：无 running 类', () => {
    window.localStorage.setItem('gewu:side-chat-conv:p_1', 'conv_idle');
    render(<SideChatToggleButton projectId="p_1" />);
    expect(screen.getByTestId('side-chat-toggle').className).not.toContain('sideChatRunning');
    cleanup();
    render(<SideChatToggleButton projectId={null} />);
    expect(screen.getByTestId('side-chat-toggle').className).not.toContain('sideChatRunning');
  });
});
