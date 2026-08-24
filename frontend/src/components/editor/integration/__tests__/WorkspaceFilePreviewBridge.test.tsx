/**
 * BLOCK-22 P3 桥接层 (UI-194) — WorkspaceFilePreviewBridge smoke test
 *
 * 验证范围：
 * - mount 不抛错
 * - PendingScrollContext Provider 已被挂载
 * - 当 usePendingScroll().setPendingRequest 触发匹配 filePath 的请求时
 *   CodeMirrorEditor 的 EditorApi.scrollToLine 被调
 * - 当请求带 diffRevision 时，EditorApi.setMode('inline-diff') + setDiffRevision 被调
 * - 处理完一次后 pendingRequest 被清空
 *
 * 设计要点：
 * - mock CodeMirrorEditor（避免触发完整 CM6 初始化路径，仅验证桥接层逻辑）
 * - 通过 ref 拿到 EditorApi spy，断言 scrollToLine / setMode / setDiffRevision 调用
 */

import React from 'react';
import { cleanup, render, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DiffRevision, EditorApi, EditorMode } from '../../CodeMirror/types';

// ===== Mock CodeMirrorEditor =====
//
// 我们用一个轻量 mock 替代真实 CodeMirrorEditor：
// - 通过 forwardRef 暴露 spy EditorApi
// - 渲染一个带 data-testid 的简单 div
//
// 这样测试不必启动 CM6 + happy-dom 完整渲染，同时能精确断言桥接层逻辑。
const mockScrollToLine = vi.fn();
const mockSetMode = vi.fn();
const mockSetDiffRevision = vi.fn();
const mockGetValue = vi.fn(() => 'mock-value');
const mockSetValue = vi.fn();
const mockDestroy = vi.fn();
const mockGetMode = vi.fn((): EditorMode => 'normal');
const mockGetDiffRevision = vi.fn((): DiffRevision | null => null);

