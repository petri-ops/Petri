// BLOCK-175 CP-15 — 分屏可拖拽分隔条契约（钳制/持久化/键盘可达）。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { ArtifactPinPane } from './ArtifactPinPane';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const snapshot = {
  jobId: 'job-1',
  artifactName: 'result.csv',
  label: '结果表',
  viewerAdapter: 'table' as const,
  previewData: [['gene', 'fc'], ['A', 2]],
  previewText: null,
  url: 'http://localhost/x',
};

function renderPane() {
  return render(
    React.createElement(ArtifactPinPane, {
      mode: 'result',
      snapshot: snapshot as any,
      onUnpin: () => {},
    }, React.createElement('div', null, '主区')),
  );
}

describe('ArtifactPinPane 可拖拽分隔条（BLOCK-175 CP-15）', () => {
  it('分隔条在场且 aria 值=缺省 60', () => {
    renderPane();
    const divider = screen.getByTestId('artifact-pin-divider');
    expect(divider.getAttribute('aria-valuenow')).toBe('60');
  });

  it('键盘左右箭头 ±5 且 20-80 钳制', () => {
    renderPane();
    const divider = screen.getByTestId('artifact-pin-divider');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider.getAttribute('aria-valuenow')).toBe('65');
    for (let i = 0; i < 8; i += 1) fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider.getAttribute('aria-valuenow')).toBe('80');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider.getAttribute('aria-valuenow')).toBe('75');
  });

  it('比例持久化到 localStorage（钳制后写入）', () => {
    renderPane();
    const divider = screen.getByTestId('artifact-pin-divider');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(localStorage.getItem('petri.pinSplitRatio')).toBe('65');
  });
});
