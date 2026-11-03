import { describe, expect, it } from 'vitest';
import {
  fitImageBox,
  IMAGE_EMBED_MAX_BYTES,
  imageInsertOp,
  isSafeImageDataUrl,
  validateEmbedFile,
} from './svgEditorImage';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

describe('BLOCK-342 图片嵌入（安全边界）', () => {
  it('validateEmbedFile：白名单类型通过', () => {
    expect(validateEmbedFile({ type: 'image/png', size: 1024 })).toEqual({ ok: true });
    expect(validateEmbedFile({ type: 'image/webp', size: IMAGE_EMBED_MAX_BYTES })).toEqual({ ok: true });
  });

  it('validateEmbedFile：SVG 显式拒绝（脱敏走私面）并说明原因', () => {
    const r = validateEmbedFile({ type: 'image/svg+xml', size: 100, name: 'icon.svg' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('SVG');
  });

  it('validateEmbedFile：非图片与超限拒绝', () => {
    expect(validateEmbedFile({ type: 'application/pdf', size: 10 }).ok).toBe(false);
    expect(validateEmbedFile({ type: 'image/png', size: IMAGE_EMBED_MAX_BYTES + 1 }).ok).toBe(false);
  });

  it('isSafeImageDataUrl：白名单形态放行，危险/歪形态拒绝', () => {
    expect(isSafeImageDataUrl(PNG_DATA_URL)).toBe(true);
    expect(isSafeImageDataUrl('data:text/html;base64,PGI+')).toBe(false);
    expect(isSafeImageDataUrl('https://example.com/a.png')).toBe(false);
    expect(isSafeImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(isSafeImageDataUrl('data:image/png;base64,"><script>')).toBe(false);
  });

  it('fitImageBox：大图缩到 maxEdge、小图放到 minEdge、非法尺寸回落占位', () => {
    expect(fitImageBox(2000, 1000)).toEqual({ x: 20, y: 20, width: 320, height: 160 });
    expect(fitImageBox(20, 10)).toEqual({ x: 20, y: 20, width: 64, height: 32 });
    expect(fitImageBox(120, 80)).toEqual({ x: 20, y: 20, width: 120, height: 80 });
    expect(fitImageBox(0, 0)).toEqual({ x: 20, y: 20, width: 160, height: 120 });
  });

  it('imageInsertOp：白名单 insert markup；不安全 dataUrl 拒绝', () => {
    const op = imageInsertOp(PNG_DATA_URL, { x: 10.4, y: 20, width: 64, height: 64 });
    expect(op).toEqual({
      op: 'insert',
      parent: { path: [] },
      index: 'end',
      markup: `<image href="${PNG_DATA_URL}" x="10.4" y="20" width="64" height="64" preserveAspectRatio="xMidYMid meet" />`,
    });
    expect(imageInsertOp('javascript:alert(1)', { x: 0, y: 0, width: 10, height: 10 })).toBeNull();
  });
});
