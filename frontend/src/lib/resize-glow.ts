import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * UI-591（BLOCK-273 reopen 兑现）— 拖拽边界指针跟随渐晕。
 * 把手 onPointerMove 时刷新 `--petri-resize-glow-y`（光晕中心 = 指针在把手内的 Y），
 * CSS 侧 radial-gradient 以该变量定位；未跟踪时回落 50%（居中光晕）。
 * 各可调宽边界（resizeHandleV / workspaceFileTreeResize / FloatCardResizer）共用。
 */
export function trackResizeGlow(event: ReactPointerEvent<HTMLElement>): void {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty(
    '--petri-resize-glow-y',
    `${Math.round(event.clientY - rect.top)}px`
  );
}
