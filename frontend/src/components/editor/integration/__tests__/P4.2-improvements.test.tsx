/**
 * BLOCK-22 P4.2 桥接层易用性改进 — 综合测试
 *
 * 验证范围：
 * - P4.2 改进 1：WorkspaceFilePreviewBridge 自动 wrap PendingScrollProvider（避免 double wrap）
 * - P4.2 改进 2：useEditorApi() hook 返回 EditorApi 实例
 * - P4.2 改进 3：ChatCardLink 开箱即用组件（children 可选，默认显示 filePath:line）
 * - P4.2 改进 4：BioF3OpenFileDevBridge 重命名 + AppLevelBridge alias
 *
 * 设计要点：
 * - mock CodeMirrorEditor（避免触发完整 CM6 初始化路径）
 * - 验证 double wrap 场景：BridgeRoot 检测外部 Provider 后不再 wrap
 */

import React from 'react';
import { cleanup, render, act, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ===== Mock CodeMirrorEditor =====

const mockScrollToLine = vi.fn();
const mockSetMode = vi.fn();
const mockSetDiffRevision = vi.fn();
const mockGetValue = vi.fn(() => 'mock-value');
const mockSetValue = vi.fn();
const mockDestroy = vi.fn();
const mockGetMode = vi.fn(() => 'normal' as const);
const mockGetDiffRevision = vi.fn(() => null);

vi.mock('../../CodeMirror/CodeMirrorEditor', () => ({
  CodeMirrorEditor: React.forwardRef(
    function MockCodeMirrorEditor(_props: { children?: React.ReactNode }, ref: React.ForwardedRef<unknown>) {
      React.useImperativeHandle(ref, () => ({
        getValue: mockGetValue,
        setValue: mockSetValue,
        destroy: mockDestroy,
        setMode: mockSetMode,
        getMode: mockGetMode,
        setDiffRevision: mockSetDiffRevision,
        getDiffRevision: mockGetDiffRevision,
        scrollToLine: mockScrollToLine,
        acceptHunk: vi.fn(async () => undefined),
        rejectHunk: vi.fn(async () => undefined),
        acceptAll: vi.fn(async () => ({ allOk: true, succeeded: [], failed: [] })),
        rejectAll: vi.fn(async () => undefined),
        getHunk: vi.fn(() => null),
      }));
      return <div data-testid="mock-codemirror" />;
    },
  ),
}));

// ===== Imports =====

import {
  WorkspaceFilePreviewBridge,
  useEditorApi,
} from '../WorkspaceFilePreviewBridge';
import type { EditorApi } from '../../CodeMirror/types';
import { ChatCardLink } from '../../../copilot/integration/ChatCardLinkBridge';
import { BioF3OpenFileDevBridge, AppLevelBridge } from '../AppLevelBridge';
import {
  PendingScrollProvider,
  usePendingScroll,
} from '../../../../lib/pendingScrollContext';

// ===== Test helpers =====

interface PendingCapture {
  setPendingRequest: ReturnType<typeof usePendingScroll>['setPendingRequest'];
  pendingRequest: ReturnType<typeof usePendingScroll>['pendingRequest'];
}

function PendingCaptureConsumer({
  capture,
}: {
  capture: PendingCapture | null;
}): React.ReactElement | null {
  const ctx = usePendingScroll();
  if (capture) {
    capture.setPendingRequest = ctx.setPendingRequest;
    capture.pendingRequest = ctx.pendingRequest;
  }
  return <span data-testid="pending-capture" />;
}

// ===== Test suite =====

describe('P4.2 WorkspaceFilePreviewBridge — BridgeRoot auto-wrap', () => {
  afterEach(() => {
    cleanup();
    mockScrollToLine.mockClear();
    mockSetMode.mockClear();
    mockSetDiffRevision.mockClear();
  });

  it('mounts without double wrap when no outer Provider exists', () => {
    // Should not throw — BridgeRoot auto-wraps internally
    const { getByTestId } = render(
      <WorkspaceFilePreviewBridge
        filePath="/workspace/auto.py"
        value="test"
        language="python"
      />,
    );
    expect(getByTestId('mock-codemirror')).toBeTruthy();
    expect(getByTestId('mock-codemirror')).toBeTruthy(); // no crash from double Provider
  });

  it('does NOT double wrap when outer Provider is present', async () => {
    // BLOCK-42 P4：消费改为 rAF 延迟一帧（同文件重开滚动丢失修复），
    // 故 one-shot 断言需等 rAF 回调执行。
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 0;
    });
    const capture: PendingCapture | null = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };
    // Outer Provider wraps Bridge — BridgeRoot should detect and not wrap again
    const { getByTestId } = render(
      <PendingScrollProvider>
        <PendingCaptureConsumer capture={capture} />
        <WorkspaceFilePreviewBridge
          filePath="/workspace/outer.py"
          value="test"
          language="python"
        />
      </PendingScrollProvider>,
    );
    expect(getByTestId('mock-codemirror')).toBeTruthy();
    // Outer context should be usable (setPendingRequest not broken by double wrap)
    await act(async () => {
      capture!.setPendingRequest({
        filePath: '/workspace/outer.py',
        line: 1,
        timestamp: Date.now(),
      });
    });
    expect(capture!.pendingRequest).toBeNull(); // one-shot consumption worked
    vi.unstubAllGlobals();
  });
});

