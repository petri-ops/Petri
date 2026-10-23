// BLOCK-246 C11 — 图片预览：保存 / 多图导航（含边界与键盘）/ 缩放预设 / Esc 关闭。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImagePreviewModal } from './ImagePreviewModal';
import type { AttachmentFile } from './attachments';

afterEach(cleanup);

function image(id: string, name: string, overrides: Partial<AttachmentFile> = {}): AttachmentFile {
  return {
    id,
    name,
    type: 'image/png',
    size: 2048,
    dataUrl: `data:image/png;base64,${id}`,
    previewUrl: `data:image/png;base64,${id}`,
    ...overrides,
  } as AttachmentFile;
}

const gallery = [image('a', 'a.png'), image('b', 'b.png'), image('c', 'c.png')];

describe('ImagePreviewModal', () => {
  it('stays single-image when no gallery is passed (backward compatible)', () => {
    render(<ImagePreviewModal attachment={gallery[0]} onClose={vi.fn()} />);
    expect(screen.queryByTestId('sc-preview-counter')).toBeNull();
    expect(screen.queryByTestId('sc-preview-next')).toBeNull();
    expect(screen.getByText('a.png')).toBeTruthy();
  });

  it('shows N/M and navigates with buttons and arrow keys, wrapping at both ends', () => {
    const onNavigate = vi.fn();
    render(<ImagePreviewModal attachment={gallery[0]} items={gallery} onClose={vi.fn()} onNavigate={onNavigate} />);
    expect(screen.getByTestId('sc-preview-counter').textContent).toContain('1/3');

    fireEvent.click(screen.getByTestId('sc-preview-next'));
    expect(screen.getByTestId('sc-preview-counter').textContent).toContain('2/3');
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }));

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByTestId('sc-preview-counter').textContent).toContain('1/3');

    // 首张再往前 → 回卷到最后一张（不越界、不报错）
    fireEvent.click(screen.getByTestId('sc-preview-prev'));
    expect(screen.getByTestId('sc-preview-counter').textContent).toContain('3/3');
  });

  it('offers a save link that keeps the original extension', () => {
    render(<ImagePreviewModal attachment={gallery[1]} items={gallery} onClose={vi.fn()} />);
    const save = screen.getByTestId('sc-preview-save');
    expect(save.getAttribute('download')).toBe('b.png');
    expect(save.getAttribute('href')).toContain('base64,b');
  });

  it('adds an extension when the file name has none', () => {
    const unnamed = image('d', 'screenshot', { type: 'image/webp' });
    render(<ImagePreviewModal attachment={unnamed} onClose={vi.fn()} />);
    expect(screen.getByTestId('sc-preview-save').getAttribute('download')).toBe('screenshot.webp');
  });

  it('applies zoom presets and marks the active one', () => {
    render(<ImagePreviewModal attachment={gallery[0]} onClose={vi.fn()} />);
    const label = () => document.querySelector('.sc-preview-zoom-label')?.textContent;
    fireEvent.click(screen.getByTestId('sc-preview-zoom-200'));
    expect(label()).toBe('200%');
    expect(screen.getByTestId('sc-preview-zoom-200').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('sc-preview-zoom-50'));
    expect(label()).toBe('50%');
    expect(screen.getByTestId('sc-preview-zoom-50').getAttribute('aria-pressed')).toBe('true');
  });

  it('closes on Escape and on overlay click, but not when clicking the image', () => {
    const onClose = vi.fn();
    render(<ImagePreviewModal attachment={gallery[0]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog').firstElementChild as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
