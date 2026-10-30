import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { StatusBadge } from '@/components/ui/controls/Status';
import { projectCapabilityAxis } from '@/lib/statusProjection';
import { fetchModel3DCapability, resolveModel3DScene } from '@/lib/model3dClient';
import {
  normalizeScene3DForView,
  sampleScene3D,
  SCENE3D_CONSTRAINT_NOTE_PREFIX,
  type Scene3DConstraintKind,
  type Scene3DView,
} from '@/lib/scene3d';
import {
  MESH_INPUT_ACCEPT_ATTR,
  MAX_MESH_BYTES,
  meshFormatForPath,
  meshTooLargeMessage,
  type MeshInputFormat,
} from '@/lib/meshAssets';
import { importMeshAssetAsNode } from '@/lib/model3dAssetImport';
import type { Model3DCameraApi, Model3DPoint } from './Model3DScene';
import { Model3DReviewPanel } from './Model3DReviewPanel';
import { SketchSpecDialog } from './SketchSpecDialog';
import { Model3DEditPanel } from './Model3DEditPanel';
import { diffSceneSpecs, type SceneDiff } from '@/lib/sceneEditClient';
import button from '@/components/ui/controls/button.module.css';
import styles from './Model3DSurface.module.css';

const Model3DScene = React.lazy(() =>
  import('./Model3DScene').then((module) => ({ default: module.Model3DScene }))
);

type ViewAngle = 'iso' | 'front' | 'top' | 'side' | 'camera';
const VIEWS: Array<{ id: ViewAngle; label: string }> = [
  { id: 'iso', label: '等轴' },
  { id: 'front', label: '前' },
  { id: 'top', label: '顶' },
  { id: 'side', label: '侧' },
];
// 仅当场景声明了 camera 才出现「机位」按钮（未声明时不提供假机位选项）。
const DECLARED_CAMERA_VIEW = { id: 'camera' as const, label: '机位' };
const CONSTRAINT_KIND_LABEL: Record<Scene3DConstraintKind, string> = { align: '对齐', distance: '间距', angle: '转角' };

