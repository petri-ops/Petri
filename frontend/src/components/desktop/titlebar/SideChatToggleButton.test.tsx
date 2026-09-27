/**
 * UI-448 加映 v13 — SideChatToggleButton 契约。
 *
 * 侧边聊天入口从「中栏右缘浮动图标」迁入顶栏（摘要概览开关邻居）：
 * 点击开合 sideChatDockStore；侧聊 agent 运行中图标取在线色呼吸。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/copilot/conversationRunStore', () => ({
  isConversationRunning: (id: string | null | undefined) => id === 'conv_running',
}));

import { SideChatToggleButton } from './SideChatToggleButton';
import { getSideChatDockOpen, setSideChatDockOpen } from '@/hooks/sideChatDockStore';

const sideConvKey = 'gewu:side-chat-conv:p_1';

describe('UI-448 加映 v13 SideChatToggleButton', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSideChatDockOpen(false);
  });

  afterEach(() => {
    cleanup();
    setSideChatDockOpen(false);
  });

  it('点击开合：aria-pressed 与 store 同步', () => {
    render(<SideChatToggleButton projectId="p_1" />);
    const btn = screen.getByTestId('side-chat-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(getSideChatDockOpen()).toBe(true);
    expect(screen.getByTestId('side-chat-toggle').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('side-chat-toggle'));
    expect(getSideChatDockOpen()).toBe(false);
  });

  it('侧聊 agent 运行中：图标取 running 呼吸类', () => {
    window.localStorage.setItem(sideConvKey, 'conv_running');
    render(<SideChatToggleButton projectId="p_1" />);
    expect(screen.getByTestId('side-chat-toggle').className).toContain('sideChatRunning');
  });

  it('空闲或无侧聊会话：无 running 类', () => {
    window.localStorage.setItem(sideConvKey, 'conv_idle');
    render(<SideChatToggleButton projectId="p_1" />);
    expect(screen.getByTestId('side-chat-toggle').className).not.toContain('sideChatRunning');
    cleanup();
    render(<SideChatToggleButton projectId={null} />);
    expect(screen.getByTestId('side-chat-toggle').className).not.toContain('sideChatRunning');
  });

  it('store 外部开态（右栏 tab 入口）按钮呈按下态', () => {
    render(<SideChatToggleButton projectId="p_1" />);
    act(() => {
      setSideChatDockOpen(true);
    });
    expect(screen.getByTestId('side-chat-toggle').getAttribute('aria-pressed')).toBe('true');
  });
});
