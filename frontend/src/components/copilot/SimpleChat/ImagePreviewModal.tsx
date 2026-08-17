// ============================================================
// ImagePreviewModal.tsx — SimpleChat image preview modal
//
// Extracted from SimpleChat.tsx by BLOCK-9.2 PHASE 4 (commit 1). A
// self-contained modal component: zoom in/out, reset, Escape key, and
// click-on-overlay to close. No coupling to SimpleChat state — the
// attachment + onClose callback come in as props.
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { AttachmentFile } from './attachments';

export interface ImagePreviewModalProps {
  attachment: AttachmentFile;
  onClose: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImagePreviewModal({
  attachment,
  onClose,
}: ImagePreviewModalProps): React.ReactElement {
  const [zoom, setZoom] = useState(1);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => setZoom(1);

  const imageSrc = attachment.dataUrl || attachment.previewUrl || '';

  return (
    <div
      className="sc-preview-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
    >
      <div
        className="sc-preview-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sc-preview-header">
          <span className="sc-preview-filename" title={attachment.name}>
            {attachment.name}
          </span>
          <div className="sc-preview-controls">
            <button
              type="button"
              className="sc-preview-control-btn"
              onClick={handleZoomOut}
              title="缩小"
              aria-label="缩小"
            >
              <Icon name="minus" size={14} />
            </button>
            <span className="sc-preview-zoom-label">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="sc-preview-control-btn"
              onClick={handleZoomIn}
              title="放大"
              aria-label="放大"
            >
              <Icon name="plus" size={14} />
            </button>
            <button
              type="button"
              className="sc-preview-control-btn"
              onClick={handleResetZoom}
              title="重置缩放"
              aria-label="重置缩放"
            >
              1:1
            </button>
            <span className="sc-preview-sep" aria-hidden />
            <button
              type="button"
              className="sc-preview-close-btn"
              onClick={onClose}
              title="关闭 (Esc)"
              aria-label="关闭"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        {/* Image */}
        <div className="sc-preview-image-area">
          <img
            ref={imageRef}
            src={imageSrc}
            alt={attachment.name}
            className="sc-preview-image"
            style={{ transform: `scale(${zoom})` }}
          />
        </div>

        {/* Footer */}
        <div className="sc-preview-footer">
          <span className="sc-preview-info">
            {formatFileSize(attachment.size)} · {attachment.type || '未知类型'}
          </span>
          <span className="sc-preview-hint">ESC 或点击背景关闭</span>
        </div>
      </div>
    </div>
  );
}