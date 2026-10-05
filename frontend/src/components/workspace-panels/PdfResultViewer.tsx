import React from 'react';
import { WorkspacePdfPreview } from '@/pages/project-workspace/WorkspacePdfPreview';

/**
 * BLOCK-142（成果面切片 E·renderer 补课）— PDF 产物 viewer。
 *
 * 契约（plan §1.3）：薄包装复用 pages/project-workspace/WorkspacePdfPreview
 * （pdfjs-dist 4.10.38 本地渲染；pdfjs 依赖只在该文件出现——移除/替换只动那里）。
 * 本组件**不复制实现**，只做 Shell 挂载面的 props 透传。
 */
export function PdfResultViewer({ url, name }: { url: string; name: string }): React.ReactElement {
  return <WorkspacePdfPreview url={url} name={name} />;
}
