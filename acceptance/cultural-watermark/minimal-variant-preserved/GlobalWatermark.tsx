// 国风背景水印 · 全局单源（计白当黑）。
// 四原型（月洞门弧 / 卵石 / 空心方印 / 开环）以纯几何 stroke 单线绘制，
// 固定视口四角，一处挂载覆盖所有路由；极淡、pointer-events:none、aria-hidden。
// 颜色由 watermark.css 的 color-mix(--petri-ink-base, --petri-bg-canvas) 主题自适应。
import React from 'react';

export function GlobalWatermark(): React.ReactElement {
  return (
    <div className="petri-watermark-global" aria-hidden="true">
      <div className="petri-watermark petri-watermark--moon-gate" />
      <div className="petri-watermark petri-watermark--seal" />
      <div className="petri-watermark petri-watermark--pebble" />
      <div className="petri-watermark petri-watermark--open-ring" />
    </div>
  );
}
