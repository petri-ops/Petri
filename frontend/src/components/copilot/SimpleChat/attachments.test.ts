import { describe, expect, it, vi } from 'vitest';

import { hasImagePayload, onDrop, onPaste, VISION_NOT_CONFIGURED_NOTICE, type AttachmentFile } from './attachments';

type SetAttachments = React.Dispatch<React.SetStateAction<AttachmentFile[]>>;

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

describe('BLOCK-150 加映 — 识图未配置时图片输入前置阻断', () => {
  it('hasImagePayload：含图片载荷 true / 纯文本 false', () => {
    expect(hasImagePayload({ items: [{ type: 'text/plain' }], files: [] })).toBe(false);
    expect(hasImagePayload({ items: [{ type: 'image/png' }], files: [] })).toBe(true);
    expect(hasImagePayload({ items: [], files: [new File(['x'], 'a.png', { type: 'image/png' })] })).toBe(true);
  });

  it('onPaste visionEnabled=false + 图片 → 阻断：preventDefault、不加附件、返回提示文案', () => {
    const setAttachments = vi.fn();
    const { event, preventDefault } = fakePasteEvent(['image/png']);
    const notice = onPaste(event, setAttachments, { visionEnabled: false });
    expect(preventDefault).toHaveBeenCalled();
    expect(setAttachments).not.toHaveBeenCalled();
    expect(notice).toBe(VISION_NOT_CONFIGURED_NOTICE);
    expect(VISION_NOT_CONFIGURED_NOTICE).toContain('识图模型未配置');
  });

  it('onPaste 默认（未传 options）保持旧行为：不返回阻断文案', () => {
    const setAttachments = vi.fn();
    const { event } = fakePasteEvent(['image/png']);
    const notice = onPaste(event, setAttachments);
    expect(notice).toBeUndefined();
    expect(setAttachments).not.toHaveBeenCalled(); // FileReader 异步，同步阶段不落
  });

  it('onDrop visionEnabled=false + 图片文件 → 阻断并返回提示；非图片文件不受影响', () => {
    const setAttachments = vi.fn();
    const setIsDraggingOver = vi.fn();
    const blocked = onDrop(
      fakeDropEvent([new File(['x'], 'a.png', { type: 'image/png' })]).event,
      setAttachments,
      setIsDraggingOver,
      { visionEnabled: false },
    );
    expect(blocked).toBe(VISION_NOT_CONFIGURED_NOTICE);
    expect(setAttachments).not.toHaveBeenCalled();
    const textOnly = onDrop(
      fakeDropEvent([new File(['x'], 'a.csv', { type: 'text/csv' })]).event,
      setAttachments,
      setIsDraggingOver,
      { visionEnabled: false },
    );
    expect(textOnly).not.toBe(VISION_NOT_CONFIGURED_NOTICE);
  });
});
