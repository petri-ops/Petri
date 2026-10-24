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

import React, { useCallback, useState } from 'react';
import type { ResultSurfaceMode, ResultViewerAdapter } from '@/components/result-studio/resultSurface';
import styles from './ArtifactPinPane.module.css';

/** 钉住时刻捕获的视图级快照：产物名 + renderPreview 渲染载荷（非取数句柄）。 */
export type ArtifactPinSnapshot = {
  jobId: string;
  artifactName: string;
  label?: string | null;
  /** BLOCK-142：跟随注册表 ResultViewerAdapter 联合（原手抄旧六成员，扩员即漂移）；新 adapter 钉住载荷未接线前落本组件占位分支。 */
  viewerAdapter: ResultViewerAdapter;
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
  // BLOCK-175 CP-15 — hooks 无条件调用（rules-of-hooks：必须在 early return 前）。
  const RATIO_KEY = 'petri.pinSplitRatio';
  const clampRatio = useCallback((raw: number): number => Math.max(20, Math.min(80, Math.round(raw))), []);
  const [mainRatio, setMainRatio] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(RATIO_KEY));
      if (Number.isFinite(saved) && saved >= 20 && saved <= 80) return Math.round(saved);
    } catch { /* storage unavailable */ }
    return 60;
  });
  const splitRef = React.useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  // BLOCK-253 F7 — 窗格最大化/恢复；比例槽不动，恢复后回到用户上次拖拽值。
  const [expanded, setExpanded] = useState<'main' | 'pin' | null>(null);

  const applyRatio = useCallback((next: number) => {
    const clamped = clampRatio(next);
    setMainRatio(clamped);
    try { localStorage.setItem(RATIO_KEY, String(clamped)); } catch { /* storage unavailable */ }
  }, []);

  const onDividerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const splitEl = splitRef.current;
    if (!splitEl) return;
    setDragging(true);
    const rect = splitEl.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const ratio = ((e.clientX - rect.left) / rect.width) * 100;
      applyRatio(clampRatio(ratio));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [applyRatio]);

  const onDividerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      applyRatio(mainRatio - 5);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      applyRatio(mainRatio + 5);
    }
  }, [applyRatio, mainRatio]);

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
    // BLOCK-151 B 轨：BLOCK-142 三新 adapter（markdown/spreadsheet/pdf）快照载荷
    // 未接线——占位态不留死面，url 在场时给「打开原文件」出口（与主区兜底分支
    // 同款纯链接，零取数，D1 不破）。
    return (
      <div className={styles.artifactPinPlaceholder}>
        <span>钉住快照无内嵌预览载荷</span>
        {snapshot.url && (
          <a href={snapshot.url} target="_blank" rel="noreferrer">打开原文件</a>
        )}
      </div>
    );
  };

  const columns = expanded === 'main'
    ? 'minmax(0, 1fr) minmax(0, 0fr)'
    : expanded === 'pin'
      ? 'minmax(0, 0fr) minmax(0, 1fr)'
      : `minmax(0, ${mainRatio}fr) minmax(0, ${100 - mainRatio}fr)`;
  const restoreButton = (
    <button
      type="button"
      className="petri-btn petri-btn--ghost petri-btn--sm"
      data-testid="artifact-pin-restore"
      onClick={() => setExpanded(null)}
    >
      恢复分屏
    </button>
  );

  return (
    <div
      className={styles.artifactPinSplit}
      ref={splitRef}
      data-expanded={expanded || undefined}
      style={{ gridTemplateColumns: columns }}
    >
      {expanded !== 'pin' && (
        <div className={styles.artifactPinMain} data-testid="artifact-pin-main">
          {expanded === 'main' && (
            <div className={styles.artifactPinControls} data-testid="artifact-pin-main-controls">
              {restoreButton}
            </div>
          )}
          {children}
        </div>
      )}
      {!expanded && (
        <div
          className={styles.artifactPinDivider}
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整分屏比例"
          aria-valuenow={mainRatio}
          aria-valuemin={20}
          aria-valuemax={80}
          tabIndex={0}
          data-dragging={dragging || undefined}
          onPointerDown={onDividerPointerDown}
          onKeyDown={onDividerKeyDown}
          data-testid="artifact-pin-divider"
        />
      )}
      {expanded !== 'main' && (
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
              className="petri-btn petri-btn--ghost petri-btn--sm"
              data-testid="artifact-pin-maximize-main"
              aria-pressed={false}
              onClick={() => setExpanded('main')}
            >
              主区最大化
            </button>
            {expanded === 'pin' ? restoreButton : (
              <button
                type="button"
                className="petri-btn petri-btn--ghost petri-btn--sm"
                data-testid="artifact-pin-maximize-pin"
                aria-pressed={false}
                onClick={() => setExpanded('pin')}
              >
                副栏最大化
              </button>
            )}
            <button
              type="button"
              className="petri-btn petri-btn--ghost petri-btn--sm"
              onClick={() => onUnpin?.()}
            >
              解除钉住
            </button>
          </div>
          <div className={styles.artifactPinBody}>{renderSnapshotBody()}</div>
        </aside>
      )}
    </div>
  );
}
