// ============================================================
// ImagePreviewModal.tsx — SimpleChat image preview modal
//
// Extracted from SimpleChat.tsx by BLOCK-9.2 PHASE 4 (commit 1). A
// self-contained modal component: zoom in/out, reset, Escape key, and
// click-on-overlay to close. No coupling to SimpleChat state — the
// attachment + onClose callback come in as props.
//
// BLOCK-246 C11 加映：保存原图（download 锚点，文件名保留扩展名）、
// 多图上一张/下一张（含 N/M 计数与 ←/→ 键）、缩放预设 50/100/200%。
// 向后兼容：调用方只传 `attachment` 时行为与从前一致（单图、无导航）。
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { AttachmentFile } from './attachments';

export interface ImagePreviewModalProps {
  attachment: AttachmentFile;
  onClose: () => void;
  /** 同一批图片（含当前这张）；不传 = 单图模式，不显示导航。 */
  items?: AttachmentFile[];
  /** 切换图片时通知宿主（宿主可据此更新标题/选中态）。 */
  onNavigate?: (attachment: AttachmentFile) => void;
}

/** 缩放预设（比例值）。100% 即原始尺寸。 */
const ZOOM_PRESETS = [0.5, 1, 2] as const;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 下载名：保留原扩展名；没有扩展名时按图片类型补一个（否则系统不认）。 */
function downloadName(attachment: AttachmentFile): string {
  const name = attachment.name || 'image';
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const subtype = (attachment.type || 'image/png').split('/')[1] || 'png';
  return `${name}.${subtype.replace(/[^a-z0-9]/gi, '') || 'png'}`;
}

export function ImagePreviewModal({
  attachment,
  onClose,
  items,
  onNavigate,
}: ImagePreviewModalProps): React.ReactElement {
  const gallery = useMemo(
    () => (items && items.length > 0 ? items : [attachment]),
    [attachment, items],
  );
  const anchorIndex = Math.max(0, gallery.findIndex((item) => item.id === attachment.id));
  const [index, setIndex] = useState(anchorIndex);
  const [zoom, setZoom] = useState(1);
  const imageRef = useRef<HTMLImageElement>(null);

  // 宿主换图（点另一张缩略图）时跟上；同一批内导航由本组件自己推进。
  useEffect(() => {
    setIndex(anchorIndex);
    setZoom(1);
  }, [anchorIndex, attachment.id]);

  const current = gallery[index] ?? attachment;
  const hasGallery = gallery.length > 1;

  const goTo = useCallback((nextIndex: number) => {
    const clamped = (nextIndex + gallery.length) % gallery.length;
    setIndex(clamped);
    setZoom(1);
    onNavigate?.(gallery[clamped]);
  }, [gallery, onNavigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowRight' && hasGallery) {
        e.preventDefault();
        goTo(index + 1);
        return;
      }
      if (e.key === 'ArrowLeft' && hasGallery) {
        e.preventDefault();
        goTo(index - 1);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [goTo, hasGallery, index, onClose]);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + ZOOM_STEP, ZOOM_MAX));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - ZOOM_STEP, ZOOM_MIN));
  const handleResetZoom = () => setZoom(1);

  const imageSrc = current.dataUrl || current.previewUrl || '';

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
          <span className="sc-preview-filename" title={current.name}>
            {current.name}
            {hasGallery && (
              <span className="sc-preview-counter" data-testid="sc-preview-counter">
                {' '}
                {index + 1}/{gallery.length}
              </span>
            )}
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
            {ZOOM_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="sc-preview-control-btn"
                onClick={() => setZoom(preset)}
                title={`缩放到 ${preset * 100}%`}
                aria-label={`缩放到 ${preset * 100}%`}
                aria-pressed={Math.abs(zoom - preset) < 0.001}
                data-testid={`sc-preview-zoom-${preset * 100}`}
              >
                {preset * 100}%
              </button>
            ))}
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
            <a
              className="sc-preview-control-btn"
              href={imageSrc}
              download={downloadName(current)}
              title="保存图片到本地"
              aria-label="保存图片"
              data-testid="sc-preview-save"
              // 覆盖层 onClick 关窗：点保存不该顺手把预览关掉
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="download" size={14} />
            </a>
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
          {hasGallery && (
            <button
              type="button"
              className="sc-preview-nav-btn sc-preview-nav-prev"
              onClick={() => goTo(index - 1)}
              title="上一张（←）"
              aria-label="上一张"
              data-testid="sc-preview-prev"
            >
              ‹
            </button>
          )}
          <img
            ref={imageRef}
            src={imageSrc}
            alt={current.name}
            className="sc-preview-image"
            style={{ transform: `scale(${zoom})` }}
          />
          {hasGallery && (
            <button
              type="button"
              className="sc-preview-nav-btn sc-preview-nav-next"
              onClick={() => goTo(index + 1)}
              title="下一张（→）"
              aria-label="下一张"
              data-testid="sc-preview-next"
            >
              ›
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="sc-preview-footer">
          <span className="sc-preview-info">
            {formatFileSize(current.size)} · {current.type || '未知类型'}
          </span>
          <span className="sc-preview-hint">
            {hasGallery ? '← → 切换图片 · ' : ''}
            ESC 或点击背景关闭
          </span>
        </div>
      </div>
    </div>
  );
}
