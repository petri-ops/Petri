import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { dispatchPetriEvent, petriEvents, subscribePetriEvent } from '@/lib/events';
import { StatusBadge } from '@/components/ui/controls/Status';
import { projectCapabilityAxis } from '@/lib/statusProjection';
import { fetchModel3DCapability, resolveModel3DScene } from '@/lib/model3dClient';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { workspaceFileUrlFor } from '@/lib/previewFileUtils';
import {
  normalizeScene3DForView,
  sampleScene3D,
  SCENE3D_CONSTRAINT_NOTE_PREFIX,
  type Scene3DConstraintKind,
  type Scene3DView,
} from '@/lib/scene3d';
import {
  CAD_INPUT_ACCEPT_ATTR,
  MAX_CAD_BYTES,
  MAX_MESH_BYTES,
  cadFormatForPath,
  cadTooLargeMessage,
  meshFormatForPath,
  meshTooLargeMessage,
  MESH_INPUT_ACCEPT_ATTR,
  type MeshInputFormat,
} from '@/lib/meshAssets';
import { importCadAssetAsNode, importMeshAssetAsNode } from '@/lib/model3dAssetImport';
import type { Model3DCameraApi, Model3DPoint } from './Model3DScene';
import { Model3DReviewPanel } from './Model3DReviewPanel';
import { SceneConstraintEditor } from './SceneConstraintEditor';
import { SketchSpecDialog } from './SketchSpecDialog';
import { Model3DEditPanel } from './Model3DEditPanel';
import { Model3DGenerateDialog } from './Model3DGenerateDialog';
import {
  compareSceneGeometry,
  diffSceneSpecs,
  generateCadDrawing,
  readSceneFile,
  type CadDrawingResult,
  type GeometryCompareResult,
  type SceneDiff,
} from '@/lib/sceneEditClient';
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
const CONSTRAINT_KIND_LABEL: Record<Scene3DConstraintKind, string> = { align: '对齐', distance: '间距', angle: '转角', mate: '贴合' };
// 逐节点资产观察（外部 mesh / 基础色贴图）走告警区而非错误条；前缀集中一处，新增资产类别不再漏配。
const ASSET_NOTICE_PREFIXES = ['mesh_reference_', 'texture_reference_'];

interface Model3DInitialOpen {
  scenePath?: string;
  meshPath?: string;
  jobId?: string;
  label?: string;
  nonce: number;
}

const LAST_OPEN_KEY_PREFIX = 'petri.model3d.lastOpen.';

function lastOpenKey(projectId: string): string {
  return `${LAST_OPEN_KEY_PREFIX}${projectId}`;
}

