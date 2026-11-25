import React from 'react';

// BLOCK-334 P2 Slice A — HTML 唯一 viewer：合并 ResultArtifactShell 的 report iframe
// （sandbox=allow-same-origin、不带主题参数）与 WorkspaceFilePreview 的 html iframe
// （sandbox=allow-scripts、withReportTheme 主题参数）。主题参数由宿主算好传 src，viewer 不感知主题。
// 工作区侧静态 html 与交互式 html（3D/WebGL）共用：需脚本权限渲染，但保持 opaque origin
// ——只放行 allow-scripts，不给 allow-same-origin，隔离主应用 DOM/凭据。

export function HtmlViewer({
  src,
  title,
  sandbox,
  className,
  testId,
}: {
  src: string;
  title: string;
  /** iframe sandbox 值由宿主声明（报告同源放行 / 工作区文件仅放行脚本且保持 opaque origin）。 */
  sandbox?: string;
  className?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <iframe
      className={className}
      src={src}
      title={title}
      sandbox={sandbox}
      data-testid={testId}
    />
  );
}
