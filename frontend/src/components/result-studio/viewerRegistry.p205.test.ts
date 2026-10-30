import { describe, expect, it } from 'vitest';
import { resolveResultViewer, viewerProfileCanExport, viewerProfileCanSelect } from './viewerRegistry';

/**
 * BLOCK-322 P2-05 — viewerRegistry 视频路由契约。
 *
 * 契约：`.mp4/.webm` 必须落 video adapter（先于 json/text/binary 兜底），profile 为
 * 「可导出、不可选择、不可比较」。视频没有文本选择语义，也不存在两份视频的 diff 语义，
 * 能力位如实 false 而不是为了面板上多一个按钮而点亮。
 */
describe('P2-05 viewerRegistry video routing', () => {
  it('.mp4/.webm 命中 video adapter（kind 为 file/data 也按扩展名命中）', () => {
    for (const fileName of ['turntable0001-0008.mp4', 'turntable.webm', 'TURNTABLE.MP4']) {
      for (const kind of ['file', 'data', 'model3d'] as const) {
        expect(resolveResultViewer({ kind, fileName }).adapter).toBe('video');
      }
    }
  });

  it('video profile：可导出原文，不可选择、不可比较', () => {
    const resolved = resolveResultViewer({ kind: 'file', fileName: 'turntable.mp4' });
    expect(resolved.canExport).toBe(true);
    expect(resolved.canSelect).toBe(false);
    expect(resolved.canCompare).toBe(false);
    expect(viewerProfileCanExport('video')).toBe(true);
    expect(viewerProfileCanSelect('video')).toBe(false);
  });

  it('未被视频规则误捕的相邻形态保持原路由', () => {
    expect(resolveResultViewer({ kind: 'model3d', fileName: 'a.glb' }).adapter).toBe('model3d');
    expect(resolveResultViewer({ kind: 'file', fileName: 'front.png' }).adapter).toBe('image');
    expect(resolveResultViewer({ kind: 'file', fileName: 'notes.txt' }).adapter).toBe('text');
    expect(resolveResultViewer({ kind: 'file', fileName: 'clip.mp3' }).adapter).toBe('binary');
    expect(resolveResultViewer({ kind: 'file', fileName: 'scene.json' }).adapter).toBe('json');
  });

  it('preview=false 的短路仍先于视频规则（与既有一致）', () => {
    expect(resolveResultViewer({ kind: 'file', fileName: 'turntable.mp4', preview: false }).adapter).toBe('binary');
  });
});