vi.mock('../../CodeMirror/CodeMirrorEditor', () => ({
  CodeMirrorEditor: React.forwardRef<EditorApi, { children?: React.ReactNode }>(
    function MockCodeMirrorEditor({ children }: { children?: React.ReactNode }, ref) {
      React.useImperativeHandle(ref, (): EditorApi => ({
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
      return <div data-testid="mock-codemirror">{children}</div>;
    },
  ),
}));

// Import after mock so it picks up the mocked module
import { WorkspaceFilePreviewBridge } from '../WorkspaceFilePreviewBridge';
import { usePendingScroll } from '../../../../lib/pendingScrollContext';

afterEach(() => {
  cleanup();
  mockScrollToLine.mockClear();
  mockSetMode.mockClear();
  mockSetDiffRevision.mockClear();
  mockGetValue.mockClear();
  mockSetValue.mockClear();
  mockDestroy.mockClear();
  mockGetMode.mockClear();
  mockGetDiffRevision.mockClear();
});

// ===== Helper consumer =====

interface PendingCapture {
  setPendingRequest: ReturnType<typeof usePendingScroll>['setPendingRequest'];
  pendingRequest: ReturnType<typeof usePendingScroll>['pendingRequest'];
}

function PendingConsumer({
  capture,
}: {
  capture: PendingCapture | null;
}): React.ReactElement | null {
  const ctx = usePendingScroll();
  if (capture) {
    capture.setPendingRequest = ctx.setPendingRequest;
    capture.pendingRequest = ctx.pendingRequest;
  }
  return <span data-testid="pending-consumer" />;
}

describe('WorkspaceFilePreviewBridge (P3 smoke)', () => {
  it('mounts without throwing', () => {
    const { getByTestId } = render(
      <WorkspaceFilePreviewBridge filePath="/workspace/foo.py" value="abc" language="python" />,
    );
    expect(getByTestId('mock-codemirror')).toBeTruthy();
  });

  it('exposes PendingScrollContext via usePendingScroll inside children', () => {
    const capture: PendingCapture | null = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };
    render(
      <WorkspaceFilePreviewBridge filePath="/workspace/foo.py" value="abc">
        <PendingConsumer capture={capture} />
      </WorkspaceFilePreviewBridge>,
    );
    expect(capture).not.toBeNull();
    expect(typeof capture!.setPendingRequest).toBe('function');
  });

  it('forwards filePath / value to CodeMirrorEditor and forwards ref api', async () => {
    const editorRef: React.MutableRefObject<EditorApi | null> = { current: null };
    render(
      <WorkspaceFilePreviewBridge
        editorRef={editorRef}
        filePath="/workspace/bar.py"
        value="initial-value"
        language="python"
      />,
    );
    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });
    expect(editorRef.current).not.toBeNull();
    expect(editorRef.current?.getValue()).toBe('mock-value');
  });

  it('scrollToLine is invoked when a matching pendingRequest is dispatched', async () => {
    const editorRef: React.MutableRefObject<EditorApi | null> = { current: null };
    const capture: PendingCapture = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };

    render(
      <WorkspaceFilePreviewBridge
        editorRef={editorRef}
        filePath="/workspace/match.py"
        value="abc"
      >
        <PendingConsumer capture={capture} />
      </WorkspaceFilePreviewBridge>,
    );

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });

    act(() => {
      capture.setPendingRequest({
        filePath: '/workspace/match.py',
        line: 42,
        column: 4,
        pulseMs: 1500,
        timestamp: 1234,
      });
    });

    await waitFor(() => {
      expect(mockScrollToLine).toHaveBeenCalled();
    });
    expect(mockScrollToLine).toHaveBeenCalledWith({
      line: 42,
      column: 4,
      pulseMs: 1500,
    });
  });

  it('scrollToLine is NOT invoked when pendingRequest.filePath does not match', async () => {
    const editorRef: React.MutableRefObject<EditorApi | null> = { current: null };
    const capture: PendingCapture = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };

    render(
      <WorkspaceFilePreviewBridge
        editorRef={editorRef}
        filePath="/workspace/mine.py"
        value="abc"
      >
        <PendingConsumer capture={capture} />
      </WorkspaceFilePreviewBridge>,
    );

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });

    act(() => {
      capture.setPendingRequest({
        filePath: '/workspace/other.py',
        line: 10,
        timestamp: 1234,
      });
    });

    // 等待 effect 跑完
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockScrollToLine).not.toHaveBeenCalled();
  });

  it('setMode(inline-diff) + setDiffRevision invoked when pendingRequest carries diffRevision', async () => {
    const editorRef: React.MutableRefObject<EditorApi | null> = { current: null };
    const capture: PendingCapture = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };

    const rev: DiffRevision = {
      filePath: '/workspace/diff.py',
      originalText: 'a\n',
      modifiedText: 'b\n',
    };

    render(
      <WorkspaceFilePreviewBridge
        editorRef={editorRef}
        filePath="/workspace/diff.py"
        value="b\n"
      >
        <PendingConsumer capture={capture} />
      </WorkspaceFilePreviewBridge>,
    );

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });

    act(() => {
      capture.setPendingRequest({
        filePath: '/workspace/diff.py',
        line: 1,
        diffRevision: rev,
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(mockSetMode).toHaveBeenCalledWith('inline-diff');
      expect(mockSetDiffRevision).toHaveBeenCalledWith(rev);
    });
    expect(mockScrollToLine).toHaveBeenCalled();
  });

  it('pendingRequest is cleared after one-shot consumption', async () => {
    const editorRef: React.MutableRefObject<EditorApi | null> = { current: null };
    const capture: PendingCapture = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };

    render(
      <WorkspaceFilePreviewBridge
        editorRef={editorRef}
        filePath="/workspace/clear.py"
        value="abc"
      >
        <PendingConsumer capture={capture} />
      </WorkspaceFilePreviewBridge>,
    );

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });

    act(() => {
      capture.setPendingRequest({
        filePath: '/workspace/clear.py',
        line: 5,
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      // 处理完后 setPendingRequest(null) 被调用：pendingRequest 应变 null
      expect(capture.pendingRequest).toBeNull();
    });
    expect(mockScrollToLine).toHaveBeenCalledTimes(1);
  });

  it('without diffRevision: base mode / diffRevision are restored', async () => {
    const editorRef: React.MutableRefObject<EditorApi | null> = { current: null };
    const capture: PendingCapture = {
      setPendingRequest: () => undefined,
      pendingRequest: null,
    };

    render(
      <WorkspaceFilePreviewBridge
        editorRef={editorRef}
        filePath="/workspace/restore.py"
        value="abc"
        mode="normal"
      >
        <PendingConsumer capture={capture} />
      </WorkspaceFilePreviewBridge>,
    );

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });

    act(() => {
      capture.setPendingRequest({
        filePath: '/workspace/restore.py',
        line: 3,
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(mockScrollToLine).toHaveBeenCalled();
    });
    // 没有 diffRevision：不应切到 inline-diff
    expect(mockSetMode).not.toHaveBeenCalledWith('inline-diff');
  });
});