// 国风简约背景水印 · 全局单源（计白当黑）。
// 四原型固定视口四角，一处挂载覆盖所有路由；极淡(3%墨)、pointer-events:none、aria-hidden，
// 盖在页面上但不挡交互/不进无障碍树；主题自适应由 watermark.css 的 color-mix 派生。
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