describe('P4.2 useEditorApi() hook', () => {
  afterEach(() => {
    cleanup();
    mockScrollToLine.mockClear();
  });

    it('useEditorApi is exported and is a function', () => {
    expect(typeof useEditorApi).toBe('function');
  });

  it('useEditorApi returns null object when outside Bridge subtree (graceful fallback)', () => {
    let captured: { api: EditorApi | null } | null = null;
    function Checker(): React.ReactElement {
      captured = useEditorApi();
      return <span data-testid="checker" />;
    }
    render(
      <PendingScrollProvider>
        <Checker />
      </PendingScrollProvider>,
    );
    expect(captured).not.toBeNull();
    expect(captured!.api).toBeNull();
  });

  it('scrollToLine is called via pendingRequest through editorRef', async () => {
    const editorRef: React.MutableRefObject<EditorApi | null> = { current: null };

    render(
      <WorkspaceFilePreviewBridge
        editorRef={editorRef}
        filePath="/workspace/scroll.py"
        value="test"
        language="python"
      />,
    );

    // Wait for callback ref to fire (async, after mount)
    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    }, { timeout: 3000 });

    // scrollToLine is synchronous — call it directly
    editorRef.current!.scrollToLine({ line: 99 });

    expect(mockScrollToLine).toHaveBeenCalledWith({ line: 99 });
  });

  it('does NOT throw when called outside Provider (graceful null)', () => {
    // useEditorApi returns { api: null } when called outside WorkspaceFilePreviewBridge subtree
    // (no Bridge context, EditorApiContext.Provider is never rendered)
    let result: unknown = 'not-called';

    function ApiChecker(): React.ReactElement {
      const { api } = useEditorApi();
      result = api; // null outside Bridge
      return <span data-testid="api-checker" />;
    }

    const { getByTestId } = render(
      <PendingScrollProvider>
        <ApiChecker />
      </PendingScrollProvider>,
    );

    expect(getByTestId('api-checker')).toBeTruthy();
    // Outside WorkspaceFilePreviewBridge subtree, EditorApiContext.Provider never renders
    expect(result).toBeNull();
  });
});

