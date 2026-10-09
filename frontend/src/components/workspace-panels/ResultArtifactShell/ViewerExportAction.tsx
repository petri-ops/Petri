/**
 * ViewerExportAction — BLOCK-151 B 轨（审视吸收二波·A4 面「viewer 能力声明一致性」）。
 *
 * viewerRegistry 能力声明接线：markdown/pdf 档案 canExport=true（BLOCK-142 定值
 * 「原文可导出」）此前零消费——Shell 挂载面（renderPreview 的 markdown/spreadsheet/pdf
 * 三分支）对这两类 adapter 不提供任何打开/导出出口（兜底分支的「打开或下载原文件」
 * 只服务落兜底的 adapter）。本组件消费 viewerProfileCanExport（取值唯一来源=
 * 注册表档案表，不复制布尔）：声明 true 才渲染「打开原文件」锚点，false 一律不
 * 渲染。零取数（纯出口链接，非第二数据通道）。
 */

import React from 'react';
import {
  viewerProfileCanExport,
  type ResultViewerAdapter,
} from '@/components/result-studio/viewerRegistry';
import styles from './ViewerExportAction.module.css';

export function ViewerExportAction({ adapter, url }: {
  adapter: ResultViewerAdapter;
  /** 产物原文件 URL；空串视为无出口可给。 */
  url: string;
}): React.ReactElement | null {
  if (!url || !viewerProfileCanExport(adapter)) return null;
  return (
    <div className={styles.actionsRow}>
      <a
        className="gewu-btn gewu-btn--ghost gewu-btn--sm"
        href={url}
        target="_blank"
        rel="noreferrer"
      >
        打开原文件
      </a>
    </div>
  );
}
