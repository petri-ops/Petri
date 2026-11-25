// ============================================================
// attachments.ts — SimpleChat attachment types + drag/drop/paste handlers
//
// Extracted from SimpleChat.tsx by BLOCK-9.2 PHASE 4 (commit 1). These
// helpers don't depend on SimpleChat's local state for the lifecycle bits
// that matter: they consume the three attachment-related setters as
// parameters (setAttachments, setIsDraggingOver, setPreviewImage) so the
// hook order in the host component stays unchanged.
//
// State itself (attachments / isDraggingOver / previewImage) is kept in
// the SimpleChat main component per the hooks-order constraint
// (BLOCK-9.2 PHASE 4 §3.2).
// ============================================================

import type * as React from 'react';
import { attachmentCountNotice, attachmentTooLargeNotice } from './contextLimits';
import { CONVERSATION_DRAG_MIME } from './dragTypes';

export interface AttachmentFile {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  previewUrl?: string;
  /** BLOCK-91 — 拖入文件的原始句柄（发送前由 uploadAttachment 读取内容）。 */
  file?: File;
}

/** 单附件大小上限（10MB）——超限诚实拒收（BLOCK-91，与 attachmentUpload 上传校验同源）。 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** 单次消息附件数量上限。 */
export const MAX_ATTACHMENTS = 8;

/** 附件大小校验：超限返回报错文案（文案单源 = contextLimits）。 */
export function validateAttachmentSize(size: number, name: string): string | null {
  if (size > MAX_ATTACHMENT_BYTES) {
    return attachmentTooLargeNotice(name, MAX_ATTACHMENT_BYTES);
  }
  return null;
}

/** Drag-over guard: only flip the dragging flag when real Files are being dragged. */
export function onDragOver(
  e: React.DragEvent,
  setIsDraggingOver: (value: boolean) => void
): void {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(CONVERSATION_DRAG_MIME)) {
    setIsDraggingOver(true);
  }
}

/** Drag-leave guard: only hide when leaving the composer area entirely. */
export function onDragLeave(
  e: React.DragEvent,
  setIsDraggingOver: (value: boolean) => void
): void {
  e.preventDefault();
  e.stopPropagation();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = e.clientX;
  const y = e.clientY;
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    setIsDraggingOver(false);
  }
}

/**
 * Drop: turn FileList into AttachmentFile rows with object-URL preview for images.
 *
 * BLOCK-245 P5（C16）— 返回的提示文案不再只是"识图未配置"：超体积与超数量的
 * 拒收同样以可见文案回给宿主（原先是 `console.warn` + 静默 slice）。`existingCount`
 * 只用于**算出被拒条数**（渲染面仍在下面按 prev 实算，不因入参漂移而丢已有项）。
 */
export function onDrop(
  e: React.DragEvent,
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentFile[]>>,
  setIsDraggingOver: (value: boolean) => void,
  existingCount = 0
): string | void {
  e.preventDefault();
  e.stopPropagation();
  setIsDraggingOver(false);

  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;

  // BLOCK-518 声明面退役 — 图片/视频输入前置门（BLOCK-150 加映 / BLOCK-155 放宽 /
  // BLOCK-340 P2 的 visionConfigured+chatVisionCapable 双位门）整体退役：
  // 多模态时代贴图/拖图始终放行，图片直接进请求体；文本模型收图=上游诚实报错
  //（可见、可换模型重试），不再前置封锁。非图片附件不受影响。

  // BLOCK-91 — 上限守卫 + 拖入文件保留原始句柄（发送前由 uploadAttachment 读取）；
  // 图片异步读取 dataUrl（与粘贴行为对齐，此前拖入图片无内容载荷、发送即丢失）。
  const notices: string[] = [];
  const newAttachments: AttachmentFile[] = [];
  for (const file of files) {
    const tooBig = validateAttachmentSize(file.size, file.name);
    if (tooBig) {
      notices.push(tooBig);
      continue;
    }
    newAttachments.push({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: file.name,
      type: file.type,
      size: file.size,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      file,
    });
  }
  const rejected = Math.max(0, newAttachments.length - Math.max(0, MAX_ATTACHMENTS - existingCount));
  if (rejected > 0) notices.push(attachmentCountNotice(MAX_ATTACHMENTS, rejected));
  if (newAttachments.length === 0) return notices.length > 0 ? notices.join('；') : undefined;

  setAttachments((prev) => {
    const room = Math.max(0, MAX_ATTACHMENTS - prev.length);
    if (newAttachments.length > room) return [...prev, ...newAttachments.slice(0, room)];
    return [...prev, ...newAttachments];
  });

  for (const att of newAttachments) {
    if (att.file && att.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setAttachments((prev) => prev.map((item) => (item.id === att.id ? { ...item, dataUrl } : item)));
      };
      reader.readAsDataURL(att.file);
    }
  }
  return notices.length > 0 ? notices.join('；') : undefined;
}

/** Paste: read clipboard image items as data URLs and append them to the attachment list. */

export function onPaste(
  e: React.ClipboardEvent,
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentFile[]>>
): string | void {
  const items = e.clipboardData?.items;
  if (!items) return;

  const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));

  if (imageItems.length === 0) return;

  e.preventDefault();

  // BLOCK-518 声明面退役 — 贴图始终放行（原 visionConfigured+chatVisionCapable
  // 双位前置门退役）；文本模型收图=上游诚实报错。
  imageItems.forEach((item) => {
    const file = item.getAsFile();
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const newAttachment: AttachmentFile = {
        id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: `pasted-image-${Date.now()}.png`,
        type: file.type || 'image/png',
        size: file.size,
        dataUrl,
        previewUrl: dataUrl,
      };
      setAttachments((prev) => [...prev, newAttachment]);
    };
    reader.readAsDataURL(file);
  });
}

/** Remove one attachment; revoke its preview object URL if it owns one. */
export function removeAttachmentById(
  id: string,
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentFile[]>>
): void {
  setAttachments((prev) => {
    const att = prev.find((a) => a.id === id);
    if (att?.previewUrl && !att.dataUrl) {
      URL.revokeObjectURL(att.previewUrl);
    }
    return prev.filter((a) => a.id !== id);
  });
}

/** Open the image preview modal for a given attachment. */
export function openImagePreview(
  attachment: AttachmentFile,
  setPreviewImage: (value: AttachmentFile | null) => void
): void {
  setPreviewImage(attachment);
}

/** Close the image preview modal. */
export function closeImagePreview(
  setPreviewImage: (value: AttachmentFile | null) => void
): void {
  setPreviewImage(null);
}

/** BLOCK-343 P3 — 外部事件注入的图片附件（渲染回验快照等）。形态守卫与上限复用既有常量。 */
export function addExternalImage(
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentFile[]>>,
  detail: { dataUrl: string; name?: string },
  currentCount: number,
): void {
  const dataUrl = typeof detail?.dataUrl === 'string' ? detail.dataUrl : '';
  if (!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)) return;
  if (currentCount >= MAX_ATTACHMENTS) return;
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const size = Math.floor((base64.length * 3) / 4);
  if (size > MAX_ATTACHMENT_BYTES) return;
  const type = dataUrl.slice(5, dataUrl.indexOf(';'));
  setAttachments((prev) => [...prev, {
    id: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: detail?.name || `render-check-${Date.now()}.png`,
    type,
    size,
    dataUrl,
    previewUrl: dataUrl,
  }]);
}
