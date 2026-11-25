import { describe, expect, it, vi } from 'vitest';

import {
  onDragOver,
  onDrop,
  onPaste,
  addExternalImage,
} from './attachments';
import { CONVERSATION_DRAG_MIME } from './dragTypes';

function fakePasteEvent(types: string[]) {
  const preventDefault = vi.fn();
  const event = {
    clipboardData: {
      items: types.map((t, i) => ({ type: t, getAsFile: () => new File([`f${i}`], `f${i}.png`, { type: t }) })),
    },
    preventDefault,
  };
  return { event: event as unknown as React.ClipboardEvent, preventDefault };
}

function fakeDropEvent(files: File[]) {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const event = {
    dataTransfer: { files, items: files.map((f) => ({ type: f.type, getAsFile: () => f })) },
    preventDefault,
    stopPropagation,
  };
  return { event: event as unknown as React.DragEvent, preventDefault, stopPropagation };
}

describe('BLOCK-518 声明面退役 — 贴图/拖图始终放行（双位前置门退役）', () => {
  it('onPaste 图片 → 始终放行：preventDefault、无阻断文案、进入附件读取', () => {
    const setAttachments = vi.fn();
    const { event, preventDefault } = fakePasteEvent(['image/png']);
    const notice = onPaste(event, setAttachments);
    expect(preventDefault).toHaveBeenCalled();
    expect(notice).toBeUndefined();
    expect(setAttachments).not.toHaveBeenCalled(); // FileReader 异步，同步阶段不落
  });

  it('onDrop 图片文件 → 正常入列、不返回阻断文案；非图片文件不受影响', () => {
    const setAttachments = vi.fn();
    const setIsDraggingOver = vi.fn();
    const result = onDrop(
      fakeDropEvent([new File(['x'], 'a.png', { type: 'image/png' })]).event,
      setAttachments,
      setIsDraggingOver,
    );
    expect(result).toBeUndefined();
    expect(setIsDraggingOver).toHaveBeenCalledWith(false);
    expect(setAttachments).toHaveBeenCalled();
    const textOnly = onDrop(
      fakeDropEvent([new File(['x'], 'a.csv', { type: 'text/csv' })]).event,
      setAttachments,
      setIsDraggingOver,
    );
    expect(textOnly).toBeUndefined();
  });

  it('onDrop 视频文件同样放行（视频门同源退役；上游诚实报错）', () => {
    const setAttachments = vi.fn();
    const setIsDraggingOver = vi.fn();
    const result = onDrop(
      fakeDropEvent([new File(['x'], 'demo.mp4', { type: 'video/mp4' })]).event,
      setAttachments,
      setIsDraggingOver,
    );
    expect(result).toBeUndefined();
    expect(setAttachments).toHaveBeenCalled();
  });
});

describe('BLOCK-255 C17 — 会话拖拽态与文件拖拽共存', () => {
  it('onDragOver 接受会话 MIME（composer 高亮），并保持 Files 行为', () => {
    const setIsDraggingOver = vi.fn();
    onDragOver({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { types: [CONVERSATION_DRAG_MIME] },
    } as unknown as React.DragEvent, setIsDraggingOver);
    expect(setIsDraggingOver).toHaveBeenCalledWith(true);

    const fileGuard = vi.fn();
    onDragOver({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { types: ['text/plain'] },
    } as unknown as React.DragEvent, fileGuard);
    expect(fileGuard).not.toHaveBeenCalled();
  });
});


describe('BLOCK-343 P3 addExternalImage', () => {
  const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

  it('合法 data:image/png 注入为 AttachmentFile（size 按 base64 折算）', () => {
    let out: unknown[] = [];
    const set = (fn: (prev: unknown[]) => unknown[]) => { out = fn([]); };
    addExternalImage(set as never, { dataUrl: PNG_1PX, name: 'rc.png' }, 0);
    expect(out).toHaveLength(1);
    const att = (out as Array<{ name: string; type: string; size: number; dataUrl: string }>)[0];
    expect(att.name).toBe('rc.png');
    expect(att.type).toBe('image/png');
    expect(att.size).toBeGreaterThan(0);
    expect(att.dataUrl).toBe(PNG_1PX);
  });

  it('非图片形态 / 超单件上限 / 超件数上限一律拒收', () => {
    let out: unknown[] = [];
    const set = (fn: (prev: unknown[]) => unknown[]) => { out = fn([]); };
    addExternalImage(set as never, { dataUrl: 'data:text/html;base64,PGI+' }, 0);
    addExternalImage(set as never, { dataUrl: 'https://x/y.png' }, 0);
    const huge = `data:image/png;base64,${'A'.repeat(14 * 1024 * 1024)}`;
    addExternalImage(set as never, { dataUrl: huge }, 0);
    addExternalImage(set as never, { dataUrl: PNG_1PX }, 8);
    expect(out).toHaveLength(0);
  });
});
