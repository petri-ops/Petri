// ============================================================
// UI-448 — composer 让位契约（单一输入面）。
//
// 悬浮面（SideChatDock）展开时，中栏 ownsCopilotAsk 实例的 composer
// 让位为提示条；悬挂面自身的 composer（非 owns 实例）不受影响。
// SimpleChat.tsx 里的接线是一条条件渲染
// `{suppressed ? <ComposerYieldHint/> : <composer/>}`，本文件钉住
// 判定纯函数与提示条组件的语义；接线若漂移由 CenterPanel/SideChatDock
// 契约与实机走查兜底（SimpleChat 全量挂载无单测先例，见
// SimpleChat.extraRenderers.test.tsx 头注）。
// ============================================================
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ComposerYieldHint,
  composerPlaceholder,
  COMPOSER_PLACEHOLDER_FULL,
  isComposerSuppressed,
} from './ComposerYield';

afterEach(cleanup);

describe('UI-448 isComposerSuppressed 判定', () => {
  it('仅「中栏 owns 实例 × 悬浮面展开」让位', () => {
    expect(isComposerSuppressed({ ownsCopilotAsk: true, dockOpen: true })).toBe(true);
    expect(isComposerSuppressed({ ownsCopilotAsk: true, dockOpen: false })).toBe(false);
    // 悬挂面自身是非 owns 实例：悬浮面展开时它必须照常可输入
    expect(isComposerSuppressed({ ownsCopilotAsk: false, dockOpen: true })).toBe(false);
    expect(isComposerSuppressed({ ownsCopilotAsk: false, dockOpen: false })).toBe(false);
  });
});

describe('UI-448 composerPlaceholder 窄面适配', () => {
  it('compact 档用短占位符（380px 悬浮面内不折行）', () => {
    expect(composerPlaceholder(true)).toBe('输入消息…');
    expect(composerPlaceholder(true)).not.toBe(COMPOSER_PLACEHOLDER_FULL);
  });

  it('缺省（中栏宽列）保持完整键位提示', () => {
    expect(composerPlaceholder(false)).toBe(COMPOSER_PLACEHOLDER_FULL);
    expect(composerPlaceholder()).toBe(COMPOSER_PLACEHOLDER_FULL);
  });
});

describe('UI-448 ComposerYieldHint', () => {
  it('渲染让位说明与「返回中栏输入」动作', () => {
    const onReturn = vi.fn();
    render(<ComposerYieldHint onReturnToCenter={onReturn} />);
    expect(screen.getByTestId('composer-yield-hint').textContent).toContain('侧边聊天');
    fireEvent.click(screen.getByRole('button', { name: '返回中栏输入' }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
