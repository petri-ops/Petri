import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { StatusBadge } from '@/components/ui/controls/Status';
import { projectCapabilityAxis, projectEvidenceAxis, projectExecutionAxis } from '@/lib/statusProjection';
import { reviewModel3D, type Model3DReviewResult, type Model3DReviewView } from '@/lib/model3dClient';
import { createAnnotation } from '@/lib/annotation-client';
import { workspaceFileUrlFor } from '@/lib/previewFileUtils';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
import type { Scene3DSpec } from '@/lib/scene3d';
import button from '@/components/ui/controls/button.module.css';
import styles from './Model3DReviewPanel.module.css';

// camera 视角只在场景声明了 camera 时后端才出图；未声明时 renders['camera'] 缺席即自然跳过。
const VIEW_ORDER: Model3DReviewView[] = ['front', 'top', 'side', 'iso', 'camera'];
const VIEW_LABEL: Record<Model3DReviewView, string> = {
  front: '前视图',
  top: '顶视图',
  side: '侧视图',
  iso: '等轴视图',
  camera: '声明机位',
};

interface SelectedRow {
  key: string;
  view: Model3DReviewView;
  kind: '观察' | '疑似问题' | '不确定';
  text: string;
}

interface Model3DReviewPanelProps {
  projectId: string | null;
  scene: Scene3DSpec | null;
  selectedNodeId?: string | null;
  viewAngle?: Model3DReviewView;
  onClose: () => void;
}

function rowsFromResult(result: Model3DReviewResult): SelectedRow[] {
  const rows: SelectedRow[] = [];
  for (const view of result.vision.views || []) {
    for (const [index, text] of view.observations.entries()) {
      rows.push({ key: `${view.view}:observation:${index}`, view: view.view, kind: '观察', text });
    }
    for (const [index, text] of view.suspectedIssues.entries()) {
      rows.push({ key: `${view.view}:issue:${index}`, view: view.view, kind: '疑似问题', text });
    }
    for (const [index, text] of view.uncertain.entries()) {
      rows.push({ key: `${view.view}:uncertain:${index}`, view: view.view, kind: '不确定', text });
    }
  }
  return rows;
}

function buildPrompt(
  result: Model3DReviewResult,
  selected: SelectedRow[],
  selectionContext: { nodeId: string | null; viewCamera: Model3DReviewView },
): string {
  const views = [...new Set(selected.map((row) => row.view))];
  const lines = [
    `[3D 视觉 QA · 场景 ${result.sceneHash.slice(0, 12)} · Blender ${result.provider.version || 'unknown'}]`,
    `选择上下文：sceneRevision=${result.sceneHash.slice(0, 12)} · nodeId=${selectionContext.nodeId || '未选择'} · viewCamera=${selectionContext.viewCamera}`,
    '以下观察来自多视角渲染的视觉检查，只作线索；尺寸与几何结论仍以 SceneSpec 与 Blender 网格报告为准。',
  ];
  for (const view of views) {
    const renderPath = result.render.report.renders?.[view];
    lines.push(`视图 ${view}（${VIEW_LABEL[view]}）${renderPath ? `渲染：${renderPath}` : ''}`.trim());
    for (const row of selected.filter((entry) => entry.view === view)) {
      lines.push(`- ${row.kind}[${row.key}]：${row.text}`);
    }
  }
  lines.push('请结合渲染图与上述观察，定位原因并给出可执行的 SceneSpec 修改建议。');
  return lines.join('\n');
}

function buildRenderPrompt(
  result: Model3DReviewResult,
  selectionContext: { nodeId: string | null; viewCamera: Model3DReviewView },
): string {
  const renders = result.render.report.renders || {};
  const lines = [
    `[3D 多视角渲染 · 场景 ${result.sceneHash.slice(0, 12)} · Blender ${result.provider.version || 'unknown'}]`,
    `选择上下文：sceneRevision=${result.sceneHash.slice(0, 12)} · nodeId=${selectionContext.nodeId || '未选择'} · viewCamera=${selectionContext.viewCamera}`,
    '渲染图由本地 Blender 生成。请按路径用 read_image 读取，并按视图检查可见问题。',
  ];
  for (const view of VIEW_ORDER) {
    if (renders[view]) lines.push(`- ${view}（${VIEW_LABEL[view]}）：${renders[view]}`);
  }
  lines.push('请指出可见缺陷与可执行的 SceneSpec 修改建议；渲染图不能替代尺寸与几何真值。');
  return lines.join('\n');
}

