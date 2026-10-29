import React from 'react';
import { Model3DScene } from '@/components/work-surface/Model3DScene';
import { setSelectionBusArtifact, setSelectionBusSelection } from '@/lib/selectionBus';
import styles from './Model3DResultViewer.module.css';

function modelFormatFor(url: string): 'glb' | 'stl' | 'obj' {
  const lower = String(url || '').toLowerCase();
  if (lower.endsWith('.stl')) return 'stl';
  if (lower.endsWith('.obj')) return 'obj';
  return 'glb';
}

/**
 * RW-01 — Result Studio 内嵌 3D viewer。
 *
 * 薄壳复用 work-surface 的 Model3DScene（three.js 装配零复制）；artifact 级选择
 * 进选择总线（canSelect=true 档案消费面）：挂载即换上下文绑定，点击查看面写
 * artifact 级选择，Composer「继续分析」经既有总线消费面引用 3D 产物。
 * WebGL 不可用时如实降级（Model3DScene onError 路径），不假装渲染成功。
 */
export function Model3DResultViewer({
  url,
  name,
  artifactId,
  revisionId,
}: {
  url: string;
  name: string;
  artifactId: string;
  revisionId: string | null;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [readyInfo, setReadyInfo] = React.useState<{ objects: number; bounds: number[] } | null>(null);

  React.useEffect(() => {
    setError(null);
    setReadyInfo(null);
    setSelectionBusArtifact({ artifactId, revisionId });
  }, [artifactId, revisionId]);

  const handleSurfaceClick = React.useCallback(() => {
    setSelectionBusSelection({
      contractVersion: 1,
      artifactId,
      revisionId,
      entityType: 'model3d_artifact',
      origin: 'point_select',
      entityIds: [artifactId],
      entityIdCount: 1,
      entityIdsTruncated: false,
      entityIdsHash: null,
      filterHash: null,
      fields: [],
      filterExpression: null,
      sort: [],
      region: null,
      durable: false,
      createdAt: new Date().toISOString(),
    });
  }, [artifactId, revisionId]);

  return (
    <div className={styles.viewer}>
      <div
        className={styles.surface}
        data-testid="model3d-result-viewer-surface"
        onClick={handleSurfaceClick}
        role="button"
        tabIndex={0}
        aria-label={`选择 3D 模型 ${name}`}
      >
        <Model3DScene
          view={null}
          viewAngle="iso"
          modelUrl={url}
          modelFormat={modelFormatFor(url)}
          onReady={(info) => setReadyInfo(info)}
          onError={(message) => setError(message)}
        />
        {error && (
          <div className={styles.fallback}>
            <strong>3D 预览不可用</strong>
            <span>{error === 'webgl_unavailable' ? '当前环境无 WebGL 渲染能力。' : error}</span>
            <a href={url} target="_blank" rel="noreferrer">打开或下载原文件</a>
          </div>
        )}
      </div>
      <div className={styles.metaRow}>
        <span className={styles.name} title={name}>{name}</span>
        {readyInfo && (
          <span className={styles.stats}>对象 {readyInfo.objects} · bounds {readyInfo.bounds.map((n) => Math.round(n)).join('×')}</span>
        )}
        <span className={styles.hint}>点击模型面可将该产物加入上下文引用</span>
      </div>
    </div>
  );
}

export default Model3DResultViewer;