export function Model3DSurface({ projectId = null }: { projectId?: string | null }): React.ReactElement {
  const [view, setView] = React.useState<Scene3DView | null>(null);
  const [viewAngle, setViewAngle] = React.useState<ViewAngle>('iso');
  const [error, setError] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [capability, setCapability] = React.useState<Awaited<ReturnType<typeof fetchModel3DCapability>> | null>(null);
  const [canvasInfo, setCanvasInfo] = React.useState<{ objects: number; bounds: number[] } | null>(null);
  const [modelUrl, setModelUrl] = React.useState<string | null>(null);
  const [modelFormat, setModelFormat] = React.useState<MeshInputFormat>('glb');
  const [importing, setImporting] = React.useState(false);
  const [assetNotice, setAssetNotice] = React.useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [sketchOpen, setSketchOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [measureMode, setMeasureMode] = React.useState(false);
  const [measurePoints, setMeasurePoints] = React.useState<Model3DPoint[]>([]);
  const bookmarkKey = `petri.model3d.bookmarks.${projectId || 'no-project'}`;
  const [bookmarks, setBookmarks] = React.useState<Array<{ id: string; position: number[]; target: number[] }>>(() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(bookmarkKey) || '[]');
      if (!Array.isArray(stored)) return [];
      return stored.filter((entry): entry is { id: string; position: number[]; target: number[] } => Boolean(
        entry && typeof entry === 'object'
        && typeof (entry as { id?: unknown }).id === 'string'
        && Array.isArray((entry as { position?: unknown }).position)
        && Array.isArray((entry as { target?: unknown }).target),
      )).slice(0, 6);
    } catch {
      return [];
    }
  });
  const [compareScene, setCompareScene] = React.useState<Scene3DView['scene'] | null>(null);
  const [compareDiff, setCompareDiff] = React.useState<SceneDiff | null>(null);
  const [compareError, setCompareError] = React.useState<string | null>(null);
  const cameraApiRef = React.useRef<Model3DCameraApi | null>(null);
  const compareFileRef = React.useRef<HTMLInputElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const assetFileRef = React.useRef<HTMLInputElement | null>(null);

  const persistBookmarks = (next: Array<{ id: string; position: number[]; target: number[] }>) => {
    setBookmarks(next);
    try { window.localStorage.setItem(bookmarkKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  const onCameraApi = React.useCallback((api: Model3DCameraApi | null) => {
    cameraApiRef.current = api;
  }, []);

  const onMeasurePoint = React.useCallback((point: Model3DPoint) => {
    setMeasurePoints((previous) => (previous.length >= 2 ? [point] : [...previous, point]));
  }, []);

  React.useEffect(() => {
    fetchModel3DCapability()
      .then(setCapability)
      .catch(() => setCapability({ status: 'unavailable', reason: 'probe_failed', version: null }));
  }, []);

  React.useEffect(() => () => {
    if (modelUrl) URL.revokeObjectURL(modelUrl);
  }, [modelUrl]);

  const evalSeqRef = React.useRef(0);

  /**
   * BLOCK-322 P3-02b — 有约束就向本地后端要一次求值结果（纯函数端点，不写盘、不改场景文件）。
   * 求值只在服务端发生；失败或后端缺席时保持声明位置并把原因如实显示，绝不在前端重解一遍
   * （第二套求解器=plan §4 红线 2）。序号守卫防止用户换场景后旧响应覆盖新画面。
   */
  const evaluateConstraintsForPreview = async (loaded: Scene3DView) => {
    const sequence = evalSeqRef.current + 1;
    evalSeqRef.current = sequence;
    if ((loaded.scene.constraints?.length || 0) === 0) return;
    try {
      const resolved = await resolveModel3DScene(loaded.scene);
      if (evalSeqRef.current !== sequence) return;
      const evaluated = normalizeScene3DForView(resolved.scene, { constraintsEvaluated: true });
      // 求值后仍不合前端契约=两侧判据漂移：保守地保留声明位置与通用告警，不改画面。
      if (!evaluated.ok) return;
      setView(evaluated.view);
      setWarnings(evaluated.view.warnings);
    } catch (failure) {
      if (evalSeqRef.current !== sequence) return;
      const reason = failure instanceof Error ? failure.message : '未知原因';
      setWarnings([
        ...loaded.warnings.filter((item) => !item.startsWith(SCENE3D_CONSTRAINT_NOTE_PREFIX)),
        `${SCENE3D_CONSTRAINT_NOTE_PREFIX}：未能向本地后端取回求值结果，预览按声明位置显示（${reason}）。`,
      ]);
    }
  };

  const loadStructured = (raw: unknown) => {
    const normalized = normalizeScene3DForView(raw);
    if (!normalized.ok) {
      setError(normalized.errors.join('；'));
      setView(null);
      return;
    }
    setView(normalized.view);
    setWarnings(normalized.view.warnings);
    setError(null);
    setModelUrl(null);
    setReviewOpen(false);
    setSelectedNodeId(null);
    setMeasurePoints([]);
    setMeasureMode(false);
    void evaluateConstraintsForPreview(normalized.view);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setWarnings([]);
    setAssetNotice(null);
    if (file.size > MAX_MESH_BYTES) {
      setError(meshTooLargeMessage());
      return;
    }
    const format = meshFormatForPath(file.name);
    if (format) {
      if (modelUrl) URL.revokeObjectURL(modelUrl);
      setModelUrl(URL.createObjectURL(file));
      setModelFormat(format);
      setWarnings(format === 'stl' || format === 'obj'
        ? ['外部 STL/OBJ 仅几何预览，单位按文件原值；参数与约束请使用 SceneSpec。']
        : []);
      setView(null);
      setReviewOpen(false);
      setSelectedNodeId(null);
      setMeasurePoints([]);
      setMeasureMode(false);
      return;
    }
    try {
      const text = await file.text();
      loadStructured(JSON.parse(text));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'scene_file_invalid');
    }
  };

  const onAssetFile = async (file: File | undefined) => {
    if (!file) return;
    if (!projectId || !view) {
      setError('导入为场景节点需要已加载的 SceneSpec 与已打开的项目工作区。');
      return;
    }
    setImporting(true);
    setError(null);
    setAssetNotice(null);
    try {
      const imported = await importMeshAssetAsNode({ projectId, file, scene: view.scene });
      loadStructured(imported.scene);
      setWarnings((previous) => [...previous,
        `已导入 ${imported.path}（${imported.bytes} 字节 · sha256 ${imported.sourceSha256.slice(0, 12)}…）`]);
      setAssetNotice(`已作为节点 ${imported.node.id} 写入 ${imported.scenePath}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'asset_import_failed');
    } finally {
      setImporting(false);
    }
  };

  const onReady = React.useCallback((info: { objects: number; bounds: number[] }) => {
    setCanvasInfo(info);
  }, []);
  const onSceneError = React.useCallback((message: string) => {
    // 外部 mesh 是逐节点观察，可能同时多条：累积进告警区，不互相覆盖（红线4 既不伪造也不吞掉）；
    // 其余（WebGL 初始化/上下文丢失）仍是阻断性错误，走错误条。
    if (message.startsWith('mesh_reference_')) {
      setWarnings((previous) => (previous.includes(message) ? previous : [...previous, message]));
      return;
    }
    setError(message);
  }, []);
  const onSelectNode = React.useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);
  const measurement = measurePoints.length === 2 ? { a: measurePoints[0], b: measurePoints[1] } : null;
  const distance = measurement
    ? Math.hypot(
      measurement.b[0] - measurement.a[0],
      measurement.b[1] - measurement.a[1],
      measurement.b[2] - measurement.a[2],
    )
    : null;

  const saveBookmark = () => {
    const api = cameraApiRef.current;
    if (!api) return;
    const viewState = api.getView();
    const next = [
      ...bookmarks,
      { id: `bm-${Date.now()}`, position: viewState.position, target: viewState.target },
    ].slice(-6);
    persistBookmarks(next);
  };

  const captureScreenshot = () => {
    const canvas = document.querySelector('[data-testid="model3d-surface"] canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return;
    try {
      const anchor = document.createElement('a');
      anchor.href = canvas.toDataURL('image/png');
      anchor.download = `model3d-${Date.now()}.png`;
      anchor.click();
    } catch {
      setError('截图失败：当前画布不可导出。');
    }
  };

  const onCompareFile = async (file: File | undefined) => {
    if (!file) return;
    setCompareError(null);
    if (!view) {
      setCompareError('请先加载一个基准 SceneSpec，再选择对比模型。');
      return;
    }
    try {
      const normalized = normalizeScene3DForView(JSON.parse(await file.text()));
      if (!normalized.ok) {
        setCompareError(normalized.errors.join('；'));
        return;
      }
      setCompareScene(normalized.view.scene);
      setCompareDiff(await diffSceneSpecs(view.scene, normalized.view.scene));
    } catch (caught) {
      setCompareError(caught instanceof Error ? caught.message : 'compare_failed');
    }
  };

  return (
    <div className={styles.root} data-testid="model3d-surface">
      <header className={styles.header}>
        <span className={styles.title}>
          <Icon name="layers" size={15} />
          <strong>3D 模型</strong>
        </span>
        {capability ? (
          <span className={styles.capability}>
            Blender <StatusBadge projection={projectCapabilityAxis(capability.status)} />
            {capability.version ? <span className={styles.meta}>{capability.version}</span> : null}
          </span>
        ) : null}
        <button type="button" className={button.ghost} onClick={() => { loadStructured(sampleScene3D()); setViewAngle('iso'); }}>
          加载示例
        </button>
        <button type="button" className={button.ghost} onClick={() => fileRef.current?.click()}>
          导入模型
        </button>
        <button
          type="button"
          className={button.ghost}
          disabled={!view || !projectId || importing}
          title={!view || !projectId
            ? '需要先加载 SceneSpec 并打开项目工作区'
            : '上传到工作区 model3d/assets/，并作为 mesh-reference 节点写入 SceneSpec'}
          onClick={() => assetFileRef.current?.click()}
        >
          {importing ? '导入中…' : '导入为场景节点'}
        </button>
        <button
          type="button"
          className={button.ghost}
          disabled={!view || !projectId || capability?.status !== 'ready'}
          title={!projectId ? '视觉 QA 需要已打开的项目工作区' : '多视角渲染 + 视觉辅助检查'}
          aria-pressed={reviewOpen}
          onClick={() => setReviewOpen((open) => !open)}
        >
          视觉 QA
        </button>
        <button
          type="button"
          className={button.ghost}
          disabled={!view}
          aria-pressed={editOpen}
          onClick={() => setEditOpen((open) => !open)}
        >
          参数编辑
        </button>
        <button type="button" className={button.ghost} onClick={() => setSketchOpen(true)}>
          草图转需求
        </button>
        <button type="button" className={button.ghost} disabled={!view} onClick={() => compareFileRef.current?.click()}>
          对比 SceneSpec
        </button>
        <input
          ref={compareFileRef}
          type="file"
          accept=".json,.scene3d.json"
          hidden
          onChange={(event) => { void onCompareFile(event.target.files?.[0]); event.target.value = ''; }}
        />
        <input
          ref={fileRef}
          type="file"
          data-testid="model3d-file-input"
          accept={`.json,.scene3d.json,${MESH_INPUT_ACCEPT_ATTR}`}
          hidden
          onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ''; }}
        />
        <input
          ref={assetFileRef}
          type="file"
          data-testid="model3d-asset-input"
          accept={MESH_INPUT_ACCEPT_ATTR}
          hidden
          onChange={(event) => { void onAssetFile(event.target.files?.[0]); event.target.value = ''; }}
        />
      </header>

      <div className={styles.body}>
        <div className={styles.viewport} data-state={view || modelUrl ? 'ready' : 'empty'}>
          {!view && !modelUrl ? (
            <div className={styles.empty}>
              <Icon name="layers" size={30} />
              <p>打开一个 SceneSpec，或导入 GLB/GLTF/STL/OBJ 预览。</p>
              <span>SceneSpec 是参数化源真相；GLB/STL/OBJ 是导出物。</span>
              <button type="button" className={button.primary} onClick={() => loadStructured(sampleScene3D())}>
                加载示例 SceneSpec
              </button>
            </div>
          ) : (
            <React.Suspense fallback={<div className={styles.empty}>正在加载 3D 渲染器…</div>}>
              <Model3DScene
                view={view}
                viewAngle={viewAngle}
                modelUrl={modelUrl}
                modelFormat={modelFormat}
                projectId={projectId}
                onReady={onReady}
                onError={onSceneError}
                onSelectNode={onSelectNode}
                measureMode={measureMode}
                measurement={measurement}
                onMeasurePoint={onMeasurePoint}
                onCameraApi={onCameraApi}
              />
            </React.Suspense>
          )}
          <div className={styles.tools} role="group" aria-label="3D 测量与视角">
            <button
              type="button"
              className={`${button.ghost}${measureMode ? ` ${styles.viewActive}` : ''}`}
              aria-pressed={measureMode}
              disabled={!view && !modelUrl}
              onClick={() => { setMeasureMode((active) => !active); setMeasurePoints([]); }}
            >
              测量
            </button>
            {measurePoints.length > 0 ? (
              <button type="button" className={button.ghost} onClick={() => setMeasurePoints([])}>清除测量</button>
            ) : null}
            <button type="button" className={button.ghost} disabled={!view && !modelUrl} onClick={saveBookmark}>保存视角</button>
            <button type="button" className={button.ghost} disabled={!view && !modelUrl} onClick={captureScreenshot}>截图</button>
          </div>
          <div className={styles.viewSwitch} role="group" aria-label="3D 视角">
            {(view?.scene.camera ? [...VIEWS, DECLARED_CAMERA_VIEW] : VIEWS).map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`${button.ghost}${viewAngle === entry.id ? ` ${styles.viewActive}` : ''}`}
                aria-pressed={viewAngle === entry.id}
                disabled={!view && !modelUrl}
                onClick={() => setViewAngle(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <span className={styles.unit}>
            单位 mm · Z-up
            {measureMode ? ' · 依次点选两个表面点' : ''}
            {distance !== null ? ` · 测量 ${distance.toFixed(2)} mm` : ''}
            {selectedNodeId ? ` · 已选 ${selectedNodeId}` : ' · 点选模型选择节点'}
          </span>
        </div>

        <aside className={styles.info}>
          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          {warnings.map((warning) => <div key={warning} className={styles.warning}>{warning}</div>)}
          {assetNotice ? <div className={styles.notice}>{assetNotice}</div> : null}
          {view ? (
            <>
              <section>
                <h4>场景</h4>
                <dl className={styles.fields}>
                  <dt>节点</dt><dd>{view.stats.nodes}</dd>
                  <dt>参数</dt><dd>{view.stats.parameters}</dd>
                  <dt>约束</dt><dd>{view.stats.constraints}</dd>
                  <dt>渲染对象</dt><dd>{canvasInfo?.objects ?? '—'}</dd>
                  <dt>包围盒 mm</dt><dd>{canvasInfo ? canvasInfo.bounds.map((value) => Math.round(value)).join(' × ') : '—'}</dd>
                </dl>
              </section>
              <section>
                <h4>节点</h4>
                <div className={styles.nodeList}>
                  {view.nodes.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className={`${styles.nodeRow}${selectedNodeId === node.id ? ` ${styles.nodeRowSelected}` : ''}`}
                      aria-pressed={selectedNodeId === node.id}
                      onClick={() => setSelectedNodeId(selectedNodeId === node.id ? null : node.id)}
                    >
                      <span className={styles.nodeName}>{node.id}</span>
                      <span className={styles.meta}>{node.type}</span>
                      <span className={styles.nodeDims}>
                        {node.dimensions
                          ? Object.entries(node.dimensions).map(([key, value]) => `${key} ${value}`).join(' · ')
                          : node.source?.path || '—'}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              {view.scene.constraints && view.scene.constraints.length > 0 ? (
                <section>
                  <h4>约束</h4>
                  <p className={styles.meta}>
                    {view.scene.constraints.map((constraint) => `${CONSTRAINT_KIND_LABEL[constraint.kind]} ${constraint.a}→${constraint.b}（${constraint.axis}${constraint.value === undefined ? '' : ` ${constraint.value}${constraint.kind === 'angle' ? '°' : 'mm'}`}）`).join('；')}
                  </p>
                </section>
              ) : null}
              <section>
                <h4>视角书签</h4>
                {bookmarks.length === 0 ? <p className={styles.meta}>保存当前相机视角后，可一键恢复。</p> : (
                  <div className={styles.bookmarks}>
                    {bookmarks.map((bookmark, index) => (
                      <button
                        key={bookmark.id}
                        type="button"
                        className={button.ghost}
                        onClick={() => cameraApiRef.current?.setView(bookmark.position, bookmark.target)}
                      >
                        视角 {index + 1}
                      </button>
                    ))}
                    <button type="button" className={button.ghost} onClick={() => persistBookmarks([])}>清除书签</button>
                  </div>
                )}
              </section>
            </>
          ) : (
            <p className={styles.meta}>导入外部 GLB/GLTF/STL/OBJ 后仅显示几何预览（STL/OBJ 单位按文件原值）；参数与约束以 SceneSpec 为准。</p>
          )}
        </aside>
      </div>
      {reviewOpen && view ? (
        <Model3DReviewPanel
          key={projectId || 'no-project'}
          projectId={projectId}
          scene={view.scene}
          selectedNodeId={selectedNodeId}
          viewAngle={viewAngle}
          onClose={() => setReviewOpen(false)}
        />
      ) : null}
      {editOpen && view ? (
        <Model3DEditPanel projectId={projectId} scene={view.scene} onSceneUpdated={loadStructured} />
      ) : null}
      {compareError ? <div className={styles.error} role="alert">{compareError}</div> : null}
      {compareScene && compareDiff ? (
        <section className={styles.compare} data-testid="model3d-compare-panel">
          <header className={styles.compareHead}>
            <strong>SceneSpec 对比</strong>
            <span className={styles.meta}>{compareDiff.beforeHash.slice(0, 12)} → {compareDiff.afterHash.slice(0, 12)}</span>
            <button type="button" className={button.ghost} onClick={() => { setCompareScene(null); setCompareDiff(null); }}>关闭</button>
          </header>
          {compareDiff.changed ? (
            <div className={styles.compareRows}>
              {compareDiff.parameters.map((item) => (
                <span key={`param-${item.name}`}>参数 {item.name}：{item.before ?? '∅'} → {item.after ?? '∅'}</span>
              ))}
              {compareDiff.nodes.map((item) => (
                <span key={`node-${item.id}`}>节点 {item.id}：{item.status}{item.fields.length ? `（${item.fields.join('、')}）` : ''}</span>
              ))}
              {compareDiff.constraints.added.length > 0 ? <span>新增约束 {compareDiff.constraints.added.length}</span> : null}
              {compareDiff.constraints.removed.length > 0 ? <span>移除约束 {compareDiff.constraints.removed.length}</span> : null}
            </div>
          ) : <p className={styles.meta}>两个 SceneSpec 的语义一致。</p>}
        </section>
      ) : null}
      {sketchOpen ? <SketchSpecDialog onClose={() => setSketchOpen(false)} /> : null}
    </div>
  );
}
