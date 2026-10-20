import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SegmentBoundary } from './SegmentBoundary';

/**
 * BLOCK-222 Q9 — 段落级错误边界。钉四件事：
 * ①正常子树直通；②抛错只接管该段（含 data-segment 标注）；
 * ③重试可恢复；④resetKey 变化自动清错（换产物/文件后不留旧错误）。
 */

afterEach(cleanup);

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('segment boom');
  return <p>ok-content</p>;
}

describe('SegmentBoundary', () => {
  it('无异常时原样渲染子树（不多包一层可见 UI）', () => {
    const { getByText, container } = render(
      <SegmentBoundary segment="result-preview">
        <p>ok-content</p>
      </SegmentBoundary>,
    );
    expect(getByText('ok-content')).toBeTruthy();
    expect(container.querySelector('[data-segment-crashed]')).toBeNull();
  });

  it('子树抛错时只接管该段并标注 segment', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    const { getByText, container } = render(
      <div>
        <p>outside-safe</p>
        <SegmentBoundary segment="result-preview" onError={onError} title="预览没能渲染出来">
          <Boom shouldThrow />
        </SegmentBoundary>
      </div>,
    );
    expect(getByText('outside-safe')).toBeTruthy();
    expect(getByText('预览没能渲染出来')).toBeTruthy();
    expect(getByText('segment boom')).toBeTruthy();
    const crashed = container.querySelector('[data-segment-crashed="true"]');
    expect(crashed?.getAttribute('data-segment')).toBe('result-preview');
    expect(onError).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('重试：子树恢复后点「重试这一段」即回到正常内容', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldThrow = true;
    function Flaky() {
      return <Boom shouldThrow={shouldThrow} />;
    }
    const { getByText } = render(
      <SegmentBoundary segment="workspace-preview">
        <Flaky />
      </SegmentBoundary>,
    );
    expect(getByText('重试这一段')).toBeTruthy();
    shouldThrow = false;
    fireEvent.click(getByText('重试这一段'));
    expect(getByText('ok-content')).toBeTruthy();
    spy.mockRestore();
  });

  it('resetKey 变化自动清错（切到别的产物/文件）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldThrow = true;
    function Flaky() {
      return <Boom shouldThrow={shouldThrow} />;
    }
    const { getByText, rerender } = render(
      <SegmentBoundary segment="result-preview" resetKey="a1">
        <Flaky />
      </SegmentBoundary>,
    );
    expect(getByText('segment boom')).toBeTruthy();
    shouldThrow = false;
    rerender(
      <SegmentBoundary segment="result-preview" resetKey="a2">
        <Flaky />
      </SegmentBoundary>,
    );
    expect(getByText('ok-content')).toBeTruthy();
    spy.mockRestore();
  });

  it('上报器自身抛错不会反过来炸边界', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getByText } = render(
      <SegmentBoundary
        segment="tool-card"
        onError={() => {
          throw new Error('reporter boom');
        }}
      >
        <Boom shouldThrow />
      </SegmentBoundary>,
    );
    expect(getByText('这一段没能渲染出来')).toBeTruthy();
    spy.mockRestore();
  });
});