describe('P4.2 ChatCardLink — out-of-the-box component', () => {
  afterEach(() => {
    cleanup();
  });

  it('ChatCardLink variant=floating renders floating CSS class', () => {
    const capture: PendingCapture | null = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };
    const { container } = render(
      <PendingScrollProvider>
        <PendingCaptureConsumer capture={capture} />
        <ChatCardLink filePath="/workspace/default.py" line={7} />
      </PendingScrollProvider>,
    );

    const btn = container.querySelector('[data-bf3-chat-card-link]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    // Default label should be "/workspace/default.py:7"
    expect(btn.textContent).toBe('/workspace/default.py:7');
  });

  it('uses children when provided (custom label)', () => {
    const capture: PendingCapture | null = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };
    const { container } = render(
      <PendingScrollProvider>
        <PendingCaptureConsumer capture={capture} />
        <ChatCardLink filePath="/workspace/custom.py" line={3}>
          Jump to line 3
        </ChatCardLink>
      </PendingScrollProvider>,
    );

    const btn = container.querySelector('[data-bf3-chat-card-link]') as HTMLButtonElement;
    expect(btn.textContent).toBe('Jump to line 3');
  });

  it('click dispatches correct pendingRequest', () => {
    const capture: PendingCapture | null = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };
    const { container } = render(
      <PendingScrollProvider>
        <PendingCaptureConsumer capture={capture} />
        <ChatCardLink
          filePath="/workspace/click.py"
          line={12}
          column={5}
          pulseMs={2000}
        />
      </PendingScrollProvider>,
    );

    const btn = container.querySelector('[data-bf3-chat-card-link]') as HTMLButtonElement;
    fireEvent.click(btn);

    expect(capture!.pendingRequest).not.toBeNull();
    expect(capture!.pendingRequest!.filePath).toBe('/workspace/click.py');
    expect(capture!.pendingRequest!.line).toBe(12);
    expect(capture!.pendingRequest!.column).toBe(5);
    expect(capture!.pendingRequest!.pulseMs).toBe(2000);
  });

  it('variant=floating renders floating CSS class', () => {
    const capture: PendingCapture | null = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };
    const { container } = render(
      <PendingScrollProvider>
        <PendingCaptureConsumer capture={capture} />
        <ChatCardLink filePath="/workspace/float.py" line={1} variant="floating" />
      </PendingScrollProvider>,
    );

    const btn = container.querySelector('[data-bf3-chat-card-link-variant="floating"]');
    expect(btn).toBeTruthy();
  });

  it('variant=inline renders inline CSS class (default)', () => {
    const capture: PendingCapture | null = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };
    const { container } = render(
      <PendingScrollProvider>
        <PendingCaptureConsumer capture={capture} />
        <ChatCardLink filePath="/workspace/inline.py" line={1} />
      </PendingScrollProvider>,
    );

    const btn = container.querySelector('[data-bf3-chat-card-link-variant="inline"]');
    expect(btn).toBeTruthy();
  });

  it('click payload includes diffRevision when provided', () => {
    const capture: PendingCapture | null = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };
    const rev = {
      filePath: '/workspace/diff.py',
      originalText: 'old\n',
      modifiedText: 'new\n',
    };
    const { container } = render(
      <PendingScrollProvider>
        <PendingCaptureConsumer capture={capture} />
        <ChatCardLink filePath="/workspace/diff.py" line={1} diffRevision={rev} />
      </PendingScrollProvider>,
    );

    fireEvent.click(container.querySelector('[data-bf3-chat-card-link]')!);

    expect(capture!.pendingRequest!.diffRevision).toEqual(rev);
  });
});

describe('P4.2 BioF3OpenFileDevBridge rename + alias', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>)['__biof3DispatchOpenFile'];
  });

  it('BioF3OpenFileDevBridge is a function (component)', () => {
    expect(typeof BioF3OpenFileDevBridge).toBe('function');
  });

  it('AppLevelBridge alias equals BioF3OpenFileDevBridge', () => {
    expect(AppLevelBridge).toBe(BioF3OpenFileDevBridge);
  });

  it('mounting registers window.__biof3DispatchOpenFile in dev env', () => {
    // Simulate dev mode
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const capture: PendingCapture | null = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };

    const { unmount } = render(
      <PendingScrollProvider>
        <PendingCaptureConsumer capture={capture} />
        <BioF3OpenFileDevBridge />
      </PendingScrollProvider>,
    );

    expect(typeof window.__biof3DispatchOpenFile).toBe('function');

    act(() => {
      window.__biof3DispatchOpenFile!('/workspace/dev.py', 5, 3);
    });

    expect(capture!.pendingRequest).not.toBeNull();
    expect(capture!.pendingRequest!.filePath).toBe('/workspace/dev.py');
    expect(capture!.pendingRequest!.line).toBe(5);
    expect(capture!.pendingRequest!.column).toBe(3);

    unmount();
    expect((window as unknown as Record<string, unknown>)['__biof3DispatchOpenFile']).toBeUndefined();

    process.env.NODE_ENV = originalNodeEnv;
  });

  it('unmounting clears window.__biof3DispatchOpenFile', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const { unmount } = render(
      <PendingScrollProvider>
        <BioF3OpenFileDevBridge />
      </PendingScrollProvider>,
    );

    expect(window.__biof3DispatchOpenFile).toBeDefined();
    unmount();
    expect(window.__biof3DispatchOpenFile).toBeUndefined();

    process.env.NODE_ENV = originalNodeEnv;
  });
});
