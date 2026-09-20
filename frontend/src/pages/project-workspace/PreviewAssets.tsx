// ============================================================
// PreviewAssets — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 2975-2999 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React from 'react';
import { type OfficePreviewAsset } from '@/lib/office-file-preview';
import styles from '../project-workspace.module.css';

export function PreviewAssets({
  assets,
  onAssetOpen,
}: {
  assets?: OfficePreviewAsset[];
  onAssetOpen: (url: string) => void;
}): React.ReactElement | null {
  if (!assets || assets.length === 0) return null;
  return (
    <div className={styles.workspaceOfficeAssets}>
      {assets.map((asset) => (
        <button
          key={asset.name}
          type="button"
          className={styles.workspaceOfficeAsset}
          onClick={() => onAssetOpen(asset.url)}
          title={asset.name}
        >
          <img src={asset.url} alt={asset.name} />
          <span>{asset.name}</span>
        </button>
      ))}
    </div>
  );
}
