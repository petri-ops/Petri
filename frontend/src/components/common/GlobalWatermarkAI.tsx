// 国风背景水印 · AI 专业出图版（原封不动落地）。
// 图案来自 image_gen 钢笔白描；颜色由 watermark-ai.css 主题派生。
// 独立文件：原 GlobalWatermark.tsx 在本会话被并发进程反复覆盖，故不触碰。
import React from 'react';

export function GlobalWatermarkAI(): React.ReactElement {
  return <div className="petri-watermark-global" aria-hidden="true" />;
}
