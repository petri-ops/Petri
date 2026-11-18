import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// BLOCK-466（W11 P3）— 流式渲染接线契约：流式 assistant 消息里的 ::compose 在
// spec 完整前渲染稳定占位（compose-stream-pending），不把原始 JSON 泄漏到正文；
// 完成态（streaming=false）渲染 ComposeCard。观感 pending_human_eye 不代签。

vi.mock('../copilotMarkdown', () => ({
  CopilotMarkdown: (props: { text: string }) => <div data-testid="md-probe">{props.text}</div>,
}));
vi.mock('./GenUiCard', () => ({ GenUiCard: () => <div data-testid="ui-card-probe" /> }));
vi.mock('./compose/ComposeCard', () => ({
  ComposeCard: (props: { spec: unknown }) => <div data-testid="compose-probe">{JSON.stringify(props.spec)}</div>,
}));

import { GenUiMessageContent } from './GenUiMessageContent';

afterEach(() => cleanup());

const baseProps = {
  projectId: 'proj-1',
  conversationId: 'conv-1',
  rowKey: 'row-1',
  onFileReferenceClick: () => {},
  resolveContext: null,
  resolveNonce: 0,
};

const VALID = '::compose {"version":1,"root":"card1","nodes":{"card1":{"kind":"card","title":"概览"}}}';

describe('::compose 流式渲染接线（BLOCK-466 P3）', () => {
  it('流式 partial spec：渲染稳定占位，原始 JSON 不进入 DOM', () => {
    const { container } = render(
      <GenUiMessageContent {...baseProps} content={'前文\n::compose {"version":1,"root":"card1"'} streaming />,
    );
    expect(screen.getByTestId('compose-stream-pending')).toBeTruthy();
    expect(container.textContent).not.toContain('::compose');
    expect(container.textContent).not.toContain('"version"');
    expect(screen.queryByTestId('compose-probe')).toBeNull();
  });

  it('流式完整 spec 仍占位（不抢渲染），完成后渲染 ComposeCard', () => {
    const { unmount } = render(<GenUiMessageContent {...baseProps} content={VALID} streaming />);
    expect(screen.getByTestId('compose-stream-pending')).toBeTruthy();
    expect(screen.queryByTestId('compose-probe')).toBeNull();
    unmount();
    render(<GenUiMessageContent {...baseProps} content={VALID} streaming={false} />);
    expect(screen.getByTestId('compose-probe')).toBeTruthy();
    expect(screen.queryByTestId('compose-stream-pending')).toBeNull();
  });

  it('纯文本流式消息走 markdown 快路径（零行为变化）', () => {
    render(<GenUiMessageContent {...baseProps} content="你好世界" streaming />);
    expect(screen.getByTestId('md-probe').textContent).toBe('你好世界');
    expect(screen.queryByTestId('compose-stream-pending')).toBeNull();
  });

  it('代码围栏内 ::compose 流式不走占位（防注入，沿既有区间豁免）', () => {
    render(<GenUiMessageContent {...baseProps} content={'```\n::compose {"version":1}\n```'} streaming />);
    expect(screen.queryByTestId('compose-stream-pending')).toBeNull();
    expect(screen.getByTestId('md-probe').textContent).toContain('::compose');
  });
});
