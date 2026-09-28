/**
 * FloatCardResizer — UI-448 加映 v25 — 右锚定浮卡的左缘拖宽把手。
 *
 * 会话浮面与摘要浮卡共用：把手贴卡片左缘（cursor: col-resize），向左拖 = 变宽，
 * 宽度实时回调 + 抬手持久化（localStorage 全局偏好，跨会话记忆）。
 * 宽度钳制 [240, 720] 且不越过视口右缘；主会话/钉住列渲染零改动。
 */
import React, { useCallback, useEffect, useRef } from 'react';
import styles from './FloatCardResizer.module.css';

// UI-448 清偿（AUDIT-LOG 🔴 销号）：仅模块内使用，按 knip 棘轮去导出（行为不变）
const FLOAT_CARD_MIN_WIDTH = 240;
const FLOAT_CARD_MAX_WIDTH = 720;

/** 钳制：[240, 720] 且不超过视口宽（浮卡右锚定，左边必须留出可视区）。 */
function clampFloatCardWidth(w: number): number {
  const viewport = typeof window !== 'undefined' ? window.innerWidth : FLOAT_CARD_MAX_WIDTH;
  const max = Math.min(FLOAT_CARD_MAX_WIDTH, Math.max(FLOAT_CARD_MIN_WIDTH, viewport - 48));
  return Math.round(Math.min(max, Math.max(FLOAT_CARD_MIN_WIDTH, w)));
}

/** 读取持久化宽度；无记录/损坏值返回 null（回落默认宽度）。 */
export function readPersistedFloatWidth(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= FLOAT_CARD_MIN_WIDTH ? n : null;
  } catch {
    return null;
  }
}

export function persistFloatWidth(key: string, w: number): void {
  try {
    window.localStorage.setItem(key, String(Math.round(w)));
  } catch {
    // localStorage 不可用：退化为会话内记忆，仅不跨重启
  }
}

/**
 * 拖宽把手：绝对定位贴卡片左缘的竖条。向左拖（clientX 减小）= 变宽。
 * 事件挂在 window 上——指针移出把手仍持续跟踪，无需依赖 pointer capture
 * （happy-dom 无 capture 实现，测试同款路径）。
 */
export function FloatCardResizeHandle({
  width,
  onWidthChange,
  onCommit,
}: {
  width: number;
  onWidthChange: (w: number) => void;
  onCommit: (w: number) => void;
}): React.ReactElement {
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  // 同步走 effect（渲染期写 ref 违反 react-hooks/refs；pointerdown 等用户事件在 commit 后触发，值恒新）
  const currentRef = useRef(width);
  useEffect(() => {
    currentRef.current = width;
  });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { x: e.clientX, w: currentRef.current };
      const move = (ev: Event) => {
        const start = dragRef.current;
        if (!start) return;
        const dx = start.x - (ev as PointerEvent).clientX;
        onWidthChange(clampFloatCardWidth(start.w + dx));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        dragRef.current = null;
        onCommit(clampFloatCardWidth(currentRef.current));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [onWidthChange, onCommit]
  );

  return (
    <div
      className={styles.handle}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整卡片宽度"
      data-testid="float-card-resize-handle"
    />
  );
}
