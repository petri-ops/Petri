/**
 * ArtifactPinPane — BLOCK-140 P0 分屏骨架（成果面切片 C，plan §2/§5）。
 *
 * 钉住=视图级快照（plan D1）：宿主（ResultArtifactShell）在「钉住」时刻捕获当前
 * 产物的渲染载荷——renderPreview 同一渲染路径的现值（previewText/previewData/url），
 * 本组件只离线渲染这份快照：主区自由切换产物/版本不影响副栏，组件自身零取数
 * （不是第二数据通道）。副栏为 result 模式专属（plan §2 P0 ④）：mode≠'result'
 * 或未钉住时仅渲染主区投影（children），恢复单栏；快照状态归宿主持有，mode 门控
 * 非粘性（回到 result 且快照仍在 → 双栏恢复）。比例固定 60/40（plan D2，拖拽留后续）。
 *
 * 契约面与寻址面见同目录 ArtifactPinPane.test.tsx（HK-01 先红后绿）。
 */

import React from 'react';
import type { ResultSurfaceMode } from '@/components/result-studio/resultSurface';
import styles from './ArtifactPinPane.module.css';

/** 钉住时刻捕获的视图级快照：产物名 + renderPreview 渲染载荷（非取数句柄）。 */
export type ArtifactPinSnapshot = {
  jobId: string;
  artifactName: string;
  label?: string | null;
  viewerAdapter: 'report' | 'image' | 'table' | 'json' | 'text' | 'binary';
  previewText: string | null;
  previewData: string[][] | null;
  url: string;
};

export function ArtifactPinPane({
  mode,
  snapshot,
  onUnpin,
  children,
}: {
  mode: ResultSurfaceMode;
  /** 钉住时刻的视图级快照；null = 未钉住（单栏）。 */
  snapshot: ArtifactPinSnapshot | null;
  /** 「解除钉住」回调（置空由宿主裁决）。 */
  onUnpin?: () => void;
  /** 主区投影（全 mode 在场；副栏仅 result 模式在场）。 */
  children: React.ReactNode;
}): React.ReactElement {
  // 未钉住或非 result 模式：单栏——副栏（含其 DOM）彻底不在场，主区投影原样。
  if (!snapshot || mode !== 'result') {
    return <>{children}</>;
  }

  // 快照离线渲染：与 renderPreview 同一渲染原语（iframe/img/table/pre），
  // 只消费快照载荷，零 fetch。
  const renderSnapshotBody = (): React.ReactNode => {
    if (snapshot.viewerAdapter === 'report' && snapshot.url) {
      return (
        <iframe
          className={styles.artifactPinFrame}
          src={snapshot.url}
          title={snapshot.artifactName}
          sandbox="allow-same-origin"
        />
      );
    }
    if (snapshot.viewerAdapter === 'image' && snapshot.url) {
      return <img className={styles.artifactPinImage} src={snapshot.url} alt={snapshot.artifactName} />;
    }
    if (snapshot.viewerAdapter === 'table' && snapshot.previewData && snapshot.previewData.length > 0) {
      const [header, ...rows] = snapshot.previewData;
      return (
        <div className={styles.artifactPinTableScroll}>
          <table>
            <thead>
              <tr>
                {header.map((cell, idx) => (
                  <th key={`${cell || 'col'}-${idx}`} scope="col">{cell || `列 ${idx + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell || '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if ((snapshot.viewerAdapter === 'json' || snapshot.viewerAdapter === 'text') && snapshot.previewText) {
      return <pre className={styles.artifactPinText}>{snapshot.previewText}</pre>;
    }
    return <div className={styles.artifactPinPlaceholder}>钉住快照无内嵌预览载荷</div>;
  };

  return (
    <div className={styles.artifactPinSplit}>
      <div className={styles.artifactPinMain} data-testid="artifact-pin-main">
        {children}
      </div>
      <aside
        className={styles.artifactPinSide}
        data-testid="artifact-pin-pane"
        aria-label={`钉住的产物：${snapshot.artifactName}`}
        title={snapshot.jobId}
      >
        <div className={styles.artifactPinHeader}>
          {snapshot.label ? (
            <span className={styles.artifactPinLabel}>{snapshot.label}</span>
          ) : null}
          <span className={styles.artifactPinName}>{snapshot.artifactName}</span>
          <button
            type="button"
            className="gewu-btn gewu-btn--ghost gewu-btn--sm"
            onClick={() => onUnpin?.()}
          >
            解除钉住
          </button>
        </div>
        <div className={styles.artifactPinBody}>{renderSnapshotBody()}</div>
      </aside>
    </div>
  );
}
