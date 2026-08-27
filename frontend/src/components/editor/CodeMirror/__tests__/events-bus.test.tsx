/**
 * BLOCK-22 P4.10 — hunkAccepted / hunkRejected typed event bus smoke tests
 *
 * Covers:
 * - acceptHunk dispatches biof3Events.hunkAccepted after IPC success
 * - rejectHunk dispatches biof3Events.hunkRejected after IPC success
 * - dismissHunk (pure UI) does NOT dispatch either event
 * - IPC failure path does NOT dispatch any event
 */

import React, { createRef } from 'react';
import { cleanup, render, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodeMirrorEditor } from '../CodeMirrorEditor';
import type { DiffRevision, EditorApi } from '../types';
import { biof3Events } from '../../../../lib/events';

// Mock desktopBridge IPC (applyInverseHunk / rejectHunkByInverseHunk).
const mockApplyInverseHunk = vi.fn(async (_params: { patch: string }) => ({
  ok: true,
  data: { ok: true },
}));
const mockRejectHunkByInverseHunk = vi.fn(async (_params: {
  file: string;
  hunkIndex: number;
  patch: string;
  feedback?: string;
}) => ({ ok: true, data: { ok: true } }));

vi.mock('../../../../lib/desktopBridge', () => ({
  getBridge: vi.fn((name: string) => {
    if (name === 'workingTreeReview') {
      return {
        applyInverseHunk: (params: { patch: string }) => mockApplyInverseHunk(params),
        rejectHunkByInverseHunk: (params: {
          file: string;
          hunkIndex: number;
          patch: string;
          feedback?: string;
        }) => mockRejectHunkByInverseHunk(params),
      };
    }
    return null;
  }),
  isDesktop: () => true,
}));

// vi.hoisted so mockDispatch is available inside the hoisted vi.mock factory.
const mockDispatch = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/events', () => ({
  biof3Events: {
    hunkAccepted: 'biof3:hunk-accepted',
    hunkRejected: 'biof3:hunk-rejected',
    onboardingDone: 'biof3:onboarding-done',
    softRefresh: 'biof3:soft-refresh',
    projectOpenResult: 'biof3:project-open-result',
    projectOpenArtifact: 'biof3:project-open-artifact',
    projectOpenWorkspaceFile: 'biof3:project-open-workspace-file',
    projectWorkspaceChanged: 'biof3:project-workspace-changed',
    copilotAsk: 'biof3:copilot-ask',
    browserBack: 'biof3:browser-back',
    browserForward: 'biof3:browser-forward',
    conversationForked: 'biof3:conversation-forked',
    agentTaskDone: 'biof3:agent-task-done',
    tokenBudget: 'biof3:token-budget',
  },
  dispatchBioF3Event: mockDispatch,
  subscribeBioF3Event: vi.fn(),
}));

// helperRevision — matches the fixture used across this test suite.
const helperRevision: DiffRevision = {
  filePath: '/workspace/sample.py',
  originalText: 'a\nb\nc\n',
  modifiedText: 'A-changed\nb\nc\nD-new\n',
  hunks: [
    {
      id: 'h1',
      startLine: 1,
      endLine: 2,
      kind: 'modify',
      oldText: 'a',
      newText: 'A-changed',
    },
    {
      id: 'h2',
      startLine: 4,
      endLine: 4,
      kind: 'insert',
      oldText: '',
      newText: 'D-new',
    },
  ],
};

afterEach(() => {
  cleanup();
  mockDispatch.mockClear();
  mockApplyInverseHunk.mockClear();
  mockRejectHunkByInverseHunk.mockClear();
});

describe('hunkAccepted / hunkRejected event bus (P4.10)', () => {
  it('acceptHunk dispatches hunkAccepted event after IPC success', async () => {
    const ref = createRef<EditorApi>();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
      />,
    );
    await act(async () => {
      await ref.current?.acceptHunk('h1');
    });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      biof3Events.hunkAccepted,
      expect.objectContaining({
        hunkId: 'h1',
        filePath: '/workspace/sample.py',
        timestamp: expect.any(Number),
      }),
    );
  });

  it('rejectHunk dispatches hunkRejected event after IPC success', async () => {
    const ref = createRef<EditorApi>();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
      />,
    );
    await act(async () => {
      await ref.current?.rejectHunk('h1');
    });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      biof3Events.hunkRejected,
      expect.objectContaining({
        hunkId: 'h1',
        filePath: '/workspace/sample.py',
        timestamp: expect.any(Number),
      }),
    );
  });

  it('dismissHunk does NOT dispatch any hunk event (pure UI dismiss)', async () => {
    const ref = createRef<EditorApi>();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
      />,
    );
    await act(async () => {
      await ref.current?.dismissHunk('h1');
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('IPC failure does NOT dispatch any event', async () => {
    mockApplyInverseHunk.mockRejectedValueOnce(new Error('ipc boom'));
    const ref = createRef<EditorApi>();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
      />,
    );
    await act(async () => {
      try {
        await ref.current?.acceptHunk('h1');
      } catch {
        // expected
      }
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
