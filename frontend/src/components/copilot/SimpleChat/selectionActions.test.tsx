// BLOCK-246 C12 — 划词动作：纯函数（载荷/上限/禁用理由）+ 动作条渲染。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  TEXT_ANNOTATION_UNAVAILABLE_REASON,
  buildSelectionActions,
  clampSelectionText,
  selectionQuoteDetail,
  selectionScratchpadInput,
} from './selectionActions';
import { MAX_SELECTION_REFERENCE_CHARS } from './selectionReferences';
import { SelectionActionBar } from './SelectionActionBar';

afterEach(cleanup);

describe('buildSelectionActions', () => {
  it('offers five actions and keeps annotate visible-but-disabled with a reason', () => {
    const actions = buildSelectionActions({ charCount: 12 });
    expect(actions.map((action) => action.id)).toEqual(['copy', 'quote', 'scratchpad', 'side-chat', 'annotate']);
    const annotate = actions.find((action) => action.id === 'annotate')!;
    expect(annotate.disabled).toBe(true);
    expect(annotate.hint).toBe(TEXT_ANNOTATION_UNAVAILABLE_REASON);
    expect(actions.filter((action) => !action.disabled).length).toBe(4);
  });

  it('disables every action for an empty selection', () => {
    const actions = buildSelectionActions({ charCount: 0 });
    expect(actions.every((action) => action.disabled)).toBe(true);
  });
});

describe('clampSelectionText', () => {
  it('keeps short text untouched and marks long text with an honest truncation note', () => {
    expect(clampSelectionText('abc')).toEqual({ text: 'abc', truncated: false });
    const long = 'x'.repeat(MAX_SELECTION_REFERENCE_CHARS + 10);
    const clamped = clampSelectionText(long);
    expect(clamped.truncated).toBe(true);
    expect(clamped.text).toContain('…（选中内容过长，已截断）');
  });
});

describe('selectionQuoteDetail', () => {
  it('builds the exact selectionQuote payload contract', () => {
    const detail = selectionQuoteDetail('  scale=True  ', {
      path: 'analysis/qc.py',
      name: 'qc.py',
      projectId: 'proj_1',
      startLine: 4,
      endLine: 6,
    });
    expect(detail).toEqual({
      projectId: 'proj_1',
      path: 'analysis/qc.py',
      name: 'qc.py',
      startLine: 4,
      endLine: 6,
      text: 'scale=True',
    });
  });

  it('returns null for blank text or missing path instead of emitting a hollow quote', () => {
    expect(selectionQuoteDetail('   ', { path: 'a.py' })).toBeNull();
    expect(selectionQuoteDetail('x', { path: '' })).toBeNull();
  });
});

describe('selectionScratchpadInput', () => {
  it('records a selection-kind entry with a file position label', () => {
    const input = selectionScratchpadInput('第一行\n第二行', {
      path: 'analysis/qc.py',
      projectId: 'proj_1',
      startLine: 4,
      endLine: 6,
    });
    expect(input).toMatchObject({
      kind: 'text',
      sourceKind: 'selection',
      sourceRef: 'analysis/qc.py:L4-L6',
      projectId: 'proj_1',
      title: '第一行',
    });
  });

  it('omits the line range when the surface has no line numbers', () => {
    const input = selectionScratchpadInput('md 里选的一段', { path: 'docs/a.md' });
    expect(input?.sourceRef).toBe('docs/a.md');
  });
});

describe('SelectionActionBar', () => {
  it('renders all actions, disables annotate, and reports picks', () => {
    const onPick = vi.fn();
    render(<SelectionActionBar actions={buildSelectionActions({ charCount: 3 })} x={10} y={10} onPick={onPick} />);
    expect(screen.getByTestId('sc-selection-action-annotate')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('sc-selection-action-quote'));
    expect(onPick).toHaveBeenCalledWith('quote');
    fireEvent.click(screen.getByTestId('sc-selection-action-annotate'));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('flips left when the selection is near the right edge', () => {
    const original = window.innerWidth;
    window.innerWidth = 500;
    try {
      render(<SelectionActionBar actions={buildSelectionActions({ charCount: 3 })} x={480} y={10} onPick={vi.fn()} />);
      const bar = screen.getByTestId('sc-selection-bar');
      expect(Number.parseFloat(bar.style.left)).toBeLessThanOrEqual(500 - 340 - 8);
    } finally {
      window.innerWidth = original;
    }
  });
});
