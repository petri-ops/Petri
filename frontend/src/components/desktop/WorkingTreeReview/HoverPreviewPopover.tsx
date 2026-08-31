// ============================================================
// HoverPreviewPopover — UI-255 悬停浮动预览的定位容器（审阅 / 会话改动卡片共用）
//
// 自适应规则：
//   1. 宽度按触发行一侧的可用空间收缩（右侧放不下翻到左侧，两侧都窄则钳到最小 260px）；
//   2. 首帧隐藏，useLayoutEffect 实测渲染高度后钳制 top，保证浮窗完整落在应用窗口内；
//   3. fixed 定位不拦截宿主点击；hover 保持逻辑由调用方通过 onMouseEnter/Leave 控制。
// ============================================================

import { useLayoutEffect, useRef, useState } from 'react';

const MARGIN = 8;

export function HoverPreviewPopover({
  anchor,
  testid,
  className,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  anchor: DOMRect;
  testid: string;
  className: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  // 宽度只依赖 anchor 与窗口尺寸，可在首帧就定下来（内容按 maxWidth 自动收缩）
  const spaceRight = window.innerWidth - anchor.right - MARGIN - 10;
  const preferRight = spaceRight >= 300;
  const maxWidth = Math.min(
    420,
    Math.max(260, preferRight ? spaceRight : anchor.left - MARGIN - 10),
  );
  const left = preferRight
    ? anchor.right + 10
    : Math.max(MARGIN, anchor.left - maxWidth - 10);
  // 高度需渲染后实测：首帧隐藏，测出后钳制 top 使底边不越界
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    setTop(Math.max(MARGIN, Math.min(anchor.top - MARGIN, window.innerHeight - h - MARGIN)));
  }, [anchor]);

  return (
    <div
      ref={ref}
      className={className}
      data-testid={testid}
      style={{
        left,
        top: top ?? anchor.top - MARGIN,
        maxWidth,
        visibility: top === null ? 'hidden' : 'visible',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
}
