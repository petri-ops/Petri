import React from 'react';
import { Model3DScene } from '@/components/work-surface/Model3DScene';
import { meshFormatForPath } from '@/lib/meshAssets';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
import { setSelectionBusArtifact, setSelectionBusSelection } from '@/lib/selectionBus';
import styles from './Model3DResultViewer.module.css';

// 格式判定走 meshAssets 单源；无法识别时保持既有兜底语义（按 glb 交给 GLTFLoader）。
function modelFormatFor(url: string) {
  return meshFormatForPath(url) ?? 'glb';
}

/**
 * RW-01 — Result Studio 内嵌 3D viewer。
 *
 * 薄壳复用 work-surface 的 Model3DScene（three.js 装配零复制）；artifact 级选择
 * 进选择总线（canSelect=true 档案消费面）：挂载即换上下文绑定，点击查看面写
 * artifact 级选择，Composer「继续分析」经既有总线消费面引用 3D 产物。
 * WebGL 不可用时如实降级（Model3DScene onError 路径），不假装渲染成功。
 */
/** UI-654 — 从导出产物 URL 反推同一 run 的场景快照（只认 model3d/runs/<run>/）。 */
function sceneSnapshotFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const artifactPath = parsed.searchParams.get('path') || '';
    const match = /^model3d\/runs\/[^/]+\//.exec(artifactPath);
    return match ? `${match[0]}scene.json` : null;
  } catch {
    return null;
  }
}

/** BLOCK-463 — scene.json 的取数 URL：与产物 URL 同源同路径，仅换 path 参数。 */
function sceneSnapshotFetchUrl(url: string, scenePath: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set('path', scenePath);
    return parsed.toString();
  } catch {
    return null;
  }
}

interface SceneSpecPanelData {
  joints?: Array<{ id: string; kind?: string }>;
  metadata?: {
    provenance?: {
      producer?: string;
      programDigest?: string;
      glbSha256?: string;
      verifierResults?: Array<{ tool?: string; verdict?: string; digest?: string }>;
    };
  };
}

export function Model3DResultViewer({
  url,
  name,
  artifactId,
  revisionId,
  projectId = null,
  jobId = null,
  active = true,
}: {
  url: string;
  name: string;
  artifactId: string;
  revisionId: string | null;
  projectId?: string | null;
  jobId?: string | null;
  /** BLOCK-334 — 宿主 tab 非激活时不持有 WebGL 上下文（透传 Model3DScene 的 block-322 P3 门控）。 */
  active?: boolean;
}) {
  // BLOCK-250 同类纪律：artifact 换上下文的重置在 render 期派生（不在 effect 里同步 setState）。
  const [viewState, setViewState] = React.useState<{
    artifactId: string;
    error: string | null;
    ready: { objects: number; bounds: number[] } | null;
  }>({ artifactId, error: null, ready: null });
  if (viewState.artifactId !== artifactId) {
    setViewState({ artifactId, error: null, ready: null });
  }
  const error = viewState.artifactId === artifactId ? viewState.error : null;
  const readyInfo = viewState.artifactId === artifactId ? viewState.ready : null;

  React.useEffect(() => {
    setSelectionBusArtifact({ artifactId, revisionId });
  }, [artifactId, revisionId]);

  // BLOCK-463 — SceneSpec 证据面板取数（仅 runs 配对产物；异步 effect 无同步 setState；
  // 失败诚实降级为无面板，不炸穿 viewer）。
  const scenePath = sceneSnapshotFromUrl(url);
  const sceneFetchUrl = scenePath ? sceneSnapshotFetchUrl(url, scenePath) : null;
  const [sceneSpec, setSceneSpec] = React.useState<{ artifactId: string; data: SceneSpecPanelData | null }>({ artifactId, data: null });
  React.useEffect(() => {
    if (!sceneFetchUrl) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(sceneFetchUrl);
        if (!response.ok) return;
        const body = (await response.json()) as SceneSpecPanelData;
        if (!cancelled && body && typeof body === 'object') {
          setSceneSpec({ artifactId, data: body });
        }
      } catch {
        /* 取数失败 = 无面板（诚实降级），不冒充 */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sceneFetchUrl, artifactId]);
  const panelData = viewState.artifactId === artifactId && sceneSpec.artifactId === artifactId ? sceneSpec.data : null;

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
          active={active}
          onReady={(info) => setViewState((prev) => ({ ...prev, ready: info }))}
          onError={(message) => setViewState((prev) => ({ ...prev, error: message }))}
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
        {/* UI-654 — 预览里直接转 3D 工作面（载入同一 run 的场景快照），省去手动导入 */}
        {projectId && sceneSnapshotFromUrl(url) ? (
          <button
            type="button"
            className={styles.openWorkbench}
            data-testid="model3d-result-open-workbench"
            onClick={() => {
              const scenePath = sceneSnapshotFromUrl(url);
              if (!scenePath) return;
              dispatchPetriEvent(petriEvents.model3dOpen, {
                projectId,
                scenePath,
                jobId: jobId || undefined,
                label: name,
              });
            }}
          >
            在 3D 工作台打开
          </button>
        ) : null}
        {panelData && (panelData.joints?.length || panelData.metadata?.provenance) ? (
          <details className={styles.sceneSpecPanel} data-testid="scenespec-panel">
            <summary>
              SceneSpec 证据{panelData.joints?.length ? ` · ${panelData.joints.length} 个关节` : ''}
              {panelData.metadata?.provenance?.verifierResults?.length ? ` · ${panelData.metadata.provenance.verifierResults.length} 条验证` : ''}
            </summary>
            <div className={styles.sceneSpecBody}>
              {panelData.joints?.map((joint) => (
                <div key={joint.id} className={styles.sceneSpecRow}>
                  <span className={styles.sceneSpecJoint}>{joint.id}</span>
                  <span className={styles.sceneSpecKind}>{joint.kind ?? '?'}</span>
                </div>
              ))}
              {panelData.metadata?.provenance ? (
                <div className={styles.sceneSpecRow}>
                  <span className={styles.sceneSpecJoint}>{panelData.metadata.provenance.producer ?? 'unknown'}</span>
                  <span className={styles.sceneSpecKind}>{panelData.metadata.provenance.programDigest ?? ''}</span>
                </div>
              ) : null}
              {panelData.metadata?.provenance?.verifierResults?.map((row: { tool?: string; verdict?: string; digest?: string }, index: number) => (
                <div key={`v-${index}`} className={styles.sceneSpecRow}>
                  <span className={styles.sceneSpecJoint}>{row.tool}</span>
                  <span className={styles.sceneSpecKind}>{row.verdict}</span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
        <span className={styles.hint}>点击模型面可将该产物加入上下文引用</span>
      </div>
    </div>
  );
}

export default Model3DResultViewer;
