import React from 'react';
import { applySceneOperations } from '@/lib/sceneEditClient';
import { deriveSceneFeatureTable, type SceneFeatureRow } from '@/lib/workSurface/sceneFeatures';
import type { Scene3DSpec } from '@/lib/scene3d';
import button from '@/components/ui/controls/button.module.css';
import styles from './SceneConstraintEditor.module.css';

export interface SceneConstraintEditorProps {
  projectId: string;
  scene: Scene3DSpec;
  scenePath: string;
  expectedHash: string | null;
  onSceneUpdated: (scene: unknown) => void;
}

interface MateFormState {
  a: string;
  b: string;
  aFeature: string;
  bFeature: string;
  offset: string;
}

/**
 * BLOCK-322 P3-03 v2b 第二票（前端半）— 约束编辑器。
 *
 * feature 下拉引用特征表（deriveSceneFeatureTable 派生，同源移植——非自由文本）；
 * 提交走 scene/apply add_constraint 操作（后端创建即求值 fail-closed——不可解约束
 * 整个 apply 拒收，错误如实显示）；remove_constraint 同链路。
 */
export function SceneConstraintEditor({ projectId, scene, scenePath, expectedHash, onSceneUpdated }: SceneConstraintEditorProps): React.ReactElement {
  const featureTable = React.useMemo(() => deriveSceneFeatureTable(scene.nodes as never[]), [scene.nodes]);
  const nodeIds = Object.keys(featureTable);
  const [form, setForm] = React.useState<MateFormState>(() => ({
    a: nodeIds[0] ?? '',
    b: nodeIds[1] ?? nodeIds[0] ?? '',
    aFeature: featureTable[nodeIds[0]]?.[0]?.feature ?? '',
    bFeature: featureTable[nodeIds[1]]?.[0]?.feature ?? '',
    offset: '',
  }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const existingConstraints = Array.isArray(scene.constraints) ? scene.constraints : [];

  const setFormPart = (patch: Partial<MateFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const submitMate = async () => {
    if (!form.a || !form.b || form.a === form.b) {
      setError('请选择两个不同的节点。');
      return;
    }
    if (!form.aFeature || !form.bFeature) {
      setError('请选择两个贴合面。');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const offset = form.offset.trim() === '' ? undefined : Number(form.offset);
      const result = await applySceneOperations({
        projectId,
        path: scenePath,
        operations: [{
          op: 'add_constraint',
          constraint: {
            kind: 'mate',
            a: form.a,
            b: form.b,
            aFace: form.aFeature,
            bFace: form.bFeature,
            ...(offset !== undefined && Number.isFinite(offset) ? { offset } : {}),
          },
        }],
        expectedHash,
        reason: 'constraint_editor',
      });
      const maybeError = result as unknown as { ok?: unknown; error?: string; message?: string; scene?: unknown };
      if (maybeError.ok === false || maybeError.error) {
        setError(String(maybeError.message || maybeError.error || 'constraint_apply_failed'));
        return;
      }
      setNotice('贴合约束已创建。');
      onSceneUpdated(maybeError.scene ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'constraint_apply_failed');
    } finally {
      setBusy(false);
    }
  };

  const removeConstraint = async (constraintId: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await applySceneOperations({
        projectId,
        path: scenePath,
        operations: [{ op: 'remove_constraint', id: constraintId }],
        expectedHash,
        reason: 'constraint_editor',
      });
      const maybeError = result as unknown as { ok?: unknown; error?: string; message?: string; scene?: unknown };
      if (maybeError.ok === false || maybeError.error) {
        setError(String((result as { message?: string }).message || 'remove_failed'));
        return;
      }
      setNotice('约束已移除。');
      onSceneUpdated((result as { scene?: unknown }).scene ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'remove_failed');
    } finally {
      setBusy(false);
    }
  };

  if (nodeIds.length < 2) {
    return <p className={styles.meta}>特征编辑器需要至少两个有特征表的节点（box/cylinder/sphere）。</p>;
  }

  const faceOptions = (nodeId: string): SceneFeatureRow[] => featureTable[nodeId] || [];

  return (
    <div className={styles.editor}>
      {existingConstraints.length > 0 && (
        <div className={styles.existing} data-testid="constraint-editor-existing">
          {existingConstraints.map((constraint, index) => {
            const row = constraint as { kind?: string; id?: string; a?: string; aFace?: string; b?: string; bFace?: string; offset?: number };
            const cid = row.id || `#${index}`;
            return (
              <div key={cid} className={styles.constraintRow}>
                <span className={styles.constraintLabel}>
                  {row.kind === 'mate'
                    ? `贴合 ${row.a}·${row.aFace} ↔ ${row.b}·${row.bFace}${row.offset !== undefined ? `（${row.offset > 0 ? '+' : ''}${row.offset}mm）` : ''}`
                    : `${row.kind} ${row.a} → ${row.b}`}
                </span>
                <button
                  type="button"
                  className={button.ghost}
                  aria-label={`移除约束 ${cid}`}
                  onClick={() => void removeConstraint(cid)}
                  disabled={busy || !row.id}
                >
                  移除
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className={styles.form} data-testid="constraint-editor-form">
        <label className={styles.field}>
          <span>节点 A</span>
          <select
            value={form.a}
            onChange={(e) => setFormPart({ a: e.target.value, aFeature: featureTable[e.target.value]?.[0]?.feature ?? '' })}
            disabled={busy}
          >
            {nodeIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>面 A</span>
          <select value={form.aFeature} onChange={(e) => setFormPart({ aFeature: e.target.value })} disabled={busy}>
            {faceOptions(form.a).map((f) => <option key={f.id} value={f.feature}>{f.feature}（{f.kind}）</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>节点 B</span>
          <select
            value={form.b}
            onChange={(e) => setFormPart({ b: e.target.value, bFeature: featureTable[e.target.value]?.[0]?.feature ?? '' })}
            disabled={busy}
          >
            {nodeIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>面 B</span>
          <select value={form.bFeature} onChange={(e) => setFormPart({ bFeature: e.target.value })} disabled={busy}>
            {faceOptions(form.b).map((f) => <option key={f.id} value={f.feature}>{f.feature}（{f.kind}）</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>offset（mm，可空）</span>
          <input
            type="number"
            step="0.1"
            value={form.offset}
            onChange={(e) => setFormPart({ offset: e.target.value })}
            disabled={busy}
          />
        </label>
        <button
          type="button"
          className={`${button.primary} ${styles.submitBtn}`}
          onClick={() => void submitMate()}
          disabled={busy || !form.aFeature || !form.bFeature}
          data-testid="constraint-editor-submit"
        >
          {busy ? '提交中…' : '创建贴合约束'}
        </button>
      </div>
      {error && <p className={styles.error} role="alert" data-testid="constraint-editor-error">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </div>
  );
}

export default SceneConstraintEditor;
