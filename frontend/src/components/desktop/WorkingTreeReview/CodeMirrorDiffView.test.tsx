import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeMirrorDiffView } from './CodeMirrorDiffView';

const { getBridgeMock } = vi.hoisted(() => ({
  getBridgeMock: vi.fn(),
}));

vi.mock('../../../lib/desktopBridge', () => ({
  getBridge: getBridgeMock,
}));

const fileContentMock = vi.hoisted(() => vi.fn());

function fileResult(content: string) {
  return Promise.resolve({
    ok: true,
    data: { content, encoding: 'utf-8', size: content.length, truncated: false },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getBridgeMock.mockReturnValue({ fileContent: fileContentMock });
});

afterEach(() => {
  cleanup();
});

describe('CodeMirrorDiffView', () => {
  it('does not load text content for binary files', () => {
    render(<CodeMirrorDiffView filePath="asset.png" isBinary />);

    expect(getBridgeMock).not.toHaveBeenCalled();
    expect(fileContentMock).not.toHaveBeenCalled();
    expect(document.querySelector('.wt-file-binary')?.textContent).toBe('二进制文件变更');
  });

  it('renders a readonly inline diff after loading both revisions', async () => {
    fileContentMock.mockImplementation((params: { ref?: 'HEAD' | 'WORKTREE' }) =>
      fileResult(params.ref === 'HEAD' ? 'original\n' : 'modified\n')
    );

    render(<CodeMirrorDiffView filePath="sample.py" isBinary={false} />);

    await waitFor(() => {
      const editor = document.querySelector('[data-block-22-codemirror]');
      expect(editor).not.toBeNull();
      expect(editor?.getAttribute('data-readonly')).toBe('true');
    });

    expect(fileContentMock).toHaveBeenCalledTimes(2);
    expect(fileContentMock).toHaveBeenNthCalledWith(1, { path: 'sample.py', ref: 'HEAD' });
    expect(fileContentMock).toHaveBeenNthCalledWith(2, { path: 'sample.py', ref: 'WORKTREE' });
  });

  it('reports working tree loading failures', async () => {
    fileContentMock.mockImplementation(() =>
      Promise.resolve({ ok: false, message: 'unable to read file' })
    );

    render(<CodeMirrorDiffView filePath="sample.py" isBinary={false} />);

    const alert = await waitFor(() => {
      const element = document.querySelector('[role="alert"]');
      expect(element).not.toBeNull();
      return element;
    });
    if (!alert) throw new Error('Expected error alert to render');
    expect(alert.textContent).toBe('unable to read file');
  });

  it('renders hunk markers and hover accept/reject controls (BLOCK-28)', async () => {
    fileContentMock.mockImplementation((params: { ref?: 'HEAD' | 'WORKTREE' }) =>
      fileResult(params.ref === 'HEAD' ? 'line1\n' : 'line1\nline2\n')
    );
    const onAcceptHunk = vi.fn();
    const onRejectHunk = vi.fn();

    render(
      <CodeMirrorDiffView
        filePath="sample.py"
        isBinary={false}
        hunks={[{ oldStart: 1, newStart: 2, lines: [{ type: 'add', text: 'line2' }] }]}
        hunkDecisions={[null]}
        onAcceptHunk={onAcceptHunk}
        onRejectHunk={onRejectHunk}
      />
    );

    await waitFor(() => {
      expect(document.querySelector('[data-block-22-codemirror]')).not.toBeNull();
    });

    // 滚动标记条：1 个 hunk → 1 个标记
    const markers = document.querySelectorAll('.wt-diff-marker');
    expect(markers.length).toBe(1);

    // hunk 悬浮控件：Accept / Reject 按钮均已注入编辑器行尾
    await waitFor(() => {
      expect(document.querySelector('[data-hunk-accept="0"]')).not.toBeNull();
      expect(document.querySelector('[data-hunk-reject="0"]')).not.toBeNull();
    });

    const acceptBtn = document.querySelector<HTMLButtonElement>('[data-hunk-accept="0"]');
    acceptBtn?.click();
    expect(onAcceptHunk).toHaveBeenCalledTimes(1);
    expect(onRejectHunk).not.toHaveBeenCalled();
  });
});
