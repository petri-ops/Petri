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

export interface AttachmentFile {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  previewUrl?: string;
}

/** Drag-over guard: only flip the dragging flag when real Files are being dragged. */
export function onDragOver(
  e: React.DragEvent,
  setIsDraggingOver: (value: boolean) => void
): void {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer.types.includes('Files')) {
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

/** Drop: turn FileList into AttachmentFile rows with object-URL preview for images. */
export function onDrop(
  e: React.DragEvent,
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentFile[]>>,
  setIsDraggingOver: (value: boolean) => void
): void {
  e.preventDefault();
  e.stopPropagation();
  setIsDraggingOver(false);

  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;

  const newAttachments: AttachmentFile[] = files.map((file) => ({
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: file.name,
    type: file.type,
    size: file.size,
    previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
  }));

  setAttachments((prev) => [...prev, ...newAttachments]);
}

/** Paste: read clipboard image items as data URLs and append them to the attachment list. */
export function onPaste(
  e: React.ClipboardEvent,
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentFile[]>>
): void {
  const items = e.clipboardData?.items;
  if (!items) return;

  const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));

  if (imageItems.length === 0) return;

  e.preventDefault();

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