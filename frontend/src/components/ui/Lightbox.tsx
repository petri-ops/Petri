/**
 * Lightbox — fullscreen image viewer.
 *
 * Esc or a plain click closes; wheel zooms, drag pans, double-click resets.
 * No dependencies, pure CSS + React state.
 */

import React, { useEffect, useRef, useState } from 'react';
import './Lightbox.css';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** 位移低于该像素和时视为“纯点击”（关闭），否则视为拖拽平移。 */
const CLOSE_DRIFT_PX = 3;

export function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}): React.ReactElement | null {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // 滚轮缩放必须 preventDefault 阻止页面滚动，React 合成 wheel 在部分宿主是
  // passive 监听，preventDefault 会失效——用原生非 passive 监听钉住。
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => {
        const next = event.deltaY < 0 ? current * 1.15 : current / 1.15;
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      });
    };
    img.addEventListener('wheel', onWheel, { passive: false });
    return () => img.removeEventListener('wheel', onWheel);
  }, []);

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > CLOSE_DRIFT_PX) drag.moved = true;
    setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
    drag.x = event.clientX;
    drag.y = event.clientY;
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved) onClose();
  };

  return (
    <div
      className="petri-lightbox"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={reset}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt || ''}
        className="petri-lightbox__img"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : 'zoom-in' }}
        data-zoom={String(Number(zoom.toFixed(3)))}
        data-pan={`${Math.round(pan.x)},${Math.round(pan.y)}`}
        draggable={false}
      />
      <button
        className="petri-lightbox__close"
        type="button"
        onClick={onClose}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label="关闭"
      >
        ×
      </button>
      <span className="petri-lightbox__hint">滚轮缩放 · 拖拽平移 · 双击复位</span>
    </div>
  );
}
