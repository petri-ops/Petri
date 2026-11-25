// 自定义水印图片处理 — HK-01 红绿先行消费测试。
// 判据：格式/大小限制 + 诚实错误；canvas alpha 提取（负片 + level 8%/85%）
// 为纯函数可测，不依赖后端、不引入新依赖。观感零代签。
import { describe, expect, it } from 'vitest';
import {
  WATERMARK_IMAGE_MAX_BYTES,
  validateWatermarkFile,
  parseWatermarkInput,
  alphaFromLuminance,
  applyWatermarkAlpha,
} from './watermarkImage';

describe('自定义水印图片', () => {
  it('只接受白名单图片格式并限制大小，拒绝时给诚实错误', () => {
    expect(validateWatermarkFile({ type: 'image/png', size: 1024 }).ok).toBe(true);
    expect(validateWatermarkFile({ type: 'image/jpeg', size: 1024 }).ok).toBe(true);
    expect(validateWatermarkFile({ type: 'image/webp', size: 1024 }).ok).toBe(true);
    expect(validateWatermarkFile({ type: 'image/svg+xml', size: 1024 }).ok).toBe(false);
    expect(validateWatermarkFile({ type: 'text/plain', size: 1024 }).ok).toBe(false);
    const tooBig = validateWatermarkFile({ type: 'image/png', size: WATERMARK_IMAGE_MAX_BYTES + 1 });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error).toMatch(/大小/);
  });

  it('路径输入分类：data URI / 同源路径接受；本地绝对路径与外链给诚实提示', () => {
    expect(parseWatermarkInput('data:image/png;base64,iVBORw0KGgo=').kind).toBe('data');
    expect(parseWatermarkInput('/api/files/uploads/a.png').kind).toBe('same-origin');
    expect(parseWatermarkInput('uploads/a.png').kind).toBe('same-origin');
    const local = parseWatermarkInput('/Users/me/watermark.png');
    expect(local.kind).toBe('local-path');
    expect(local.error).toMatch(/选择文件/);
    const remote = parseWatermarkInput('https://example.com/watermark.png');
    expect(remote.kind).toBe('external');
    expect(remote.error).toMatch(/域名/);
    expect(parseWatermarkInput('  ').kind).toBe('invalid');
  });

  it('负片 + level 8%/85%：浅底变透明、深墨保留', () => {
    // level 8% = 20.4，85% = 216.75：alpha = clamp((255-lum-20.4)/196.35*255)
    expect(alphaFromLuminance(255)).toBe(0); // 纯白底 → 全透明
    expect(alphaFromLuminance(0)).toBe(255); // 纯黑墨 → 不透明
    expect(alphaFromLuminance(200)).toBeLessThan(alphaFromLuminance(100));
    expect(alphaFromLuminance(240)).toBe(0);
  });

  it('转透明后像素统一为墨色 #1b2b40，alpha 逐像素计算', () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255, // 白底 → 透明
      0, 0, 0, 255,       // 黑墨 → 实色
      128, 128, 128, 255, // 中灰 → 中间 alpha
    ]);
    const out = applyWatermarkAlpha(pixels);
    expect([out[0], out[1], out[2]]).toEqual([0x1b, 0x2b, 0x40]);
    expect(out[3]).toBe(0);
    expect([out[4], out[5], out[6]]).toEqual([0x1b, 0x2b, 0x40]);
    expect(out[7]).toBe(255);
    expect(out[11]).toBeGreaterThan(0);
    expect(out[11]).toBeLessThan(255);
  });
});
