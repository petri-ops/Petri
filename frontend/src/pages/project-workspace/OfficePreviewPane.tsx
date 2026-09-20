// ============================================================
// OfficePreviewPane — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 2920-2973 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React from 'react';
import { type OfficePreviewModel } from '@/lib/office-file-preview';
import styles from '../project-workspace.module.css';
import { PreviewAssets } from './PreviewAssets';
import { TextBlock } from './TextBlock';

export function OfficePreviewPane({
  preview,
  onAssetOpen,
}: {
  preview: OfficePreviewModel;
  onAssetOpen: (url: string) => void;
}): React.ReactElement {
  if (preview.sheet) {
    return (
      <div className={styles.workspaceOfficeSheet}>
        <div className={styles.workspaceOfficeHeader}>{preview.sheet.name}</div>
        <table>
          <tbody>
            {preview.sheet.rows.length === 0 && (
              <tr><td>未读取到任何行内容，建议在外部表格工具打开</td></tr>
            )}
            {preview.sheet.rows.map((row, idx) => (
              <tr key={idx}>
                {row.cells.map((cell, cellIdx) => (
                  <td key={cellIdx}>{cell || '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {preview.sheet.rows.length >= 80 && (
          <p className={styles.workspaceOfficeHint}>仅展示前 80 行，完整内容请在外部工具打开。</p>
        )}
        <PreviewAssets assets={preview.assets} onAssetOpen={onAssetOpen} />
        <TextBlock text={preview.text} />
      </div>
    );
  }
  if (preview.contents && preview.contents.length > 0) {
    return (
      <div className={styles.workspaceOfficeListing}>
        <p className={styles.workspaceOfficeHint}>
          Apple iWork 容器列出了 {preview.contents.length} 个内嵌资源；如需完整版式，请在系统应用（Pages / Numbers / Keynote）中打开。
        </p>
        <ul>
          {preview.contents.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className={styles.workspaceOfficeDoc}>
      <TextBlock text={preview.text} />
      <PreviewAssets assets={preview.assets} onAssetOpen={onAssetOpen} />
    </div>
  );
}
