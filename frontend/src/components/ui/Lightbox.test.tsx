import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lightbox } from './Lightbox';

afterEach(cleanup);

describe('Lightbox', () => {
  it('closes on Escape and on a plain background click', () => {
    const onClose = vi.fn();
    render(<Lightbox src="plot.png" alt="volcano" onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('zooms in and out with the wheel and clamps the range', () => {
    render(<Lightbox src="plot.png" alt="volcano" onClose={() => {}} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('data-zoom')).toBe('1');
    fireEvent.wheel(img, { deltaY: -240 });
    expect(Number(img.getAttribute('data-zoom'))).toBeGreaterThan(1);
    for (let i = 0; i < 20; i += 1) fireEvent.wheel(img, { deltaY: -240 });
    expect(Number(img.getAttribute('data-zoom'))).toBeLessThanOrEqual(8);
    for (let i = 0; i < 40; i += 1) fireEvent.wheel(img, { deltaY: 240 });
    expect(Number(img.getAttribute('data-zoom'))).toBeGreaterThanOrEqual(1);
  });

  it('pans by dragging the image and does not close when the pointer moved', () => {
    const onClose = vi.fn();
    render(<Lightbox src="plot.png" alt="volcano" onClose={onClose} />);
    const img = screen.getByRole('img');
    fireEvent.pointerDown(img, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(img, { clientX: 150, clientY: 130 });
    fireEvent.pointerUp(img, { clientX: 150, clientY: 130 });
    expect(img.getAttribute('data-pan')).toBe('50,30');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('treats a near-zero-length pointer press as a close click', () => {
    const onClose = vi.fn();
    render(<Lightbox src="plot.png" alt="volcano" onClose={onClose} />);
    const overlay = screen.getByRole('img').parentElement as HTMLElement;
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(overlay, { clientX: 102, clientY: 101 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets zoom and pan on double click', () => {
    render(<Lightbox src="plot.png" alt="volcano" onClose={() => {}} />);
    const img = screen.getByRole('img');
    fireEvent.wheel(img, { deltaY: -240 });
    fireEvent.pointerDown(img, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(img, { clientX: 25, clientY: 15 });
    fireEvent.pointerUp(img, { clientX: 25, clientY: 15 });
    expect(Number(img.getAttribute('data-zoom'))).toBeGreaterThan(1);
    expect(img.getAttribute('data-pan')).not.toBe('0,0');
    fireEvent.dblClick(img);
    expect(img.getAttribute('data-zoom')).toBe('1');
    expect(img.getAttribute('data-pan')).toBe('0,0');
  });

  it('BLOCK-301 — portals to document.body（脱离面板 stacking context 真全屏置顶）', () => {
    const { baseElement } = render(
      <div data-testid="panel-root" style={{ transform: 'translateX(0)' }}>
        <Lightbox src="plot.png" alt="volcano" onClose={() => {}} />
      </div>,
    );
    // 灯箱不在组件树容器内，而是 body 直挂——面板祖先的 transform/z-index 不再降格 fixed 全屏。
    const lightbox = document.body.querySelector(':scope > .petri-lightbox');
    expect(lightbox).toBeTruthy();
    expect(baseElement.querySelector('[data-testid="panel-root"] .petri-lightbox')).toBeNull();
    // 关闭后 portal 节点随卸载退场
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    cleanup();
    expect(document.body.querySelector(':scope > .petri-lightbox')).toBeNull();
  });
});
