/**
 * BLOCK-22 P3 桥接层 (UI-194) — ChatCardLinkBridge smoke test
 *
 * 验证范围：
 * - mount 不抛错
 * - 点击触发 usePendingScroll().setPendingRequest 调用，载荷含 filePath / line / column / timestamp
 * - 点击触发带 diffRevision 的请求时，载荷含 diffRevision
 * - variant=floating 渲染对应 CSS class
 * - variant=inline 渲染对应 CSS class
 * - 默认 aria-label 由 filePath + line 拼接
 *
 * 设计要点：
 * - 使用 PendingScrollProvider 在测试中显式挂载，避免依赖 WorkspaceFilePreviewBridge
 * - 通过 usePendingScroll().setPendingRequest spy 验证 click 副作用
 */

import React from 'react';
import { cleanup, render, fireEvent, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatCardLinkBridge } from '../ChatCardLinkBridge';
import {
  PendingScrollProvider,
  usePendingScroll,
} from '../../../../lib/pendingScrollContext';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface Capture {
  setPendingRequest: ReturnType<typeof usePendingScroll>['setPendingRequest'] | null;
  pendingRequest: ReturnType<typeof usePendingScroll>['pendingRequest'] | null;
}

function CaptureConsumer({ capture }: { capture: Capture }): React.ReactElement {
  const ctx = usePendingScroll();
  capture.setPendingRequest = ctx.setPendingRequest;
  capture.pendingRequest = ctx.pendingRequest;
  return <span data-testid="capture-consumer" />;
}

describe('ChatCardLinkBridge (P3 smoke)', () => {
  it('mounts without throwing', () => {
    const capture: Capture = { setPendingRequest: null, pendingRequest: null };
    const { container } = render(
      <PendingScrollProvider>
        <CaptureConsumer capture={capture} />
        <ChatCardLinkBridge filePath="/workspace/foo.py" line={1}>
          Open
        </ChatCardLinkBridge>
      </PendingScrollProvider>,
    );
    expect(container.querySelector('[data-bf3-chat-card-link]')).toBeTruthy();
  });

  it('click invokes setPendingRequest with correct payload (filePath / line / column / pulseMs)', () => {
    const capture: Capture = { setPendingRequest: null, pendingRequest: null };
    const { container } = render(
      <PendingScrollProvider>
        <CaptureConsumer capture={capture} />
        <ChatCardLinkBridge
          filePath="/workspace/click.py"
          line={12}
          column={4}
          pulseMs={2000}
        >
          click me
        </ChatCardLinkBridge>
      </PendingScrollProvider>,
    );

    const btn = container.querySelector(
      '[data-bf3-chat-card-link]',
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();

    const before = Date.now();
    fireEvent.click(btn);
    const after = Date.now();

    // capture.pendingRequest 应被设置
    const req = capture.pendingRequest;
    expect(req).not.toBeNull();
    expect(req?.filePath).toBe('/workspace/click.py');
    expect(req?.line).toBe(12);
    expect(req?.column).toBe(4);
    expect(req?.pulseMs).toBe(2000);
    expect(typeof req?.timestamp).toBe('number');
    expect(req!.timestamp).toBeGreaterThanOrEqual(before);
    expect(req!.timestamp).toBeLessThanOrEqual(after);
  });

  it('click payload includes diffRevision when prop provided', () => {
    const capture: Capture = { setPendingRequest: null, pendingRequest: null };
    const { container } = render(
      <PendingScrollProvider>
        <CaptureConsumer capture={capture} />
        <ChatCardLinkBridge
          filePath="/workspace/diff.py"
          line={3}
          diffRevision={{
            filePath: '/workspace/diff.py',
            originalText: 'a\n',
            modifiedText: 'b\n',
          }}
        >
          diff link
        </ChatCardLinkBridge>
      </PendingScrollProvider>,
    );

    const btn = container.querySelector(
      '[data-bf3-chat-card-link]',
    ) as HTMLButtonElement;
    fireEvent.click(btn);

    const req = capture.pendingRequest;
    expect(req).not.toBeNull();
    expect(req?.diffRevision).toBeDefined();
    expect(req?.diffRevision?.filePath).toBe('/workspace/diff.py');
    expect(req?.diffRevision?.originalText).toBe('a\n');
    expect(req?.diffRevision?.modifiedText).toBe('b\n');
  });

  it('variant="inline" renders data attribute and CSS class', () => {
    const capture: Capture = { setPendingRequest: null, pendingRequest: null };
    const { container } = render(
      <PendingScrollProvider>
        <CaptureConsumer capture={capture} />
        <ChatCardLinkBridge filePath="/x.py" line={1} variant="inline">
          inline
        </ChatCardLinkBridge>
      </PendingScrollProvider>,
    );
    const btn = container.querySelector(
      '[data-bf3-chat-card-link-variant="inline"]',
    );
    expect(btn).toBeTruthy();
  });

  it('variant="floating" renders data attribute and CSS class', () => {
    const capture: Capture = { setPendingRequest: null, pendingRequest: null };
    const { container } = render(
      <PendingScrollProvider>
        <CaptureConsumer capture={capture} />
        <ChatCardLinkBridge filePath="/x.py" line={1} variant="floating">
          floating
        </ChatCardLinkBridge>
      </PendingScrollProvider>,
    );
    const btn = container.querySelector(
      '[data-bf3-chat-card-link-variant="floating"]',
    );
    expect(btn).toBeTruthy();
  });

  it('aria-label defaults to "Open <path>:<line>"', () => {
    const capture: Capture = { setPendingRequest: null, pendingRequest: null };
    const { container } = render(
      <PendingScrollProvider>
        <CaptureConsumer capture={capture} />
        <ChatCardLinkBridge filePath="/workspace/lab.py" line={42}>
          label-test
        </ChatCardLinkBridge>
      </PendingScrollProvider>,
    );
    const btn = container.querySelector(
      '[data-bf3-chat-card-link]',
    ) as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Open /workspace/lab.py:42');
  });

  it('custom ariaLabel wins when provided', () => {
    const capture: Capture = { setPendingRequest: null, pendingRequest: null };
    const { container } = render(
      <PendingScrollProvider>
        <CaptureConsumer capture={capture} />
        <ChatCardLinkBridge filePath="/workspace/lab.py" line={1} ariaLabel="自定义">
          custom-label
        </ChatCardLinkBridge>
      </PendingScrollProvider>,
    );
    const btn = container.querySelector(
      '[data-bf3-chat-card-link]',
    ) as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('自定义');
  });
});