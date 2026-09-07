// ============================================================
// BinaryPreviewCard — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 2876-2918 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { fileExtension, isImageFile, isTextFile, isMarkdownFile, workspaceFileUrlFor, formatPreviewText } from '@/lib/previewFileUtils';
import {
  describeOfficeKind,
  loadOfficePreview,
  revokeOfficePreviewBlobs,
  suggestedOpener,
  type OfficePreviewAsset,
  type OfficePreviewKind,
  type OfficePreviewModel,
} from '@/lib/office-file-preview';
import styles from '../project-workspace.module.css';
import type { ActiveWorkspaceFile } from './types';
import { isCsvFile, isPdfFile, isHtmlFile, isJsonFile, withReportTheme, detectOfficeKind, fallbackKindForExtension, formatSize } from './helpers';

export function BinaryPreviewCard({
  file,
  opening,
  onOpen,
  onDownload,
  reason,
}: {
  file: ActiveWorkspaceFile;
  opening: boolean;
  onOpen: () => void;
  onDownload: () => void;
  reason?: string;
}): React.ReactElement {
  const ext = fileExtension(file.name);
  const kind = describeOfficeKind(detectOfficeKind(file.name) || fallbackKindForExtension(ext));
  const opener = suggestedOpener(detectOfficeKind(file.name) || fallbackKindForExtension(ext));
  return (
    <div className={styles.workspaceBinaryFallback}>
      <Icon name="file" size={20} />
      <p className={styles.workspaceBinaryTitle}>{kind}</p>
      {reason && <p className={styles.workspaceBinaryMeta}>{reason}</p>}
      <p className={styles.workspaceBinaryMeta}>
        推荐用 {opener} 打开 · 也可以下载副本用本地工具查看。
      </p>
      <div className={styles.workspacePreviewActions}>
        <button
          type="button"
          className={styles.workspacePreviewOpen}
          onClick={onOpen}
          disabled={opening}
        >
          <Icon name="file" size={13} />
          {opening ? '打开中' : '使用系统应用打开'}
        </button>
        <button type="button" className={styles.workspacePreviewOpen} onClick={onDownload}>
          <Icon name="download" size={13} />
          下载副本
        </button>
      </div>
    </div>
  );
}
