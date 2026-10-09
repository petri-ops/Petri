import { describe, expect, it, vi } from 'vitest';

import {
  hasImagePayload,
  imageInputAllowed,
  onDrop,
  onPaste,
  VISION_NOT_CONFIGURED_NOTICE,
} from './attachments';

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

describe('BLOCK-155 真·单通道 vision — 放行判据单源（vision_configured || 聊天渠道视觉能力）', () => {
  it('imageInputAllowed 判据矩阵：两者皆无才阻断', () => {
    expect(imageInputAllowed(false, false)).toBe(false);
    expect(imageInputAllowed(false, undefined)).toBe(false);
    expect(imageInputAllowed(false, true)).toBe(true);
    expect(imageInputAllowed(true, false)).toBe(true);
    expect(imageInputAllowed(true, true)).toBe(true);
    // 取数失败/旧后端无字段（vision_configured 未知）→ 保守放行（BLOCK-150 语义不回归）
    expect(imageInputAllowed(undefined, false)).toBe(true);
  });

  it('识图未配置 + 聊天渠道 capabilities 含 vision → onPaste 放行：无阻断文案、正常进入附件读取', () => {
    const setAttachments = vi.fn();
    const { event, preventDefault } = fakePasteEvent(['image/png']);
    const notice = onPaste(event, setAttachments, { visionEnabled: false, chatVisionCapable: true });
    expect(notice).toBeUndefined();
    expect(preventDefault).toHaveBeenCalled();
    expect(setAttachments).not.toHaveBeenCalled(); // FileReader 异步，同步阶段不落（与既有默认行为用例同口径）
  });

  it('识图未配置 + 聊天渠道 capabilities 含 vision → onDrop 放行：图片文件正常入列、不返回阻断文案', () => {
    const setAttachments = vi.fn();
    const setIsDraggingOver = vi.fn();
    const result = onDrop(
      fakeDropEvent([new File(['x'], 'a.png', { type: 'image/png' })]).event,
      setAttachments,
      setIsDraggingOver,
      { visionEnabled: false, chatVisionCapable: true },
    );
    expect(result).not.toBe(VISION_NOT_CONFIGURED_NOTICE);
    expect(setIsDraggingOver).toHaveBeenCalledWith(false);
    expect(setAttachments).toHaveBeenCalled();
  });

  it('识图未配置 + 聊天渠道无 vision → 仍阻断（chatVisionCapable 缺省=false 同口径）', () => {
    const withFalse = onPaste(
      fakePasteEvent(['image/png']).event,
      vi.fn(),
      { visionEnabled: false, chatVisionCapable: false },
    );
    expect(withFalse).toBe(VISION_NOT_CONFIGURED_NOTICE);
  });

  it('识图已配置 + 聊天渠道无 vision → 放行（识图角色独立成立，回归锚）', () => {
    const notice = onPaste(
      fakePasteEvent(['image/png']).event,
      vi.fn(),
      { visionEnabled: true, chatVisionCapable: false },
    );
    expect(notice).toBeUndefined();
  });
});