export function Model3DReviewPanel({
  projectId,
  scene,
  selectedNodeId = null,
  viewAngle = 'iso',
  onClose,
}: Model3DReviewPanelProps): React.ReactElement {
  const ready = Boolean(projectId && scene);
  const [phase, setPhase] = React.useState<'running' | 'done' | 'error'>(ready ? 'running' : 'error');
  const [result, setResult] = React.useState<Model3DReviewResult | null>(null);
  const [error, setError] = React.useState<string | null>(
    ready ? null : '视觉 QA 需要已打开的项目与 SceneSpec；GLB/GLTF 预览无参数化源真相。',
  );
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [noticed, setNoticed] = React.useState<'rows' | 'renders' | 'annotation' | null>(null);
  const [annotating, setAnnotating] = React.useState(false);
  const [annotationError, setAnnotationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!projectId || !scene) return;
    let cancelled = false;
    reviewModel3D({ projectId, scene, views: VIEW_ORDER })
      .then((next) => {
        if (cancelled) return;
        setResult(next);
        setPhase('done');
        const defaults = new Set<string>();
        for (const view of next.vision.views || []) {
          view.suspectedIssues.forEach((_text, index) => defaults.add(`${view.view}:issue:${index}`));
        }
        setSelected(defaults);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'review_failed');
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, [projectId, scene]);

  const rows = React.useMemo(() => (result ? rowsFromResult(result) : []), [result]);
  const chosen = rows.filter((row) => selected.has(row.key));

  const toggle = (key: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setNoticed(null);
  };

  const addToComposer = () => {
    if (!result || chosen.length === 0) return;
    dispatchPetriEvent(petriEvents.copilotAsk, {
      prompt: buildPrompt(result, chosen, { nodeId: selectedNodeId, viewCamera: viewAngle }),
      compose: true,
    });
    setNoticed('rows');
  };

  const addRendersToComposer = () => {
    if (!result) return;
    dispatchPetriEvent(petriEvents.copilotAsk, {
      prompt: buildRenderPrompt(result, { nodeId: selectedNodeId, viewCamera: viewAngle }),
      compose: true,
    });
    setNoticed('renders');
  };

  const saveAnnotationAndCompose = async () => {
    if (!result || !projectId) return;
    const view = chosen[0]?.view || (result.render.report.renders?.[viewAngle] ? viewAngle : 'front');
    const filePath = result.render.report.renders?.[view];
    if (!filePath) {
      setAnnotationError(`视图 ${view} 没有可用渲染文件，无法保存批注。`);
      return;
    }
    setAnnotating(true);
    setAnnotationError(null);
    try {
      const created = await createAnnotation({
        projectId,
        surface: 'workspace-file',
        filePath,
        artifactName: filePath.split('/').pop() || filePath,
        kind: 'region',
        rect: [0, 0, 1, 1],
        comment: JSON.stringify({
          kind: 'model3d-qa-selection',
          sceneRevision: result.sceneHash,
          nodeId: selectedNodeId || null,
          viewCamera: viewAngle,
          view,
          selected: chosen.map((row) => ({ selectionKey: row.key, kind: row.kind, text: row.text })),
        }),
      });
      const basePrompt = chosen.length > 0
        ? buildPrompt(result, chosen, { nodeId: selectedNodeId, viewCamera: viewAngle })
        : buildRenderPrompt(result, { nodeId: selectedNodeId, viewCamera: viewAngle });
      const prompt = [
        basePrompt,
        `批注：annotationId=${created.annotation.annotationId} · filePath=${filePath}`,
      ].join('\n');
      dispatchPetriEvent(petriEvents.copilotAsk, { prompt, compose: true });
      setNoticed('annotation');
    } catch (error) {
      setAnnotationError(error instanceof Error ? error.message : 'annotation_failed');
    } finally {
      setAnnotating(false);
    }
  };

  const openRender = (view: Model3DReviewView) => {
    const path = result?.render.report.renders?.[view];
    if (!projectId || !path) return;
    dispatchPetriEvent(petriEvents.projectOpenWorkspaceFile, {
      projectId,
      relativePath: path,
      name: path.split('/').pop() || path,
    });
  };

  return (
    <section className={styles.root} data-testid="model3d-review-panel" aria-label="3D 视觉 QA">
      <header className={styles.header}>
        <span className={styles.title}>
          <Icon name="shield" size={14} />
          <strong>视觉 QA</strong>
        </span>
        {result ? (
          <>
            <StatusBadge projection={projectExecutionAxis(result.render.report.ok === false ? 'failed' : 'completed')} />
            <span className={styles.visionStatus}>
              视觉 <StatusBadge projection={projectCapabilityAxis(result.vision.status)} />
            </span>
          </>
        ) : null}
        <button type="button" className={button.ghost} onClick={onClose} aria-label="关闭视觉 QA">
          <Icon name="x" size={14} />
        </button>
      </header>

      {phase === 'running' ? (
        <p className={styles.meta} data-testid="model3d-review-running">正在用 Blender 渲染四视图并请求视觉检查…（首次渲染可能需要数十秒）</p>
      ) : null}

      {phase === 'error' ? (
        <div className={styles.error} role="alert">{error}</div>
      ) : null}

      {result ? (
        <>
          <div className={styles.renders}>
            {VIEW_ORDER.filter((view) => result.render.report.renders?.[view]).map((view) => {
              const path = result.render.report.renders?.[view] as string;
              const viewRows = rows.filter((row) => row.view === view);
              const allChosen = viewRows.length > 0 && viewRows.every((row) => selected.has(row.key));
              return (
                <figure key={view} className={styles.renderCard} data-selected={allChosen ? 'true' : 'false'}>
                  <button
                    type="button"
                    className={styles.thumbHit}
                    onClick={() => {
                      const keys = viewRows.map((row) => row.key);
                      setSelected((previous) => {
                        const next = new Set(previous);
                        const shouldSelect = !keys.every((key) => next.has(key));
                        for (const key of keys) {
                          if (shouldSelect) next.add(key);
                          else next.delete(key);
                        }
                        return next;
                      });
                      setNoticed(null);
                    }}
                    aria-label={`选择 ${VIEW_LABEL[view]} 的观察`}
                  >
                    <img src={workspaceFileUrlFor(projectId || '', path)} alt={`${VIEW_LABEL[view]}渲染`} />
                  </button>
                  <figcaption>
                    <span>{VIEW_LABEL[view]}</span>
                    <button type="button" className={button.ghost} onClick={() => openRender(view)}>
                      打开
                    </button>
                  </figcaption>
                </figure>
              );
            })}
          </div>

          {result.render.report.mesh ? (
            <section className={styles.geometry} data-testid="model3d-review-geometry">
              <h4>
                几何报告
                <StatusBadge projection={projectEvidenceAxis({
                  hasEvidence: true,
                  truthStatus: result.render.report.ok !== false && result.render.report.mesh.watertight === true ? 'verified' : 'degraded',
                })} />
              </h4>
              <dl className={styles.fields}>
                <dt>对象</dt><dd>{result.render.report.mesh.objects ?? '—'}</dd>
                <dt>顶点 / 三角面</dt><dd>{result.render.report.mesh.vertices ?? '—'} / {result.render.report.mesh.triangles ?? '—'}</dd>
                <dt>非流形边</dt><dd>{result.render.report.mesh.nonManifoldEdges ?? '—'}</dd>
                <dt>水密</dt><dd>{result.render.report.mesh.watertight === true ? '是' : result.render.report.mesh.watertight === false ? '否' : '未报告'}</dd>
                <dt>体积 mm³</dt>
                <dd>
                  {result.render.report.mesh.volumesMm3
                    ? Object.entries(result.render.report.mesh.volumesMm3).map(([key, value]) => `${key} ${Math.round(value)}`).join(' · ')
                    : '—'}
                </dd>
              </dl>
            </section>
          ) : null}

          {result.vision.status === 'unavailable' ? (
            <p className={styles.warning} data-testid="model3d-review-vision-unavailable">
              视觉检查不可用（{result.vision.reason || 'not_configured'}）：渲染与 Blender 网格报告仍然有效；
              可在设置中配置 vision 模型后重试，或直接把渲染路径加入对话。
            </p>
          ) : null}

          {result.vision.status === 'degraded' ? (
            <p className={styles.warning}>
              视觉模型返回非结构化文本，已如实保留原文；未解析的观察不等同于结构化结论。
            </p>
          ) : null}

          {rows.length > 0 ? (
            <div className={styles.rows}>
              {rows.map((row) => (
                <label key={row.key} className={styles.row} data-kind={row.kind}>
                  <input type="checkbox" checked={selected.has(row.key)} onChange={() => toggle(row.key)} />
                  <span className={styles.rowKind}>{row.kind}</span>
                  <span>{row.text}</span>
                </label>
              ))}
            </div>
          ) : null}

          {result.vision.rawText ? (
            <pre className={styles.raw}>{result.vision.rawText}</pre>
          ) : null}

          {annotationError ? <p className={styles.error} role="alert">{annotationError}</p> : null}

          <footer className={styles.footer}>
            <span className={styles.meta}>
              {result.vision.model ? `模型 ${result.vision.model} · ` : ''}
              场景 {result.sceneHash.slice(0, 12)} · {result.render.outDir}
            </span>
            <button
              type="button"
              className={button.ghost}
              onClick={addRendersToComposer}
              disabled={!result.render.report.renders || Object.keys(result.render.report.renders).length === 0}
            >
              {noticed === 'renders' ? '已加入渲染路径' : '引用渲染视图'}
            </button>
            <button
              type="button"
              className={button.ghost}
              onClick={() => { void saveAnnotationAndCompose(); }}
              disabled={annotating || !result.render.report.renders || Object.keys(result.render.report.renders).length === 0}
            >
              {annotating ? '正在保存批注…' : noticed === 'annotation' ? '已保存批注并加入' : '保存批注并引用'}
            </button>
            <button
              type="button"
              className={button.primary}
              disabled={chosen.length === 0}
              onClick={addToComposer}
            >
              {noticed === 'rows' ? '已加入输入框' : `加入对话（${chosen.length}）`}
            </button>
          </footer>
        </>
      ) : null}
    </section>
  );
}
