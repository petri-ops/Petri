import React from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  applySceneOperations,
  diffSceneSpecs,
  listSceneRevisions,
  readSceneFile,
  restoreSceneRevision,
  type SceneDiff,
  type SceneRevisionSummary,
} from '@/lib/sceneEditClient';
import type { Scene3DSpec } from '@/lib/scene3d';
import button from '@/components/ui/controls/button.module.css';
import styles from './Model3DEditPanel.module.css';

interface Model3DEditPanelProps {
  projectId: string | null;
  scene: Scene3DSpec;
  onSceneUpdated: (scene: unknown) => void;
}

function cloneScene(scene: Scene3DSpec): Scene3DSpec {
  return JSON.parse(JSON.stringify(scene)) as Scene3DSpec;
}

function diffText(diff: SceneDiff): string[] {
  const lines: string[] = [];
  for (const item of diff.parameters) {
    lines.push(`参数 ${item.name}：${item.before ?? '∅'} → ${item.after ?? '∅'}`);
  }
  for (const item of diff.nodes) {
    lines.push(`节点 ${item.id}：${item.status}${item.fields.length ? `（${item.fields.join('、')}）` : ''}`);
  }
  if (diff.constraints.added.length > 0) lines.push(`新增约束 ${diff.constraints.added.length}`);
  if (diff.constraints.removed.length > 0) lines.push(`移除约束 ${diff.constraints.removed.length}`);
  return lines;
}

export function Model3DEditPanel({ projectId, scene, onSceneUpdated }: Model3DEditPanelProps): React.ReactElement {
  const [scenePath, setScenePath] = React.useState('model3d/scene.scene3d.json');
  const [savedHash, setSavedHash] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<SceneDiff | null>(null);
  const [revisions, setRevisions] = React.useState<SceneRevisionSummary[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const parameters = React.useMemo(
    () => Object.entries(scene.parameters || {}).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
    [scene],
  );

  React.useEffect(() => {
    let cancelled = false;
    if (!projectId) return undefined;
    void (async () => {
      try {
        const saved = await readSceneFile(projectId, scenePath);
        if (cancelled) return;
        setSavedHash(saved.hash);
        const nextRevisions = await listSceneRevisions(projectId, scenePath);
        if (!cancelled) setRevisions(nextRevisions);
      } catch {
        if (cancelled) return;
        setSavedHash(null);
        setRevisions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, scenePath]);

  const valueFor = (name: string, current: number): number => {
    const text = draft[name];
    if (text === undefined || text === '') return current;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : current;
  };

  const buildOperations = () => parameters
    .map(([name, current]) => ({ name, value: valueFor(name, current) }))
    .filter((entry, index) => entry.value !== parameters[index][1])
    .map((entry) => ({ op: 'set_parameter', name: entry.name, value: entry.value }));

  const runPreview = async () => {
    if (!projectId) {
      setError('参数编辑需要已打开的项目工作区。');
      return;
    }
    const operations = buildOperations();
    if (operations.length === 0) {
      setPreview(null);
      setNotice('参数没有变化。');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = cloneScene(scene);
      for (const operation of operations) next.parameters[String(operation.name)] = Number(operation.value);
      setPreview(await diffSceneSpecs(scene, next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'diff_failed');
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    if (!projectId) {
      setError('参数编辑需要已打开的项目工作区。');
      return;
    }
    const operations = buildOperations();
    if (operations.length === 0) {
      setNotice('参数没有变化。');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await applySceneOperations({
        projectId,
        path: scenePath,
        scene,
        operations,
        expectedHash: savedHash,
        reason: 'user_parameter_edit',
      });
      setPreview(result.diff);
      setDraft({});
      setSavedHash(result.afterHash);
      onSceneUpdated(result.scene);
      setRevisions(await listSceneRevisions(projectId, scenePath));
      setNotice(`已写入 ${result.path}${result.revision ? ` · 修订 ${result.revision.revisionId}` : ''}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'apply_failed');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (revisionId: string) => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await restoreSceneRevision({ projectId, path: scenePath, revisionId });
      const saved = await readSceneFile(projectId, scenePath);
      onSceneUpdated(saved.scene);
      setSavedHash(saved.hash);
      setPreview(null);
      setDraft({});
      setRevisions(await listSceneRevisions(projectId, scenePath));
      setNotice(`已恢复 ${revisionId}（原状态另存为新修订）`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'restore_failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.root} data-testid="model3d-edit-panel">
      <header className={styles.header}>
        <span className={styles.title}><Icon name="pencil" size={14} /><strong>参数编辑</strong></span>
        <span className={styles.meta}>{projectId ? '本地项目' : '需要项目工作区'}</span>
      </header>
      <label className={styles.pathField}>
        <span>SceneSpec 路径</span>
        <input
          value={scenePath}
          onChange={(event) => { setScenePath(event.target.value); setPreview(null); setNotice(null); }}
          spellCheck={false}
        />
      </label>
      <div className={styles.params}>
        {parameters.length === 0 ? <span className={styles.meta}>该场景没有可编辑的数值参数。</span> : null}
        {parameters.map(([name, current]) => (
          <label key={name} className={styles.paramRow}>
            <span>{name}</span>
            <input
              type="number"
              value={draft[name] ?? String(current)}
              onChange={(event) => setDraft((previous) => ({ ...previous, [name]: event.target.value }))}
            />
            <span className={styles.meta}>原 {current}</span>
          </label>
        ))}
      </div>
      <div className={styles.actions}>
        <button type="button" className={button.ghost} disabled={busy} onClick={() => { void runPreview(); }}>预览变更</button>
        <button type="button" className={button.primary} disabled={busy} onClick={() => { void runApply(); }}>应用参数</button>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {preview ? (
        <div className={styles.diff} data-testid="model3d-edit-diff">
          <span className={styles.meta}>{preview.beforeHash.slice(0, 12)} → {preview.afterHash.slice(0, 12)}</span>
          {diffText(preview).map((line) => <span key={line}>{line}</span>)}
        </div>
      ) : null}
      {revisions.length > 0 ? (
        <div className={styles.revisions}>
          <span className={styles.meta}>修订历史（最近 {Math.min(revisions.length, 5)} 条）</span>
          {revisions.slice(-5).reverse().map((revision) => (
            <div key={revision.revisionId} className={styles.revisionRow}>
              <span>{revision.revisionId}</span>
              <span className={styles.meta}>{revision.reason}</span>
              <button type="button" className={button.ghost} disabled={busy} onClick={() => { void restore(revision.revisionId); }}>恢复</button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