function readLastOpen(projectId: string): { scenePath?: string; meshPath?: string } | null {
  try {
    const raw = window.localStorage.getItem(lastOpenKey(projectId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as { scenePath?: unknown; meshPath?: unknown };
    const scenePath = typeof record.scenePath === 'string' && record.scenePath ? record.scenePath : undefined;
    const meshPath = typeof record.meshPath === 'string' && record.meshPath ? record.meshPath : undefined;
    return scenePath || meshPath ? { scenePath, meshPath } : null;
  } catch {
    return null;
  }
}

function saveLastOpen(projectId: string, value: { scenePath?: string; meshPath?: string }): void {
  try { window.localStorage.setItem(lastOpenKey(projectId), JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/** 项目 model3d/ 下最新的 SceneSpec（只读发现；找不到就保持空态，不猜别处）。 */
async function discoverLatestScene(projectId: string): Promise<string | null> {
  try {
    const token = getToken();
    const resp = await fetch(`${getApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/tree?prefix=model3d%2F`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data: unknown = await resp.json();
    const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const entries = Array.isArray(record.entries) ? record.entries as Array<Record<string, unknown>> : [];
    const scenes = entries.filter((entry) => entry && entry.type === 'file'
      && typeof entry.name === 'string' && entry.name.toLowerCase().endsWith('.scene3d.json'));
    scenes.sort((a, b) => Number(b.modifiedAt || 0) - Number(a.modifiedAt || 0));
    const newest = scenes[0];
    return newest ? `model3d/${String(newest.name)}` : null;
  } catch {
    return null;
  }
}

export function Model3DSurface({ projectId = null, initialOpen = null, active = true }: {
  projectId?: string | null;
  /** UI-653/654 — 从聊天产物卡/文件预览/结果预览请求打开的场景或网格。 */
  initialOpen?: Model3DInitialOpen | null;
  /** 右栏该 tab 是否可见；不可见时不持有 WebGL 上下文（上下文名额有限）。 */
  active?: boolean;
}): React.ReactElement {
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
  const [cadSource, setCadSource] = React.useState<{ path: string; format: 'step' | 'iges'; name: string } | null>(null);
  const [drawingBusy, setDrawingBusy] = React.useState(false);
  const [drawingResult, setDrawingResult] = React.useState<CadDrawingResult | null>(null);
  const [drawingError, setDrawingError] = React.useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = React.useState(false);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [sketchOpen, setSketchOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [measureMode, setMeasureMode] = React.useState(false);
  // BLOCK-344 P2 — 洋葱皮对比：EditPanel 修订对比 → 3D 视口 ghost 叠加
  const [compare, setCompare] = React.useState<{ spec: unknown; revisionId: string; opacity: number } | null>(null);
  // BLOCK-344 P4 — 渲染回验：3D 视口快照 → composer 附件 + 判据 prompt（复用 UI-680 通道）
  const snapshotApiRef = React.useRef<{ capture: () => string | null } | null>(null);
  // BLOCK-344 P3 — 提案幽灵：agent model3d_propose 结果（ghost 高亮 + 逐项接受/整单拒绝）
  const [proposal, setProposal] = React.useState<{ scene: unknown; operations: Array<Record<string, unknown>>; beforeHash: string; path: string } | null>(null);

  const [measurePoints, setMeasurePoints] = React.useState<Model3DPoint[]>([]);
  // UI-653 — 当前场景的来源文件（聊天产物卡/文件预览打开）；参数/约束编辑锚定此路径。
  const [sceneSourcePath, setSceneSourcePath] = React.useState<string | null>(null);
  React.useEffect(() => {
    const off = subscribePetriEvent(petriEvents.model3dProposal, (detail) => {
      if (!detail || typeof detail.path !== 'string') return;
      // 路径匹配当前场景来源（缺省场景路径恒匹配）
      const current = sceneSourcePath || 'model3d/scene.scene3d.json';
      if (detail.path !== current) return;
      setProposal({ scene: detail.scene, operations: detail.operations, beforeHash: detail.beforeHash, path: detail.path });
    });
    return off;
  }, [sceneSourcePath]);

  // UI-654 — 工作区网格来源（GLB/GLTF/STL/OBJ 只做几何预览，不是可编辑场景）。
  const [meshSourcePath, setMeshSourcePath] = React.useState<string | null>(null);
  // 导出 run 的 scene.json 只读（scene store 写面只认 .scene3d.json）：编辑目标回落项目场景。
  const snapshotSourceReadOnly = Boolean(sceneSourcePath && !sceneSourcePath.toLowerCase().endsWith('.scene3d.json'));
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
  const [geometryDiff, setGeometryDiff] = React.useState<GeometryCompareResult | null>(null);
  const [geometryError, setGeometryError] = React.useState<string | null>(null);
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
    if (modelUrl && modelUrl.startsWith('blob:')) URL.revokeObjectURL(modelUrl);
  }, [modelUrl]);

  const evalSeqRef = React.useRef(0);

  /**
   * BLOCK-322 P3-02b — 有约束就向本地后端要一次求值结果（纯函数端点，不写盘、不改场景文件）。
   * 求值只在服务端发生；失败或后端缺席时保持声明位置并把原因如实显示，绝不在前端重解一遍
   * （第二套求解器=plan §4 红线 2）。序号守卫防止用户换场景后旧响应覆盖新画面。
   */
  const evaluateConstraintsForPreview = React.useCallback(async (loaded: Scene3DView) => {
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
  }, []);

  const loadStructured = React.useCallback((raw: unknown) => {
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
  }, [evaluateConstraintsForPreview]);


  // UI-653 — 聊天产物卡「在 3D 工作台打开」：读取本次导出 run 的场景快照。
  // 快照是这次作业的真实场景（导出前后一致），编辑锚定同一路径，不猜另一份源场景。
  const loadMeshFromWorkspace = React.useCallback((meshPath: string): boolean => {
    if (!projectId) return false;
    const format = meshFormatForPath(meshPath);
    if (!format) {
      setError(`网格格式不支持：${meshPath}`);
      return false;
    }
    setView(null);
    setError(null);
    setReviewOpen(false);
    setSelectedNodeId(null);
    setMeasurePoints([]);
    setMeasureMode(false);
    setSceneSourcePath(null);
    setMeshSourcePath(meshPath);
    setModelUrl(workspaceFileUrlFor(projectId, meshPath));
    setModelFormat(format);
    setWarnings(format === 'stl' || format === 'obj'
      ? ['外部 STL/OBJ 仅几何预览，单位按文件原值；参数与约束请使用 SceneSpec。']
      : []);
    setAssetNotice(`已打开工作区网格：${meshPath}（仅几何预览）`);
    return true;
  }, [projectId]);

  const loadSceneFromWorkspace = React.useCallback(async (scenePath: string, notice: string): Promise<boolean> => {
    if (!projectId) return false;
    try {
      const saved = await readSceneFile(projectId, scenePath);
      loadStructured(saved.scene);
      setSceneSourcePath(scenePath);
      setMeshSourcePath(null);
      setCadSource(null);
      setAssetNotice(notice);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setError(`场景读取失败：${reason}（${scenePath}）`);
      return false;
    }
  }, [projectId, loadStructured]);

  // UI-653/654 — 外部打开请求：场景（含导出快照）或工作区网格。
  // 不用「已处理 ref」挡第二次 setup：StrictMode 开发态会 setup→cleanup→setup，
  // 首轮 cleanup 已把 cancelled 置真，再用 ref 挡住二轮会把请求结果整个丢弃
  // （实机抓真：树查询已发出但场景从未载入）。依赖稳定 → 重跑代价只是一次读。
  React.useEffect(() => {
    if (!initialOpen || !projectId) return undefined;
    let active = true;
    void (async () => {
      if (initialOpen.scenePath) {
        const ok = await loadSceneFromWorkspace(initialOpen.scenePath, `已打开场景：${initialOpen.scenePath}`);
        if (active && ok) saveLastOpen(projectId, { scenePath: initialOpen.scenePath });
        return;
      }
      if (initialOpen.meshPath && active) {
        if (loadMeshFromWorkspace(initialOpen.meshPath)) saveLastOpen(projectId, { meshPath: initialOpen.meshPath });
      }
    })();
    return () => { active = false; };
  }, [initialOpen, loadMeshFromWorkspace, loadSceneFromWorkspace, projectId]);

  // UI-654 — 无外部请求时自动恢复：上次打开 → 项目最新 SceneSpec；不再要求手动导入。
  // 同上：StrictMode 双挂载下允许二轮重跑（重复读一次），而不是被 ref 永久挡住。
  React.useEffect(() => {
    if (!projectId || initialOpen) return undefined;
    let active = true;
    void (async () => {
      const last = readLastOpen(projectId);
      if (!active) return;
      if (last?.scenePath) {
        const ok = await loadSceneFromWorkspace(last.scenePath, `已恢复上次场景：${last.scenePath}`);
        if (!active || ok) return;
      }
      if (last?.meshPath && active && loadMeshFromWorkspace(last.meshPath)) return;
      const latest = await discoverLatestScene(projectId);
      if (!active || !latest) return;
      const ok = await loadSceneFromWorkspace(latest, `已自动打开项目最新场景：${latest}`);
      if (active && ok) saveLastOpen(projectId, { scenePath: latest });
    })();
    return () => { active = false; };
  }, [initialOpen, loadMeshFromWorkspace, loadSceneFromWorkspace, projectId]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setWarnings([]);
    setAssetNotice(null);
    // 手动换来源即解除「导出快照/工作区网格」锚定，避免后续编辑误写回上一次作业或文件。
    setSceneSourcePath(null);
    setMeshSourcePath(null);
    if (file.size > MAX_MESH_BYTES) {
      setError(meshTooLargeMessage());
      return;
    }
    const format = meshFormatForPath(file.name);
    if (format) {
      if (modelUrl && modelUrl.startsWith('blob:')) URL.revokeObjectURL(modelUrl);
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
    if (cadFormatForPath(file.name)) {
      setError('STEP/IGES 需要先经 CAD 内核转换：请使用「导入为场景节点」，转换后可生成线框工程图。');
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
    const cadFormat = cadFormatForPath(file.name);
    if (cadFormat && file.size > MAX_CAD_BYTES) {
      setError(cadTooLargeMessage());
      return;
    }
    setImporting(true);
    setError(null);
    setAssetNotice(null);
    setDrawingResult(null);
    setDrawingError(null);
    try {
      if (cadFormat) {
        const imported = await importCadAssetAsNode({ projectId, file, scene: view.scene });
        loadStructured(imported.scene);
        setCadSource({ path: imported.cad.sourcePath, format: imported.cad.sourceFormat, name: file.name });
        setWarnings((previous) => [...previous,
          `已导入 CAD ${file.name}（${cadFormat.toUpperCase()} · 源 sha256 ${imported.cad.sourceSha256.slice(0, 12)}… · 派生 ${imported.cad.derivedFormat.toUpperCase()} ${imported.bytes} 字节）`]);
        setAssetNotice(`已作为节点 ${imported.node.id} 写入 ${imported.scenePath}；可生成 HLR 线框工程图`);
        setSceneSourcePath(imported.scenePath);
        setMeshSourcePath(null);
        saveLastOpen(projectId, { scenePath: imported.scenePath });
        return;
      }
      setCadSource(null);
      const imported = await importMeshAssetAsNode({ projectId, file, scene: view.scene });
      loadStructured(imported.scene);
      setWarnings((previous) => [...previous,
        `已导入 ${imported.path}（${imported.bytes} 字节 · sha256 ${imported.sourceSha256.slice(0, 12)}…）`]);
      setAssetNotice(`已作为节点 ${imported.node.id} 写入 ${imported.scenePath}`);
      setSceneSourcePath(imported.scenePath);
      setMeshSourcePath(null);
      saveLastOpen(projectId, { scenePath: imported.scenePath });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'asset_import_failed');
    } finally {
      setImporting(false);
    }
  };

  const onGenerateDrawing = async () => {
    if (!projectId || !cadSource) return;
    setDrawingBusy(true);
    setDrawingError(null);
    setDrawingResult(null);
    try {
      const result = await generateCadDrawing({ projectId, path: cadSource.path });
      setDrawingResult(result);
      setAssetNotice(`已生成线框工程图 ${result.svgPath}（sha256 ${result.svgSha256.slice(0, 12)}…；不含尺寸链/GD&T）`);
    } catch (caught) {
      setDrawingError(caught instanceof Error ? caught.message : 'drawing_failed');
    } finally {
      setDrawingBusy(false);
    }
  };

  const onReady = React.useCallback((info: { objects: number; bounds: number[] }) => {
    setCanvasInfo(info);
  }, []);
  const onSceneError = React.useCallback((message: string) => {
    // 外部 mesh / 贴图都是逐节点观察，可能同时多条：累积进告警区，不互相覆盖（红线4 既不伪造也不吞掉）；
    // 其余（WebGL 初始化/上下文丢失）仍是阻断性错误，走错误条。
    if (ASSET_NOTICE_PREFIXES.some((prefix) => message.startsWith(prefix))) {
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
      setGeometryDiff(null);
      setGeometryError(null);
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
        {capability?.cad ? (
          <span className={styles.capability} data-testid="model3d-cad-capability">
            CAD <StatusBadge projection={projectCapabilityAxis(capability.cad.status)} />
            {capability.cad.kernel ? <span className={styles.meta}>{capability.cad.kernel}</span> : null}
          </span>
        ) : null}
        {capability?.generation ? (
          <span className={styles.capability} data-testid="model3d-generation-capability">
            AI 生成 <StatusBadge projection={projectCapabilityAxis(capability.generation.status)} />
            {capability.generation.provider && capability.generation.provider !== 'none'
              ? <span className={styles.meta}>{capability.generation.provider}</span>
              : null}
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
            : '上传 mesh 到 model3d/assets/ 或 STEP/IGES 源文件到 model3d/incoming/，转换后作为 mesh-reference 节点写入 SceneSpec'}
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
          disabled={!view || !projectId}
          title={!view || !projectId
            ? '需要先加载 SceneSpec 并打开项目工作区'
            : '外部文生 3D（默认关；未配置 key 时只显示不可用原因）'}
          onClick={() => setGenerateOpen(true)}
        >
          AI 生成
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
          accept={`${MESH_INPUT_ACCEPT_ATTR},${CAD_INPUT_ACCEPT_ATTR}`}
          hidden
          onChange={(event) => { void onAssetFile(event.target.files?.[0]); event.target.value = ''; }}
        />
      </header>

      <div className={styles.body}>
        <div className={styles.viewport} data-state={view || modelUrl ? 'ready' : 'empty'}>
          {!view && !modelUrl ? (
            <div className={styles.empty}>
              <Icon name="layers" size={30} />
              <p>打开一个 SceneSpec，或导入 GLB/GLTF/STL/OBJ 预览；STEP/IGES 请用「导入为场景节点」。</p>
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
                active={active}
                onReady={onReady}
                onError={onSceneError}
                onSelectNode={onSelectNode}
                measureMode={measureMode}
                measurement={measurement}
                onMeasurePoint={onMeasurePoint}
                onCameraApi={onCameraApi}
                ghostView={compare?.spec ?? null}
                ghostOpacity={compare?.opacity}
                onSnapshotApi={(api) => { snapshotApiRef.current = api; }}
              />
            </React.Suspense>
          )}
          <div className={styles.tools} role="group" aria-label="3D 测量与视角">
            <button
              type="button"
              className={button.ghost}
              data-action="model3d-render-check"
              disabled={!view}
              title="渲染回验：当前视口渲染成 PNG 快照 + 判据放进会话（图片附件 + prompt）"
              onClick={() => {
                const capture = snapshotApiRef.current?.capture;
                const png = capture ? capture() : null;
                if (!png) { setError('渲染回验失败：快照不可用（画布污染或未就绪）'); return; }
                const spec = view?.scene as { parameters?: Record<string, unknown>; nodes?: Array<{ id?: string }> } | undefined;
                const params = spec?.parameters ? Object.entries(spec.parameters).map(([k, v]) => `${k}=${String(v)}`).join(', ') : '';
                const nodes = spec?.nodes ? spec.nodes.map((n) => `#${n.id ?? '?'}`).join(' ') : '';
                dispatchPetriEvent(petriEvents.composerAttachImage, { dataUrl: png, name: `model3d-render-check-${Date.now()}.png` });
                dispatchPetriEvent(petriEvents.copilotAsk, {
                  prompt: [
                    `3D 渲染回验请求（SceneSpec ${sceneSourcePath || 'model3d/scene.scene3d.json'}，快照见图片附件）：`,
                    `当前参数：${params || '（无）'}；节点：${nodes || '（无）'}。`,
                    '请用 model3d_inspect 读取该场景文件结构，对照渲染意图逐条核对（几何/材质/约束求解是否自洽）；',
                    '发现可疑处先用 model3d_propose 说方案，我确认后再 apply。',
                  ].join('\n'),
                });
                setError(null);
                setAssetNotice?.('已把渲染回验快照与判据放进会话输入框');
              }}
            >
              回验
            </button>
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
          {assetNotice ? (
            <div className={styles.notice}>
              <span>{assetNotice}</span>
              {cadSource ? (
                <button type="button" className={button.ghost} disabled={drawingBusy} onClick={() => { void onGenerateDrawing(); }}>
                  {drawingBusy ? '生成中…' : '生成工程图'}
                </button>
              ) : null}
              {drawingResult?.svgUrl ? (
                <a className={styles.meta} href={drawingResult.svgUrl} target="_blank" rel="noreferrer">打开工程图</a>
              ) : null}
            </div>
          ) : null}
          {/* UI-654 — 网格预览没有 SceneSpec 视图，来源独立于场景字段显示 */}
          {meshSourcePath ? (
            <p className={styles.meta} data-testid="model3d-mesh-source">
              {meshSourcePath}（工作区网格 · 仅几何预览）
            </p>
          ) : null}
          {drawingError ? <div className={styles.error} role="alert">{drawingError}</div> : null}
          {drawingResult ? (
            <p className={styles.meta}>
              线框工程图：{drawingResult.svgPath}（{drawingResult.bytes} 字节 · sha256 {drawingResult.svgSha256.slice(0, 12)}…）· 隐藏线已画 / 尺寸链与 GD&T 未包含
            </p>
          ) : null}
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
                  {/* UI-653 — 从聊天产物卡载入时标出来源：编辑写回的是这份导出快照 */}
                  {sceneSourcePath ? (
                    <>
                      <dt>场景源</dt>
                      <dd data-testid="model3d-scene-source">
                        {sceneSourcePath}
                        {sceneSourcePath.toLowerCase().endsWith('.scene3d.json')
                          ? '（项目场景）'
                          : '（本次导出快照 · 只读；参数/约束编辑写入项目 SceneSpec）'}
                      </dd>
                    </>
                  ) : null}
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
              <section>
                <h4>约束</h4>
                {view.scene.constraints && view.scene.constraints.length > 0 ? (
                  <p className={styles.meta}>
                    {view.scene.constraints.map((constraint) => (constraint.kind === 'mate'
                      ? `贴合 ${constraint.a}${constraint.aFace || '?'} → ${constraint.b}${constraint.bFace || '?'}${constraint.offset === undefined ? '' : `（offset ${constraint.offset}mm）`}`
                      : `${CONSTRAINT_KIND_LABEL[constraint.kind]} ${constraint.a}→${constraint.b}（${constraint.axis || '?'}${constraint.value === undefined ? '' : ` ${constraint.value}${constraint.kind === 'angle' ? '°' : 'mm'}`}）`)).join('；')}
                  </p>
                ) : (
                  <p className={styles.meta}>暂无约束。</p>
                )}
                {/* P3-03 v2b 第二票 — 约束编辑器：feature 下拉引用特征表，add/remove_constraint 走 scene/apply */}
                {projectId && (
                  <SceneConstraintEditor
                    projectId={projectId}
                    scene={view.scene}
                    scenePath={(!snapshotSourceReadOnly && sceneSourcePath)
                      || view.scene.nodes.find((n) => n.source?.path)?.source?.path
                      || 'model3d/scene.scene3d.json'}
                    expectedHash={null}
                    onSceneUpdated={(updated) => { if (updated) loadStructured(updated); }}
                  />
                )}
              </section>
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
            <p className={styles.meta}>导入外部 GLB/GLTF/STL/OBJ 后仅显示几何预览（STL/OBJ 单位按文件原值）；STEP/IGES 经 CAD 内核转换为派生网格资产；参数与约束以 SceneSpec 为准。</p>
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
      {/* key 随来源切换重挂载：编辑面板的路径/草稿从新来源初始化（不在 effect 里同步 setState）。
          run 快照只读 → 编辑目标回落项目 SceneSpec，不把作业目录当可写场景。 */}
      {editOpen && view ? (
        <Model3DEditPanel
          key={snapshotSourceReadOnly ? 'default-scene' : (sceneSourcePath || 'default-scene')}
          projectId={projectId}
          scene={view.scene}
          initialScenePath={snapshotSourceReadOnly ? undefined : (sceneSourcePath || undefined)}
          onSceneUpdated={loadStructured}
          onCompareChange={setCompare}
          proposal={proposal}
          onProposalAccept={setProposal}
        />
      ) : null}

      {compareError ? <div className={styles.error} role="alert">{compareError}</div> : null}
      {compareScene && compareDiff ? (
        <section className={styles.compare} data-testid="model3d-compare-panel">
          <header className={styles.compareHead}>
            <strong>SceneSpec 对比</strong>
            <span className={styles.meta}>{compareDiff.beforeHash.slice(0, 12)} → {compareDiff.afterHash.slice(0, 12)}</span>
            <button type="button" className={button.ghost} disabled={!projectId} onClick={() => { void compareSceneGeometry({ projectId: projectId || '', before: view?.scene, after: compareScene }).then(setGeometryDiff).catch((caught) => setGeometryError(caught instanceof Error ? caught.message : 'geometry_compare_failed')); }}>几何差异</button>
            <button type="button" className={button.ghost} onClick={() => { setCompareScene(null); setCompareDiff(null); setGeometryDiff(null); setGeometryError(null); }}>关闭</button>
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
          {geometryError ? <p className={styles.error} role="alert">{geometryError}</p> : null}
          {geometryDiff ? (
            <div className={styles.compareRows} data-testid="model3d-geometry-diff">
              <span>对象 {geometryDiff.before.objects} → {geometryDiff.after.objects}（Δ {geometryDiff.deltas.objects ?? '—'}）</span>
              <span>三角面 {geometryDiff.before.triangles} → {geometryDiff.after.triangles}（Δ {geometryDiff.deltas.triangles ?? '—'}）</span>
              <span>体积 mm³ {geometryDiff.before.totalVolumeMm3 ?? '—'} → {geometryDiff.after.totalVolumeMm3 ?? '—'}（Δ {geometryDiff.deltas.totalVolumeMm3 ?? '—'}）</span>
              <span>包围盒 {geometryDiff.before.boundsMm ? `${geometryDiff.before.boundsMm.x}×${geometryDiff.before.boundsMm.y}×${geometryDiff.before.boundsMm.z}` : '—'} → {geometryDiff.after.boundsMm ? `${geometryDiff.after.boundsMm.x}×${geometryDiff.after.boundsMm.y}×${geometryDiff.after.boundsMm.z}` : '—'}（Δ {geometryDiff.deltas.boundsMm ? `${geometryDiff.deltas.boundsMm.x ?? '—'}×${geometryDiff.deltas.boundsMm.y ?? '—'}×${geometryDiff.deltas.boundsMm.z ?? '—'}` : '—'}）</span>
            </div>
          ) : null}
        </section>
      ) : null}
      {sketchOpen ? <SketchSpecDialog onClose={() => setSketchOpen(false)} /> : null}
      {generateOpen && view && projectId ? (
        <Model3DGenerateDialog
          projectId={projectId}
          scene={view.scene}
          generation={capability?.generation ?? null}
          onClose={() => setGenerateOpen(false)}
          onGenerated={(result) => {
            loadStructured(result.scene);
            setWarnings((previous) => [...previous,
              `AI 生成 ${result.generation.provider}/${result.generation.model || 'unknown'} → ${result.path}（${result.bytes} 字节 · sha256 ${result.sourceSha256.slice(0, 12)}…）`]);
            setAssetNotice(`AI 生成结果已作为节点 ${result.node.id} 写入 ${result.scenePath}`);
            setCadSource(null);
            setDrawingResult(null);
            setGenerateOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
