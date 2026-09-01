import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './ChatScrollbar.module.css';

const TRACK_INSET = 14; // 轨道上下留白（与左 rail 的 8px 内衬感对齐）
const THUMB_LENGTH = 125; // UI-269：thumb 固定长度（用户裁决「缩短到 125px」）

interface ChatScrollbarProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * UI-269 — 会话区自定义滚动条。
 *
 * 隐藏 macOS 原生 overlay thumb（系统样式粗/深/短暂出现，与应用纤细线条
 * 设计语言不协调），改为常驻纤细 thumb + 轨道线，视觉语言与左缘
 * MessageRail 刻度一致（低透明度、hover 加深、圆角）。
 *
 * 定位：挂在 .sc-body（非滚动容器）内，右缘偏移由 CSS 变量
 * `--scb-right` 提供（simple-chat.css 默认 12px；agentMain 0px；
 * rightChatPanel 10px），与 .sc-messages 右缘精确对齐。
 */
export function ChatScrollbar({ containerRef }: ChatScrollbarProps) {
  const [metrics, setMetrics] = useState({ clientH: 0, scrollH: 0, scrollTop: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startThumbY: number } | null>(null);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setMetrics({
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
      scrollTop: el.scrollTop,
    });
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // 内容高度变化（消息增删 / 图片加载）也要重新测量
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) ro.observe(child);
      measure();
    });
    mo.observe(el, { childList: true });
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
      mo.disconnect();
    };
  }, [containerRef, measure]);

  const { clientH, scrollH, scrollTop } = metrics;
  const overflow = scrollH > clientH + 1;
  const maxScroll = Math.max(0, scrollH - clientH);
  const trackH = Math.max(0, clientH - TRACK_INSET * 2);
  const thumbH = Math.min(THUMB_LENGTH, trackH);
  const maxThumbY = Math.max(0, trackH - thumbH);
  const thumbY = maxScroll > 0 ? (scrollTop / maxScroll) * maxThumbY : 0;

  const onThumbDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startThumbY: thumbY };
      setDragging(true);
    },
    [thumbY]
  );

  const onThumbMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const el = containerRef.current;
      if (!drag || !el || maxThumbY <= 0) return;
      const nextY = Math.max(0, Math.min(maxThumbY, drag.startThumbY + (e.clientY - drag.startY)));
      el.scrollTop = (nextY / maxThumbY) * (el.scrollHeight - el.clientHeight);
    },
    [containerRef, maxThumbY]
  );

  const onThumbUp = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  // 点击轨道空白：以点击处为中心平滑跳转
  const onTrackDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!el || maxThumbY <= 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientY - rect.top - TRACK_INSET - thumbH / 2) / maxThumbY;
      el.scrollTo({
        top: Math.max(0, Math.min(1, ratio)) * (el.scrollHeight - el.clientHeight),
        behavior: 'smooth',
      });
    },
    [containerRef, maxThumbY, thumbH]
  );

  // 热区拦截了 pointer 事件，滚轮手动透传给消息容器
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTop += e.deltaY;
    },
    [containerRef]
  );

  if (!overflow) return null;

  return (
    <div
      className={styles.track}
      style={{ right: 'var(--scb-right, 0px)' }}
      onPointerDown={onTrackDown}
      onWheel={onWheel}
      role="presentation"
    >
      <div className={styles.line} aria-hidden />
      <div
        className={`${styles.thumb}${dragging ? ` ${styles.thumbActive}` : ''}`}
        style={{ top: TRACK_INSET + thumbY, height: thumbH }}
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
      />
    </div>
  );
}
